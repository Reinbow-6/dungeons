import { randomUUID } from "node:crypto";
import {
  AGUAS_QUIETAS_SCENES,
  createDefaultAuthority,
  reduceEvents,
  rollbackToSeq,
  type Character,
  type GameEvent,
  type GameState,
  type RollbackResult,
  type RulesetProfile,
} from "@dungeons/rules";
import { and, asc, desc, eq, gt, inArray, isNull, sql } from "drizzle-orm";

import { getDb, isDbConfigured } from "@/lib/db/client";
import {
  campaignMembers,
  campaigns,
  characters,
  eventLog,
  gameStateSnapshots,
  messages,
  sessions,
} from "@/lib/db/schema";
import {
  buildInitialCampaignState,
  type CharacterPresetId,
  isPresetId,
} from "@/lib/game/presets";

const UUID_REGEX =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export interface StoredMessage {
  id: string;
  role: "user" | "assistant" | "system";
  parts: unknown[];
  createdAt: string;
  eventSeq?: number | null;
  revertedBySeq?: number | null;
}

/** Error estructurado para commits con seq de cliente desactualizado. */
export class StaleSeqError extends Error {
  readonly code = "STALE_SEQ";

  constructor(
    readonly expectedSeq: number,
    readonly actualSeq: number,
  ) {
    super(
      `Secuencia obsoleta: el cliente esperaba ${expectedSeq} pero el servidor tiene ${actualSeq}. Recargá el estado y reintentá.`,
    );
    this.name = "StaleSeqError";
  }
}

export function isStaleSeqError(err: unknown): err is StaleSeqError {
  return (
    err instanceof StaleSeqError ||
    (typeof err === "object" &&
      err !== null &&
      (err as { code?: unknown }).code === "STALE_SEQ")
  );
}

function isUniqueSeqViolation(err: unknown): boolean {
  return (
    (typeof err === "object" &&
      err !== null &&
      (err as { code?: unknown }).code === "23505") ||
    (err instanceof Error && err.message.includes("event_log_campaign_seq_idx"))
  );
}

export interface LoadedCampaign {
  campaignId: string;
  sessionId: string;
  title: string;
  adventureId: string;
  ruleset: RulesetProfile;
  initialState: GameState;
  state: GameState;
  /**
   * Máximo `seq` existente en `event_log` (incluyendo eventos revertidos y filas ROLLBACK).
   * Usar como `expectedSeq` en `appendEvent` para concurrencia optimista sin falsos STALE_SEQ tras rollback.
   */
  logHeadSeq: number;
  events: GameEvent[];
  messages: StoredMessage[];
}

function computeLogHeadSeq(events: GameEvent[]): number {
  return events.reduce((max, e) => (e.seq > max ? e.seq : max), 0);
}

export interface CreateCampaignInput {
  guestId: string;
  presetId?: string;
  mode?: "digital" | "hybrid";
  ruleset?: RulesetProfile;
  title?: string;
}

export interface GameStore {
  createCampaign(input: CreateCampaignInput): Promise<LoadedCampaign>;
  getLatestCampaignForGuest(guestId: string): Promise<LoadedCampaign | null>;
  loadCampaign(
    campaignId: string,
    guestId: string,
  ): Promise<LoadedCampaign | null>;
  appendEvent(
    campaignId: string,
    sessionId: string,
    event: GameEvent,
    nextState: GameState,
    expectedSeq?: number,
  ): Promise<void>;
  rollbackCampaign(
    campaignId: string,
    guestId: string,
    targetSeq: number,
  ): Promise<RollbackResult>;
  updateCharacterMode(
    campaignId: string,
    guestId: string,
    actorId: string,
    mode: "digital" | "hybrid",
  ): Promise<LoadedCampaign | null>;
  saveMessages(
    campaignId: string,
    sessionId: string,
    entries: Array<{ role: "user" | "assistant" | "system"; parts: unknown[] }>,
    currentSeq?: number,
  ): Promise<void>;
}

function mapEventRow(row: typeof eventLog.$inferSelect): GameEvent {
  return {
    id: row.id,
    campaignId: row.campaignId,
    sessionId: row.sessionId,
    seq: row.seq,
    type: row.type as GameEvent["type"],
    source: row.source,
    visibility: row.visibility,
    actor: row.actor,
    checkId: row.checkId,
    declaredTotal: row.declaredTotal,
    dieResults: row.dieResults,
    payload: row.payload,
    stateDelta: row.stateDelta,
    revertedByEventId: row.revertedByEventId,
    createdAt: row.createdAt.toISOString(),
  };
}

function buildInitialFromRows(params: {
  campaign: typeof campaigns.$inferSelect;
  session: typeof sessions.$inferSelect;
  characterRows: Array<typeof characters.$inferSelect>;
}): GameState {
  const charRecord: Record<string, Character> = {};
  for (const row of params.characterRows) {
    charRecord[row.actorId] = row.sheet;
  }

  return {
    campaignId: params.campaign.id,
    sessionId: params.session.id,
    ruleset: params.campaign.ruleset,
    sceneId: "escena_01_orilla",
    lastSeq: 0,
    characters: charRecord,
    flags: {},
    unlockedClues: {},
    scenes: AGUAS_QUIETAS_SCENES,
  };
}

export class SupabaseGameStore implements GameStore {
  async createCampaign(input: CreateCampaignInput): Promise<LoadedCampaign> {
    const db = getDb();
    const campaignId = randomUUID();
    const sessionId = randomUUID();
    const presetId: CharacterPresetId =
      input.presetId && isPresetId(input.presetId) ? input.presetId : "pc_kael";
    const mode = input.mode === "hybrid" ? "hybrid" : "digital";
    const ruleset: RulesetProfile =
      input.ruleset === "5e-full" ? "5e-full" : "5e-lite";
    const title = input.title?.trim() || "Aguas Quietas";

    const initialState = buildInitialCampaignState({
      campaignId,
      sessionId,
      presetId,
      mode,
      ruleset,
    });
    const mainCharacter = Object.values(initialState.characters)[0]!;

    await db.transaction(async (tx) => {
      await tx.insert(campaigns).values({
        id: campaignId,
        ownerGuestId: input.guestId,
        title,
        adventureId: "aguas-quietas",
        ruleset,
        worldSummary:
          "Frontera pantanosa del norte tras la caída de la capital del sur.",
      });

      await tx.insert(sessions).values({
        id: sessionId,
        campaignId,
        sessionNumber: 1,
        summary: "",
      });

      const [insertedChar] = await tx
        .insert(characters)
        .values({
          campaignId,
          actorId: mainCharacter.id,
          ownerGuestId: input.guestId,
          name: mainCharacter.name,
          sheet: mainCharacter,
        })
        .returning({ id: characters.id });

      await tx.insert(campaignMembers).values({
        campaignId,
        guestId: input.guestId,
        characterId: insertedChar?.id ?? null,
        role: "player",
      });

      await tx.insert(gameStateSnapshots).values({
        campaignId,
        lastSeq: 0,
        sceneId: initialState.sceneId,
        state: initialState,
      });
    });

    return {
      campaignId,
      sessionId,
      title,
      adventureId: "aguas-quietas",
      ruleset,
      initialState,
      state: initialState,
      logHeadSeq: 0,
      events: [],
      messages: [],
    };
  }

  async getLatestCampaignForGuest(
    guestId: string,
  ): Promise<LoadedCampaign | null> {
    const db = getDb();
    const [latest] = await db
      .select({ id: campaigns.id })
      .from(campaigns)
      .where(eq(campaigns.ownerGuestId, guestId))
      .orderBy(desc(campaigns.createdAt))
      .limit(1);

    if (!latest) {
      return null;
    }
    return this.loadCampaign(latest.id, guestId);
  }

  async loadCampaign(
    campaignId: string,
    guestId: string,
  ): Promise<LoadedCampaign | null> {
    if (!UUID_REGEX.test(campaignId)) {
      return null;
    }

    const db = getDb();
    const [campaign] = await db
      .select()
      .from(campaigns)
      .where(
        and(eq(campaigns.id, campaignId), eq(campaigns.ownerGuestId, guestId)),
      )
      .limit(1);

    if (!campaign) {
      return null;
    }

    const [session] = await db
      .select()
      .from(sessions)
      .where(eq(sessions.campaignId, campaign.id))
      .orderBy(asc(sessions.sessionNumber))
      .limit(1);

    if (!session) {
      return null;
    }

    const charRows = await db
      .select()
      .from(characters)
      .where(eq(characters.campaignId, campaign.id));

    const eventRows = await db
      .select()
      .from(eventLog)
      .where(eq(eventLog.campaignId, campaign.id))
      .orderBy(asc(eventLog.seq));

    const messageRows = await db
      .select()
      .from(messages)
      .where(
        and(
          eq(messages.campaignId, campaign.id),
          isNull(messages.revertedBySeq),
        ),
      )
      .orderBy(asc(messages.createdAt));

    const initialState = buildInitialFromRows({
      campaign,
      session,
      characterRows: charRows,
    });
    const events = eventRows.map(mapEventRow);
    const state = reduceEvents(initialState, events);

    return {
      campaignId: campaign.id,
      sessionId: session.id,
      title: campaign.title,
      adventureId: campaign.adventureId,
      ruleset: campaign.ruleset,
      initialState,
      state,
      logHeadSeq: computeLogHeadSeq(events),
      events,
      messages: messageRows.map((m) => ({
        id: m.id,
        role: m.role,
        parts: m.parts,
        createdAt: m.createdAt.toISOString(),
        eventSeq: m.eventSeq,
        revertedBySeq: m.revertedBySeq,
      })),
    };
  }

  async appendEvent(
    campaignId: string,
    sessionId: string,
    event: GameEvent,
    nextState: GameState,
    expectedSeq?: number,
  ): Promise<void> {
    const db = getDb();
    let retriedUniqueConflict = false;
    for (;;) {
      try {
        await db.transaction(async (tx) => {
          // Optimistic check: no SELECT FOR UPDATE (postgres.js client); the
          // unique (campaign_id, seq) index is the final arbiter.
          const [row] = await tx
            .select({
              maxSeq: sql<number>`coalesce(max(${eventLog.seq}), 0)`,
            })
            .from(eventLog)
            .where(eq(eventLog.campaignId, campaignId));
          const currentMax = Number(row?.maxSeq ?? 0);
          if (
            expectedSeq !== undefined &&
            expectedSeq !== currentMax &&
            !retriedUniqueConflict
          ) {
            throw new StaleSeqError(expectedSeq, currentMax);
          }

          const nextSeq = currentMax + 1;
          event.seq = nextSeq;
          nextState.lastSeq = nextSeq;

          await tx.insert(eventLog).values({
            id: event.id,
            campaignId,
            sessionId,
            seq: nextSeq,
            type: event.type,
            source: event.source,
            visibility: event.visibility,
            actor: event.actor,
            checkId: event.checkId,
            declaredTotal: event.declaredTotal,
            dieResults: event.dieResults,
            payload: event.payload,
            stateDelta: event.stateDelta,
            revertedByEventId: event.revertedByEventId,
          });

          await tx
            .update(gameStateSnapshots)
            .set({
              lastSeq: nextSeq,
              sceneId: nextState.sceneId,
              state: nextState,
              updatedAt: new Date(),
            })
            .where(eq(gameStateSnapshots.campaignId, campaignId));
        });
        return;
      } catch (err) {
        if (!retriedUniqueConflict && isUniqueSeqViolation(err)) {
          retriedUniqueConflict = true;
          continue;
        }
        throw err;
      }
    }
  }

  async rollbackCampaign(
    campaignId: string,
    guestId: string,
    targetSeq: number,
  ): Promise<RollbackResult> {
    const loaded = await this.loadCampaign(campaignId, guestId);
    if (!loaded) {
      return {
        ok: false,
        code: "INVALID_TARGET_SEQ",
        messageEs: "Campaña no encontrada para este jugador.",
      };
    }

    const rb = rollbackToSeq(loaded.initialState, loaded.events, targetSeq, {
      createId: () => randomUUID(),
      now: () => new Date().toISOString(),
      actor: Object.keys(loaded.state.characters)[0] ?? "system",
    });

    if (!rb.ok) {
      return rb;
    }

    const revertedIds = (
      rb.rollbackEvent.payload.revertedEventIds as string[] | undefined
    )?.filter((id) => UUID_REGEX.test(id));

    const db = getDb();
    await db.transaction(async (tx) => {
      if (revertedIds && revertedIds.length > 0) {
        await tx
          .update(eventLog)
          .set({ revertedByEventId: rb.rollbackEvent.id })
          .where(
            and(
              eq(eventLog.campaignId, campaignId),
              inArray(eventLog.id, revertedIds),
            ),
          );
      }

      await tx
        .update(messages)
        .set({ revertedBySeq: rb.rollbackEvent.seq })
        .where(
          and(
            eq(messages.campaignId, campaignId),
            gt(messages.eventSeq, targetSeq),
            isNull(messages.revertedBySeq),
          ),
        );

      await tx.insert(eventLog).values({
        id: rb.rollbackEvent.id,
        campaignId,
        sessionId: loaded.sessionId,
        seq: rb.rollbackEvent.seq,
        type: rb.rollbackEvent.type,
        source: rb.rollbackEvent.source,
        visibility: rb.rollbackEvent.visibility,
        actor: rb.rollbackEvent.actor,
        checkId: rb.rollbackEvent.checkId,
        declaredTotal: rb.rollbackEvent.declaredTotal,
        dieResults: rb.rollbackEvent.dieResults,
        payload: rb.rollbackEvent.payload,
        stateDelta: rb.rollbackEvent.stateDelta,
        revertedByEventId: null,
      });

      await tx
        .update(gameStateSnapshots)
        .set({
          lastSeq: rb.state.lastSeq,
          sceneId: rb.state.sceneId,
          state: rb.state,
          updatedAt: new Date(),
        })
        .where(eq(gameStateSnapshots.campaignId, campaignId));
    });

    return rb;
  }

  async updateCharacterMode(
    campaignId: string,
    guestId: string,
    actorId: string,
    mode: "digital" | "hybrid",
  ): Promise<LoadedCampaign | null> {
    const loaded = await this.loadCampaign(campaignId, guestId);
    if (!loaded) {
      return null;
    }
    const baseChar = loaded.initialState.characters[actorId];
    if (!baseChar) {
      return null;
    }

    const updatedBaseChar: Character = {
      ...baseChar,
      authority: createDefaultAuthority(mode),
      rollAuthority: mode === "hybrid" ? "player-declared" : "engine-rolled",
    };

    const updatedInitial: GameState = {
      ...loaded.initialState,
      characters: {
        ...loaded.initialState.characters,
        [actorId]: updatedBaseChar,
      },
    };
    const nextState = reduceEvents(updatedInitial, loaded.events);

    const db = getDb();
    await db.transaction(async (tx) => {
      await tx
        .update(characters)
        .set({
          sheet: updatedBaseChar,
          updatedAt: new Date(),
        })
        .where(
          and(
            eq(characters.campaignId, campaignId),
            eq(characters.actorId, actorId),
          ),
        );

      await tx
        .update(gameStateSnapshots)
        .set({
          state: nextState,
          updatedAt: new Date(),
        })
        .where(eq(gameStateSnapshots.campaignId, campaignId));
    });

    return {
      ...loaded,
      initialState: updatedInitial,
      state: nextState,
    };
  }

  async saveMessages(
    campaignId: string,
    sessionId: string,
    entries: Array<{ role: "user" | "assistant" | "system"; parts: unknown[] }>,
    currentSeq?: number,
  ): Promise<void> {
    if (entries.length === 0) return;
    const db = getDb();
    await db.insert(messages).values(
      entries.map((m) => ({
        campaignId,
        sessionId,
        role: m.role,
        parts: m.parts,
        eventSeq: currentSeq ?? null,
      })),
    );
  }
}

/**
 * Deterministic in-memory GameStore for unit/integration tests without Postgres.
 */
export class InMemoryGameStore implements GameStore {
  private campaigns = new Map<
    string,
    LoadedCampaign & { ownerGuestId: string }
  >();

  async createCampaign(input: CreateCampaignInput): Promise<LoadedCampaign> {
    const campaignId = randomUUID();
    const sessionId = randomUUID();
    const presetId: CharacterPresetId =
      input.presetId && isPresetId(input.presetId) ? input.presetId : "pc_kael";
    const mode = input.mode === "hybrid" ? "hybrid" : "digital";
    const ruleset: RulesetProfile =
      input.ruleset === "5e-full" ? "5e-full" : "5e-lite";
    const title = input.title?.trim() || "Aguas Quietas";

    const initialState = buildInitialCampaignState({
      campaignId,
      sessionId,
      presetId,
      mode,
      ruleset,
    });

    const record: LoadedCampaign & { ownerGuestId: string } = {
      ownerGuestId: input.guestId,
      campaignId,
      sessionId,
      title,
      adventureId: "aguas-quietas",
      ruleset,
      initialState,
      state: initialState,
      logHeadSeq: 0,
      events: [],
      messages: [],
    };
    this.campaigns.set(campaignId, record);
    return record;
  }

  async getLatestCampaignForGuest(
    guestId: string,
  ): Promise<LoadedCampaign | null> {
    const list = Array.from(this.campaigns.values()).filter(
      (c) => c.ownerGuestId === guestId,
    );
    const latest = list.at(-1);
    if (!latest) return null;
    return this.loadCampaign(latest.campaignId, guestId);
  }

  async loadCampaign(
    campaignId: string,
    guestId: string,
  ): Promise<LoadedCampaign | null> {
    const found = this.campaigns.get(campaignId);
    if (!found || found.ownerGuestId !== guestId) {
      return null;
    }
    return {
      ...found,
      state: reduceEvents(found.initialState, found.events),
      logHeadSeq: computeLogHeadSeq(found.events),
      messages: found.messages
        .filter((m) => m.revertedBySeq == null)
        .map((m) => ({ ...m })),
    };
  }

  async appendEvent(
    campaignId: string,
    _sessionId: string,
    event: GameEvent,
    nextState: GameState,
    expectedSeq?: number,
  ): Promise<void> {
    const found = this.campaigns.get(campaignId);
    if (!found) {
      throw new Error(`Campaña inexistente: ${campaignId}`);
    }
    const maxSeq = computeLogHeadSeq(found.events);
    if (expectedSeq !== undefined && expectedSeq !== maxSeq) {
      throw new StaleSeqError(expectedSeq, maxSeq);
    }
    const nextSeq = maxSeq + 1;
    event.seq = nextSeq;
    nextState.lastSeq = nextSeq;
    found.events = [...found.events, event];
    found.state = nextState;
    found.logHeadSeq = nextSeq;
  }

  async rollbackCampaign(
    campaignId: string,
    guestId: string,
    targetSeq: number,
  ): Promise<RollbackResult> {
    const found = await this.loadCampaign(campaignId, guestId);
    if (!found) {
      return {
        ok: false,
        code: "INVALID_TARGET_SEQ",
        messageEs: "Campaña no encontrada.",
      };
    }

    const rb = rollbackToSeq(found.initialState, found.events, targetSeq, {
      createId: () => randomUUID(),
      now: () => new Date().toISOString(),
      actor: Object.keys(found.state.characters)[0] ?? "system",
    });
    if (!rb.ok) return rb;

    const stored = this.campaigns.get(campaignId)!;
    stored.events = rb.events;
    stored.state = rb.state;
    stored.logHeadSeq = computeLogHeadSeq(rb.events);
    for (const msg of stored.messages) {
      if (
        msg.eventSeq != null &&
        msg.eventSeq > targetSeq &&
        msg.revertedBySeq == null
      ) {
        msg.revertedBySeq = rb.rollbackEvent.seq;
      }
    }
    return rb;
  }

  async updateCharacterMode(
    campaignId: string,
    guestId: string,
    actorId: string,
    mode: "digital" | "hybrid",
  ): Promise<LoadedCampaign | null> {
    const found = this.campaigns.get(campaignId);
    if (!found || found.ownerGuestId !== guestId) return null;
    const baseChar = found.initialState.characters[actorId];
    if (!baseChar) return null;

    const updatedBase: Character = {
      ...baseChar,
      authority: createDefaultAuthority(mode),
      rollAuthority: mode === "hybrid" ? "player-declared" : "engine-rolled",
    };

    found.initialState = {
      ...found.initialState,
      characters: {
        ...found.initialState.characters,
        [actorId]: updatedBase,
      },
    };
    found.state = reduceEvents(found.initialState, found.events);
    found.logHeadSeq = computeLogHeadSeq(found.events);
    return this.loadCampaign(campaignId, guestId);
  }

  async saveMessages(
    campaignId: string,
    _sessionId: string,
    entries: Array<{ role: "user" | "assistant" | "system"; parts: unknown[] }>,
    currentSeq?: number,
  ): Promise<void> {
    const found = this.campaigns.get(campaignId);
    if (!found) return;
    const now = new Date().toISOString();
    found.messages = [
      ...found.messages,
      ...entries.map((m) => ({
        id: randomUUID(),
        role: m.role,
        parts: m.parts,
        createdAt: now,
        eventSeq: currentSeq ?? null,
        revertedBySeq: null,
      })),
    ];
  }
}

const supabaseStore = new SupabaseGameStore();
const fallbackMemoryStore = new InMemoryGameStore();

export function getDefaultGameStore(): GameStore {
  if (isDbConfigured()) {
    return supabaseStore;
  }
  if (process.env.NODE_ENV === "production") {
    throw new Error(
      "DATABASE_URL es obligatoria en producción (no se permite fallback en memoria).",
    );
  }
  return fallbackMemoryStore;
}
