import { randomUUID } from "node:crypto";
import {
  createDefaultAuthority,
  reduceEvents,
  rollbackToSeq,
  type AdventurePack,
  type Character,
  type GameEvent,
  type GameState,
  type RollbackResult,
  type RulesetProfile,
} from "@dungeons/rules";
import { and, asc, desc, eq, gt, inArray, isNull, ne, or, sql } from "drizzle-orm";

import { getDb, isDbConfigured } from "@/lib/db/client";
import {
  adventurePacks,
  campaignMembers,
  campaigns,
  characters,
  eventLog,
  gameStateSnapshots,
  memoryFacts,
  messages,
  sessions,
} from "@/lib/db/schema";
import {
  type AdventurePackSummary,
  getBuiltinAdventurePack,
  getFallbackAdventurePack,
  listBuiltinAdventurePackSummaries,
  summarizeAdventurePack,
} from "@/lib/game/adventure-packs";
import { buildSeededIntroParts } from "@/lib/game/intro";
import {
  buildInitialPartyCampaignState,
  type CharacterPresetId,
  isPresetId,
  type PartyMemberSpec,
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

export type MemoryFactCategory =
  | "npc"
  | "promise"
  | "milestone"
  | "scene"
  | "item";

export interface StoredMemoryFact {
  id: string;
  campaignId: string;
  sessionId: string | null;
  category: string;
  content: string;
  importance: number;
  eventSeq: number;
  revertedBySeq: number | null;
  source: string;
  createdAt: string;
}

export interface SaveMemoryFactInput {
  category: string;
  content: string;
  importance?: number;
  eventSeq: number;
  source?: string;
}

export interface SessionSummaryItem {
  id: string;
  sessionNumber: number;
  summary: string;
  startedAt: string;
  endedAt: string | null;
}

export interface CampaignSummary {
  campaignId: string;
  title: string;
  adventureId: string;
  ruleset: RulesetProfile;
  sceneId: string;
  sceneTitleEs?: string;
  lastSeq: number;
  role: string;
  updatedAt: string;
}

export interface PaginatedCampaignList {
  items: CampaignSummary[];
  total: number;
  limit: number;
  offset: number;
}

export interface LoadedCampaign {
  campaignId: string;
  sessionId: string;
  sessionNumber: number;
  title: string;
  adventureId: string;
  adventurePack?: AdventurePack;
  ruleset: RulesetProfile;
  worldSummary: string;
  initialState: GameState;
  state: GameState;
  /**
   * Máximo `seq` existente en `event_log` (incluyendo eventos revertidos y filas ROLLBACK).
   * Usar como `expectedSeq` en `appendEvent` para concurrencia optimista sin falsos STALE_SEQ tras rollback.
   */
  logHeadSeq: number;
  events: GameEvent[];
  messages: StoredMessage[];
  sessionSummaries: SessionSummaryItem[];
  memoryFacts: StoredMemoryFact[];
}

function computeLogHeadSeq(events: GameEvent[]): number {
  return events.reduce((max, e) => (e.seq > max ? e.seq : max), 0);
}

function sortMemoryFacts(facts: StoredMemoryFact[]): StoredMemoryFact[] {
  return facts.slice().sort((a, b) => {
    if (b.importance !== a.importance) return b.importance - a.importance;
    return b.eventSeq - a.eventSeq;
  });
}

export interface CreateCampaignInput {
  guestId: string;
  adventureId?: string;
  presetId?: string;
  party?: Array<{ presetId: string; playerName?: string }>;
  mode?: "digital" | "hybrid";
  ruleset?: RulesetProfile;
  title?: string;
}

function normalizePartyInput(input: CreateCampaignInput): PartyMemberSpec[] {
  const seen = new Set<CharacterPresetId>();
  const out: PartyMemberSpec[] = [];
  for (const item of input.party ?? []) {
    if (isPresetId(item.presetId) && !seen.has(item.presetId)) {
      seen.add(item.presetId);
      const cleanName = item.playerName?.trim().slice(0, 40);
      out.push({
        presetId: item.presetId,
        ...(cleanName ? { playerName: cleanName } : {}),
      });
    }
    if (out.length >= 4) break;
  }
  if (out.length === 0) {
    const fallbackPreset: CharacterPresetId =
      input.presetId && isPresetId(input.presetId) ? input.presetId : "pc_kael";
    out.push({ presetId: fallbackPreset });
  }
  return out;
}

export interface GameStore {
  createCampaign(input: CreateCampaignInput): Promise<LoadedCampaign>;
  seedOpeningIntro(
    campaignId: string,
    guestId: string,
  ): Promise<LoadedCampaign | null>;
  getLatestCampaignForGuest(guestId: string): Promise<LoadedCampaign | null>;
  loadCampaign(
    campaignId: string,
    guestId: string,
  ): Promise<LoadedCampaign | null>;
  listCampaignsForGuest(
    guestId: string,
    options?: { limit?: number; offset?: number },
  ): Promise<PaginatedCampaignList>;
  deleteCampaign(campaignId: string, guestId: string): Promise<boolean>;
  deleteAllCampaignsForGuest(
    guestId: string,
    options?: { exceptCampaignId?: string },
  ): Promise<number>;
  addCampaignMember(
    campaignId: string,
    ownerGuestId: string,
    memberGuestId: string,
    role?: string,
  ): Promise<boolean>;
  startNewSession(
    campaignId: string,
    guestId: string,
    options?: { closingSummary?: string; worldSummary?: string },
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
  updateTableMode(
    campaignId: string,
    guestId: string,
    mode: "digital" | "hybrid",
  ): Promise<LoadedCampaign | null>;
  saveMessages(
    campaignId: string,
    sessionId: string,
    entries: Array<{ role: "user" | "assistant" | "system"; parts: unknown[] }>,
    currentSeq?: number,
  ): Promise<void>;
  saveMemoryFacts(
    campaignId: string,
    sessionId: string,
    facts: SaveMemoryFactInput[],
  ): Promise<StoredMemoryFact[]>;
  upsertAdventurePack(
    guestId: string,
    pack: AdventurePack,
  ): Promise<AdventurePackSummary>;
  listAdventurePacks(guestId: string): Promise<AdventurePackSummary[]>;
  getAdventurePack(id: string, guestId: string): Promise<AdventurePack | null>;
  deleteAdventurePack(slug: string, guestId: string): Promise<boolean>;
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

function mapMemoryFactRow(
  row: typeof memoryFacts.$inferSelect,
): StoredMemoryFact {
  return {
    id: row.id,
    campaignId: row.campaignId,
    sessionId: row.sessionId,
    category: row.category,
    content: row.content,
    importance: row.importance,
    eventSeq: row.eventSeq,
    revertedBySeq: row.revertedBySeq,
    source: row.source,
    createdAt: row.createdAt.toISOString(),
  };
}

function buildInitialFromRows(params: {
  campaign: typeof campaigns.$inferSelect;
  session: typeof sessions.$inferSelect;
  characterRows: Array<typeof characters.$inferSelect>;
  adventurePack?: AdventurePack;
}): GameState {
  const pack = params.adventurePack ?? getFallbackAdventurePack();
  const charRecord: Record<string, Character> = {};
  for (const row of params.characterRows) {
    charRecord[row.actorId] = row.sheet;
  }

  return {
    campaignId: params.campaign.id,
    sessionId: params.session.id,
    adventureId: params.campaign.adventureId || pack.id,
    ruleset: params.campaign.ruleset,
    sceneId: pack.initialSceneId,
    lastSeq: 0,
    characters: charRecord,
    flags: {},
    unlockedClues: {},
    scenes: pack.scenes,
  };
}

export class SupabaseGameStore implements GameStore {
  async upsertAdventurePack(
    guestId: string,
    pack: AdventurePack,
  ): Promise<AdventurePackSummary> {
    const db = getDb();
    const now = new Date();
    const [row] = await db
      .insert(adventurePacks)
      .values({
        ownerGuestId: guestId,
        slug: pack.id,
        title: pack.titleEs,
        rulesetRecommended: pack.recommendedRuleset,
        pack,
        updatedAt: now,
      })
      .onConflictDoUpdate({
        target: [adventurePacks.ownerGuestId, adventurePacks.slug],
        set: {
          title: pack.titleEs,
          rulesetRecommended: pack.recommendedRuleset,
          pack,
          updatedAt: now,
        },
      })
      .returning({ updatedAt: adventurePacks.updatedAt });

    return summarizeAdventurePack(pack, {
      builtin: false,
      updatedAt: (row?.updatedAt ?? now).toISOString(),
    });
  }

  async listAdventurePacks(guestId: string): Promise<AdventurePackSummary[]> {
    const db = getDb();
    const rows = await db
      .select({
        pack: adventurePacks.pack,
        updatedAt: adventurePacks.updatedAt,
      })
      .from(adventurePacks)
      .where(eq(adventurePacks.ownerGuestId, guestId))
      .orderBy(desc(adventurePacks.updatedAt));

    return [
      ...listBuiltinAdventurePackSummaries(),
      ...rows.map((r) =>
        summarizeAdventurePack(r.pack, {
          builtin: false,
          updatedAt: r.updatedAt.toISOString(),
        }),
      ),
    ];
  }

  async getAdventurePack(
    id: string,
    guestId: string,
  ): Promise<AdventurePack | null> {
    const builtin = getBuiltinAdventurePack(id);
    if (builtin) return builtin;

    const db = getDb();
    const [row] = await db
      .select({ pack: adventurePacks.pack })
      .from(adventurePacks)
      .where(
        and(
          eq(adventurePacks.ownerGuestId, guestId),
          eq(adventurePacks.slug, id),
        ),
      )
      .limit(1);

    return row?.pack ?? null;
  }

  async deleteAdventurePack(slug: string, guestId: string): Promise<boolean> {
    const db = getDb();
    const deleted = await db
      .delete(adventurePacks)
      .where(
        and(
          eq(adventurePacks.ownerGuestId, guestId),
          eq(adventurePacks.slug, slug),
        ),
      )
      .returning({ id: adventurePacks.id });
    return deleted.length > 0;
  }

  async createCampaign(input: CreateCampaignInput): Promise<LoadedCampaign> {
    const db = getDb();
    const campaignId = randomUUID();
    const sessionId = randomUUID();
    const party = normalizePartyInput(input);
    const mode = input.mode === "hybrid" ? "hybrid" : "digital";
    const requestedAdventureId = input.adventureId?.trim() || "aguas-quietas";
    const resolvedPack = await this.getAdventurePack(
      requestedAdventureId,
      input.guestId,
    );
    if (!resolvedPack && input.adventureId?.trim()) {
      throw new Error(`ADVENTURE_PACK_NOT_FOUND:${requestedAdventureId}`);
    }
    const pack = resolvedPack ?? getFallbackAdventurePack();
    const ruleset: RulesetProfile =
      input.ruleset === "5e-full" || input.ruleset === "5e-lite"
        ? input.ruleset
        : pack.recommendedRuleset;
    const title = input.title?.trim() || pack.titleEs;
    const worldSummary = pack.worldSummaryEs;

    const initialState = buildInitialPartyCampaignState({
      campaignId,
      sessionId,
      party,
      mode,
      ruleset,
      adventurePack: pack,
    });
    const partyChars = Object.values(initialState.characters);
    const now = new Date();

    await db.transaction(async (tx) => {
      await tx.insert(campaigns).values({
        id: campaignId,
        ownerGuestId: input.guestId,
        title,
        adventureId: pack.id,
        ruleset,
        worldSummary,
      });

      await tx.insert(sessions).values({
        id: sessionId,
        campaignId,
        sessionNumber: 1,
        summary: "",
        startedAt: now,
      });

      const insertedChars = await tx
        .insert(characters)
        .values(
          partyChars.map((ch) => ({
            campaignId,
            actorId: ch.id,
            ownerGuestId: input.guestId,
            name: ch.name,
            sheet: ch,
          })),
        )
        .returning({ id: characters.id });

      await tx.insert(campaignMembers).values({
        campaignId,
        guestId: input.guestId,
        characterId: insertedChars[0]?.id ?? null,
        role: "owner",
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
      sessionNumber: 1,
      title,
      adventureId: pack.id,
      adventurePack: pack,
      ruleset,
      worldSummary,
      initialState,
      state: initialState,
      logHeadSeq: 0,
      events: [],
      messages: [],
      sessionSummaries: [
        {
          id: sessionId,
          sessionNumber: 1,
          summary: "",
          startedAt: now.toISOString(),
          endedAt: null,
        },
      ],
      memoryFacts: [],
    };
  }

  async getLatestCampaignForGuest(
    guestId: string,
  ): Promise<LoadedCampaign | null> {
    const db = getDb();
    const memberCampaigns = db
      .select({ campaignId: campaignMembers.campaignId })
      .from(campaignMembers)
      .where(eq(campaignMembers.guestId, guestId));

    const [latest] = await db
      .select({ id: campaigns.id })
      .from(campaigns)
      .where(
        or(
          eq(campaigns.ownerGuestId, guestId),
          inArray(campaigns.id, memberCampaigns),
        ),
      )
      .orderBy(desc(campaigns.updatedAt), desc(campaigns.createdAt))
      .limit(1);

    if (!latest) {
      return null;
    }
    return this.loadCampaign(latest.id, guestId);
  }

  async listCampaignsForGuest(
    guestId: string,
    options?: { limit?: number; offset?: number },
  ): Promise<PaginatedCampaignList> {
    const limit = Math.min(50, Math.max(1, Math.trunc(options?.limit ?? 20)));
    const offset = Math.max(0, Math.trunc(options?.offset ?? 0));
    const db = getDb();

    const memberCampaigns = db
      .select({ campaignId: campaignMembers.campaignId })
      .from(campaignMembers)
      .where(eq(campaignMembers.guestId, guestId));
    const accessFilter = or(
      eq(campaigns.ownerGuestId, guestId),
      inArray(campaigns.id, memberCampaigns),
    );

    const [countRow] = await db
      .select({ count: sql<number>`count(*)` })
      .from(campaigns)
      .where(accessFilter);

    const rows = await db
      .select()
      .from(campaigns)
      .where(accessFilter)
      .orderBy(desc(campaigns.updatedAt), desc(campaigns.createdAt))
      .limit(limit)
      .offset(offset);

    if (rows.length === 0) {
      return { items: [], total: Number(countRow?.count ?? 0), limit, offset };
    }

    const ids = rows.map((r) => r.id);
    const ownerGuestIds = Array.from(new Set(rows.map((r) => r.ownerGuestId)));
    const [snapshots, memberRoles, customPackRows] = await Promise.all([
      db
        .select()
        .from(gameStateSnapshots)
        .where(inArray(gameStateSnapshots.campaignId, ids)),
      db
        .select()
        .from(campaignMembers)
        .where(
          and(
            inArray(campaignMembers.campaignId, ids),
            eq(campaignMembers.guestId, guestId),
          ),
        ),
      db
        .select({
          ownerGuestId: adventurePacks.ownerGuestId,
          slug: adventurePacks.slug,
          pack: adventurePacks.pack,
        })
        .from(adventurePacks)
        .where(inArray(adventurePacks.ownerGuestId, ownerGuestIds)),
    ]);

    const snapByCampaign = new Map(snapshots.map((s) => [s.campaignId, s]));
    const roleByCampaign = new Map(
      memberRoles.map((m) => [m.campaignId, m.role]),
    );
    const customPackByOwnerAndSlug = new Map(
      customPackRows.map((p) => [`${p.ownerGuestId}:${p.slug}`, p.pack]),
    );

    return {
      items: rows.map((c) => {
        const snap = snapByCampaign.get(c.id);
        const pack =
          getBuiltinAdventurePack(c.adventureId) ??
          customPackByOwnerAndSlug.get(`${c.ownerGuestId}:${c.adventureId}`) ??
          getFallbackAdventurePack();
        const sceneId = snap?.sceneId ?? pack.initialSceneId;
        const scene = pack.scenes[sceneId];
        return {
          campaignId: c.id,
          title: c.title,
          adventureId: c.adventureId,
          ruleset: c.ruleset,
          sceneId,
          ...(scene
            ? { sceneTitleEs: scene.shortLabelEs ?? scene.titleEs }
            : {}),
          lastSeq: snap?.lastSeq ?? 0,
          role:
            c.ownerGuestId === guestId
              ? "owner"
              : (roleByCampaign.get(c.id) ?? "player"),
          updatedAt: c.updatedAt.toISOString(),
        };
      }),
      total: Number(countRow?.count ?? 0),
      limit,
      offset,
    };
  }

  async addCampaignMember(
    campaignId: string,
    ownerGuestId: string,
    memberGuestId: string,
    role = "player",
  ): Promise<boolean> {
    if (!UUID_REGEX.test(campaignId)) {
      return false;
    }
    const db = getDb();
    const [campaign] = await db
      .select({ id: campaigns.id, ownerGuestId: campaigns.ownerGuestId })
      .from(campaigns)
      .where(
        and(eq(campaigns.id, campaignId), eq(campaigns.ownerGuestId, ownerGuestId)),
      )
      .limit(1);

    if (!campaign) {
      return false;
    }

    await db
      .insert(campaignMembers)
      .values({
        campaignId,
        guestId: memberGuestId,
        characterId: null,
        role,
      })
      .onConflictDoNothing({
        target: [campaignMembers.campaignId, campaignMembers.guestId],
      });

    return true;
  }

  async deleteCampaign(campaignId: string, guestId: string): Promise<boolean> {
    if (!UUID_REGEX.test(campaignId)) {
      return false;
    }
    const db = getDb();
    const deleted = await db
      .delete(campaigns)
      .where(
        and(eq(campaigns.id, campaignId), eq(campaigns.ownerGuestId, guestId)),
      )
      .returning({ id: campaigns.id });

    return deleted.length > 0;
  }

  async deleteAllCampaignsForGuest(
    guestId: string,
    options?: { exceptCampaignId?: string },
  ): Promise<number> {
    const db = getDb();
    const rawExcept = options?.exceptCampaignId?.trim();
    const validExceptId =
      rawExcept && UUID_REGEX.test(rawExcept) ? rawExcept : undefined;
    const whereClause = validExceptId
      ? and(
          eq(campaigns.ownerGuestId, guestId),
          ne(campaigns.id, validExceptId),
        )
      : eq(campaigns.ownerGuestId, guestId);

    const deleted = await db
      .delete(campaigns)
      .where(whereClause)
      .returning({ id: campaigns.id });

    return deleted.length;
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
      .where(eq(campaigns.id, campaignId))
      .limit(1);

    if (!campaign) {
      return null;
    }

    if (campaign.ownerGuestId !== guestId) {
      const [member] = await db
        .select({ id: campaignMembers.id })
        .from(campaignMembers)
        .where(
          and(
            eq(campaignMembers.campaignId, campaignId),
            eq(campaignMembers.guestId, guestId),
          ),
        )
        .limit(1);
      if (!member) {
        return null;
      }
    }

    const sessionRows = await db
      .select()
      .from(sessions)
      .where(eq(sessions.campaignId, campaign.id))
      .orderBy(asc(sessions.sessionNumber));

    const activeSession = sessionRows.at(-1);
    if (!activeSession) {
      return null;
    }

    const [charRows, eventRows, messageRows, factRows] = await Promise.all([
      db
        .select()
        .from(characters)
        .where(eq(characters.campaignId, campaign.id)),
      db
        .select()
        .from(eventLog)
        .where(eq(eventLog.campaignId, campaign.id))
        .orderBy(asc(eventLog.seq)),
      db
        .select()
        .from(messages)
        .where(
          and(
            eq(messages.campaignId, campaign.id),
            isNull(messages.revertedBySeq),
          ),
        )
        .orderBy(asc(messages.createdAt)),
      db
        .select()
        .from(memoryFacts)
        .where(
          and(
            eq(memoryFacts.campaignId, campaign.id),
            isNull(memoryFacts.revertedBySeq),
          ),
        )
        .orderBy(desc(memoryFacts.importance), desc(memoryFacts.eventSeq)),
    ]);

    const pack =
      (await this.getAdventurePack(campaign.adventureId, campaign.ownerGuestId)) ??
      getFallbackAdventurePack();
    const initialState = buildInitialFromRows({
      campaign,
      session: activeSession,
      characterRows: charRows,
      adventurePack: pack,
    });
    const events = eventRows.map(mapEventRow);
    const state = reduceEvents(initialState, events);

    return {
      campaignId: campaign.id,
      sessionId: activeSession.id,
      sessionNumber: activeSession.sessionNumber,
      title: campaign.title,
      adventureId: campaign.adventureId,
      adventurePack: pack,
      ruleset: campaign.ruleset,
      worldSummary: campaign.worldSummary,
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
      sessionSummaries: sessionRows.map((s) => ({
        id: s.id,
        sessionNumber: s.sessionNumber,
        summary: s.summary,
        startedAt: s.startedAt.toISOString(),
        endedAt: s.endedAt ? s.endedAt.toISOString() : null,
      })),
      memoryFacts: factRows.map(mapMemoryFactRow),
    };
  }

  async startNewSession(
    campaignId: string,
    guestId: string,
    options?: { closingSummary?: string; worldSummary?: string },
  ): Promise<LoadedCampaign | null> {
    const loaded = await this.loadCampaign(campaignId, guestId);
    if (!loaded) {
      return null;
    }

    const db = getDb();
    const now = new Date();
    const nextSessionId = randomUUID();
    const closingSummary =
      options?.closingSummary?.trim() ||
      `Sesión #${loaded.sessionNumber} cerrada en escena ${loaded.state.sceneId} (seq ${loaded.state.lastSeq}).`;

    await db.transaction(async (tx) => {
      await tx
        .update(sessions)
        .set({
          summary: closingSummary,
          endedAt: now,
        })
        .where(eq(sessions.id, loaded.sessionId));

      await tx
        .update(campaigns)
        .set({
          updatedAt: now,
          ...(options?.worldSummary !== undefined
            ? { worldSummary: options.worldSummary }
            : {}),
        })
        .where(eq(campaigns.id, campaignId));

      await tx.insert(sessions).values({
        id: nextSessionId,
        campaignId,
        sessionNumber: loaded.sessionNumber + 1,
        summary: "",
        startedAt: now,
      });
    });

    return this.loadCampaign(campaignId, guestId);
  }

  async seedOpeningIntro(
    campaignId: string,
    guestId: string,
  ): Promise<LoadedCampaign | null> {
    const loaded = await this.loadCampaign(campaignId, guestId);
    if (!loaded) {
      return null;
    }
    if (loaded.messages.length > 0) {
      return loaded;
    }

    const introParts = buildSeededIntroParts(loaded.state, loaded.adventurePack);
    const db = getDb();
    await db.insert(messages).values({
      campaignId: loaded.campaignId,
      sessionId: loaded.sessionId,
      role: "assistant",
      parts: introParts,
      eventSeq: 0,
      createdAt: new Date(),
    });

    return this.loadCampaign(campaignId, guestId);
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
          if (expectedSeq !== undefined && expectedSeq !== currentMax) {
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
        if (isUniqueSeqViolation(err)) {
          if (expectedSeq !== undefined) {
            throw new StaleSeqError(expectedSeq, expectedSeq + 1);
          }
          if (!retriedUniqueConflict) {
            retriedUniqueConflict = true;
            continue;
          }
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

      await tx
        .update(memoryFacts)
        .set({ revertedBySeq: rb.rollbackEvent.seq })
        .where(
          and(
            eq(memoryFacts.campaignId, campaignId),
            gt(memoryFacts.eventSeq, targetSeq),
            isNull(memoryFacts.revertedBySeq),
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

  async updateTableMode(
    campaignId: string,
    guestId: string,
    mode: "digital" | "hybrid",
  ): Promise<LoadedCampaign | null> {
    const loaded = await this.loadCampaign(campaignId, guestId);
    if (!loaded) {
      return null;
    }

    const rollAuth = mode === "hybrid" ? "player-declared" : "engine-rolled";
    const auth = createDefaultAuthority(mode);
    const updatedCharsRecord: Record<string, Character> = {};
    for (const [id, char] of Object.entries(loaded.initialState.characters)) {
      updatedCharsRecord[id] = {
        ...char,
        authority: auth,
        rollAuthority: rollAuth,
      };
    }

    const updatedInitial: GameState = {
      ...loaded.initialState,
      characters: updatedCharsRecord,
    };
    const nextState = reduceEvents(updatedInitial, loaded.events);

    const db = getDb();
    await db.transaction(async (tx) => {
      for (const updatedChar of Object.values(updatedCharsRecord)) {
        await tx
          .update(characters)
          .set({
            sheet: updatedChar,
            updatedAt: new Date(),
          })
          .where(
            and(
              eq(characters.campaignId, campaignId),
              eq(characters.actorId, updatedChar.id),
            ),
          );
      }

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

  async saveMemoryFacts(
    campaignId: string,
    sessionId: string,
    facts: SaveMemoryFactInput[],
  ): Promise<StoredMemoryFact[]> {
    if (facts.length === 0) return [];
    const db = getDb();
    const existingRows = await db
      .select({
        content: memoryFacts.content,
        eventSeq: memoryFacts.eventSeq,
      })
      .from(memoryFacts)
      .where(
        and(
          eq(memoryFacts.campaignId, campaignId),
          isNull(memoryFacts.revertedBySeq),
        ),
      );

    const seen = new Set(
      existingRows.map((r) => `${r.eventSeq}::${r.content}`),
    );
    const toInsert: Array<{
      campaignId: string;
      sessionId: string;
      category: string;
      content: string;
      importance: number;
      eventSeq: number;
      source: string;
    }> = [];

    for (const fact of facts) {
      const content = fact.content.trim();
      if (!content) continue;
      const eventSeq = Math.max(0, Math.trunc(fact.eventSeq));
      const dedupeKey = `${eventSeq}::${content}`;
      if (seen.has(dedupeKey)) continue;
      seen.add(dedupeKey);
      toInsert.push({
        campaignId,
        sessionId,
        category: fact.category,
        content,
        importance: Math.min(10, Math.max(1, Math.trunc(fact.importance ?? 5))),
        eventSeq,
        source: fact.source ?? "engine",
      });
    }

    if (toInsert.length === 0) return [];
    const inserted = await db.insert(memoryFacts).values(toInsert).returning();
    return inserted.map(mapMemoryFactRow);
  }
}

interface InMemoryCampaignRecord {
  ownerGuestId: string;
  members: Array<{ guestId: string; role: string }>;
  campaignId: string;
  sessionId: string;
  sessionNumber: number;
  title: string;
  adventureId: string;
  adventurePack: AdventurePack;
  ruleset: RulesetProfile;
  worldSummary: string;
  initialState: GameState;
  state: GameState;
  logHeadSeq: number;
  events: GameEvent[];
  messages: StoredMessage[];
  sessions: SessionSummaryItem[];
  memoryFacts: StoredMemoryFact[];
  createdAtMs: number;
  updatedAt: string;
}

/**
 * Deterministic in-memory GameStore for unit/integration tests without Postgres.
 */
export class InMemoryGameStore implements GameStore {
  private campaigns = new Map<string, InMemoryCampaignRecord>();
  private packs = new Map<
    string,
    Map<string, { pack: AdventurePack; updatedAt: string }>
  >();

  async upsertAdventurePack(
    guestId: string,
    pack: AdventurePack,
  ): Promise<AdventurePackSummary> {
    let userPacks = this.packs.get(guestId);
    if (!userPacks) {
      userPacks = new Map();
      this.packs.set(guestId, userPacks);
    }
    const updatedAt = new Date().toISOString();
    userPacks.set(pack.id, { pack, updatedAt });
    return summarizeAdventurePack(pack, { builtin: false, updatedAt });
  }

  async listAdventurePacks(guestId: string): Promise<AdventurePackSummary[]> {
    const userPacks = this.packs.get(guestId);
    const custom = userPacks
      ? Array.from(userPacks.values())
          .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
          .map(({ pack, updatedAt }) =>
            summarizeAdventurePack(pack, { builtin: false, updatedAt }),
          )
      : [];
    return [...listBuiltinAdventurePackSummaries(), ...custom];
  }

  async getAdventurePack(
    id: string,
    guestId: string,
  ): Promise<AdventurePack | null> {
    const builtin = getBuiltinAdventurePack(id);
    if (builtin) return builtin;
    return this.packs.get(guestId)?.get(id)?.pack ?? null;
  }

  async deleteAdventurePack(slug: string, guestId: string): Promise<boolean> {
    const userPacks = this.packs.get(guestId);
    if (!userPacks) return false;
    return userPacks.delete(slug);
  }

  private hasAccess(record: InMemoryCampaignRecord, guestId: string): boolean {
    return (
      record.ownerGuestId === guestId ||
      record.members.some((m) => m.guestId === guestId)
    );
  }

  private getRole(record: InMemoryCampaignRecord, guestId: string): string {
    if (record.ownerGuestId === guestId) return "owner";
    return record.members.find((m) => m.guestId === guestId)?.role ?? "player";
  }

  async createCampaign(input: CreateCampaignInput): Promise<LoadedCampaign> {
    const campaignId = randomUUID();
    const sessionId = randomUUID();
    const party = normalizePartyInput(input);
    const mode = input.mode === "hybrid" ? "hybrid" : "digital";
    const requestedAdventureId = input.adventureId?.trim() || "aguas-quietas";
    const resolvedPack = await this.getAdventurePack(
      requestedAdventureId,
      input.guestId,
    );
    if (!resolvedPack && input.adventureId?.trim()) {
      throw new Error(`ADVENTURE_PACK_NOT_FOUND:${requestedAdventureId}`);
    }
    const pack = resolvedPack ?? getFallbackAdventurePack();
    const ruleset: RulesetProfile =
      input.ruleset === "5e-full" || input.ruleset === "5e-lite"
        ? input.ruleset
        : pack.recommendedRuleset;
    const title = input.title?.trim() || pack.titleEs;
    const worldSummary = pack.worldSummaryEs;

    const initialState = buildInitialPartyCampaignState({
      campaignId,
      sessionId,
      party,
      mode,
      ruleset,
      adventurePack: pack,
    });
    const nowIso = new Date().toISOString();

    const record: InMemoryCampaignRecord = {
      ownerGuestId: input.guestId,
      members: [{ guestId: input.guestId, role: "owner" }],
      campaignId,
      sessionId,
      sessionNumber: 1,
      title,
      adventureId: pack.id,
      adventurePack: pack,
      ruleset,
      worldSummary,
      initialState,
      state: initialState,
      logHeadSeq: 0,
      events: [],
      messages: [],
      sessions: [
        {
          id: sessionId,
          sessionNumber: 1,
          summary: "",
          startedAt: nowIso,
          endedAt: null,
        },
      ],
      memoryFacts: [],
      createdAtMs: Date.now(),
      updatedAt: nowIso,
    };
    this.campaigns.set(campaignId, record);
    return (await this.loadCampaign(campaignId, input.guestId))!;
  }

  async getLatestCampaignForGuest(
    guestId: string,
  ): Promise<LoadedCampaign | null> {
    const list = Array.from(this.campaigns.values()).filter((c) =>
      this.hasAccess(c, guestId),
    );
    const latest = list.at(-1);
    if (!latest) return null;
    return this.loadCampaign(latest.campaignId, guestId);
  }

  async listCampaignsForGuest(
    guestId: string,
    options?: { limit?: number; offset?: number },
  ): Promise<PaginatedCampaignList> {
    const limit = Math.min(50, Math.max(1, Math.trunc(options?.limit ?? 20)));
    const offset = Math.max(0, Math.trunc(options?.offset ?? 0));
    const accessible = Array.from(this.campaigns.values())
      .filter((c) => this.hasAccess(c, guestId))
      .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));

    const slice = accessible.slice(offset, offset + limit);
    return {
      items: slice.map((c) => {
        const scene = c.adventurePack.scenes[c.state.sceneId];
        return {
          campaignId: c.campaignId,
          title: c.title,
          adventureId: c.adventureId,
          ruleset: c.ruleset,
          sceneId: c.state.sceneId,
          ...(scene
            ? { sceneTitleEs: scene.shortLabelEs ?? scene.titleEs }
            : {}),
          lastSeq: c.state.lastSeq,
          role: this.getRole(c, guestId),
          updatedAt: c.updatedAt,
        };
      }),
      total: accessible.length,
      limit,
      offset,
    };
  }

  async addCampaignMember(
    campaignId: string,
    ownerGuestId: string,
    memberGuestId: string,
    role = "player",
  ): Promise<boolean> {
    const found = this.campaigns.get(campaignId);
    if (!found || found.ownerGuestId !== ownerGuestId) {
      return false;
    }
    if (!found.members.some((m) => m.guestId === memberGuestId)) {
      found.members.push({ guestId: memberGuestId, role });
    }
    return true;
  }

  async deleteCampaign(campaignId: string, guestId: string): Promise<boolean> {
    const found = this.campaigns.get(campaignId);
    if (!found || found.ownerGuestId !== guestId) {
      return false;
    }
    return this.campaigns.delete(campaignId);
  }

  async deleteAllCampaignsForGuest(
    guestId: string,
    options?: { exceptCampaignId?: string },
  ): Promise<number> {
    const rawExcept = options?.exceptCampaignId?.trim();
    const validExceptId =
      rawExcept && UUID_REGEX.test(rawExcept) ? rawExcept : undefined;
    let deletedCount = 0;
    for (const [id, record] of Array.from(this.campaigns.entries())) {
      if (record.ownerGuestId !== guestId) continue;
      if (validExceptId && id === validExceptId) continue;
      this.campaigns.delete(id);
      deletedCount += 1;
    }
    return deletedCount;
  }

  async loadCampaign(
    campaignId: string,
    guestId: string,
  ): Promise<LoadedCampaign | null> {
    const found = this.campaigns.get(campaignId);
    if (!found || !this.hasAccess(found, guestId)) {
      return null;
    }
    const activeInitial: GameState = {
      ...found.initialState,
      sessionId: found.sessionId,
    };
    return {
      campaignId: found.campaignId,
      sessionId: found.sessionId,
      sessionNumber: found.sessionNumber,
      title: found.title,
      adventureId: found.adventureId,
      adventurePack: found.adventurePack,
      ruleset: found.ruleset,
      worldSummary: found.worldSummary,
      initialState: activeInitial,
      state: reduceEvents(activeInitial, found.events),
      logHeadSeq: computeLogHeadSeq(found.events),
      events: found.events.map((e) => ({ ...e })),
      messages: found.messages
        .filter((m) => m.revertedBySeq == null)
        .map((m) => ({ ...m })),
      sessionSummaries: found.sessions.map((s) => ({ ...s })),
      memoryFacts: sortMemoryFacts(
        found.memoryFacts.filter((f) => f.revertedBySeq == null),
      ).map((f) => ({ ...f })),
    };
  }

  async startNewSession(
    campaignId: string,
    guestId: string,
    options?: { closingSummary?: string; worldSummary?: string },
  ): Promise<LoadedCampaign | null> {
    const found = this.campaigns.get(campaignId);
    if (!found || !this.hasAccess(found, guestId)) {
      return null;
    }
    const nowIso = new Date().toISOString();
    const currentSession = found.sessions.at(-1);
    if (currentSession) {
      currentSession.endedAt = nowIso;
      currentSession.summary =
        options?.closingSummary?.trim() ||
        `Sesión #${found.sessionNumber} cerrada en escena ${found.state.sceneId} (seq ${found.state.lastSeq}).`;
    }
    if (options?.worldSummary !== undefined) {
      found.worldSummary = options.worldSummary;
    }
    const nextSessionNumber = found.sessionNumber + 1;
    const nextSessionId = randomUUID();
    found.sessionId = nextSessionId;
    found.sessionNumber = nextSessionNumber;
    found.updatedAt = nowIso;
    found.sessions.push({
      id: nextSessionId,
      sessionNumber: nextSessionNumber,
      summary: "",
      startedAt: nowIso,
      endedAt: null,
    });
    return this.loadCampaign(campaignId, guestId);
  }

  async seedOpeningIntro(
    campaignId: string,
    guestId: string,
  ): Promise<LoadedCampaign | null> {
    const found = this.campaigns.get(campaignId);
    if (!found || !this.hasAccess(found, guestId)) {
      return null;
    }
    const activeMessages = found.messages.filter((m) => m.revertedBySeq == null);
    if (activeMessages.length > 0) {
      return this.loadCampaign(campaignId, guestId);
    }

    const loaded = (await this.loadCampaign(campaignId, guestId))!;
    const introParts = buildSeededIntroParts(loaded.state, loaded.adventurePack);
    found.messages.push({
      id: randomUUID(),
      role: "assistant",
      parts: introParts,
      createdAt: new Date().toISOString(),
      eventSeq: 0,
      revertedBySeq: null,
    });
    return this.loadCampaign(campaignId, guestId);
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
    found.updatedAt = new Date().toISOString();
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
    stored.updatedAt = new Date().toISOString();
    for (const msg of stored.messages) {
      if (
        msg.eventSeq != null &&
        msg.eventSeq > targetSeq &&
        msg.revertedBySeq == null
      ) {
        msg.revertedBySeq = rb.rollbackEvent.seq;
      }
    }
    for (const fact of stored.memoryFacts) {
      if (fact.eventSeq > targetSeq && fact.revertedBySeq == null) {
        fact.revertedBySeq = rb.rollbackEvent.seq;
      }
    }
    return rb;
  }

  async updateTableMode(
    campaignId: string,
    guestId: string,
    mode: "digital" | "hybrid",
  ): Promise<LoadedCampaign | null> {
    const found = this.campaigns.get(campaignId);
    if (!found || !this.hasAccess(found, guestId)) return null;

    const rollAuth = mode === "hybrid" ? "player-declared" : "engine-rolled";
    const auth = createDefaultAuthority(mode);
    const updatedChars: Record<string, Character> = {};
    for (const [id, char] of Object.entries(found.initialState.characters)) {
      updatedChars[id] = {
        ...char,
        authority: auth,
        rollAuthority: rollAuth,
      };
    }

    found.initialState = {
      ...found.initialState,
      characters: updatedChars,
    };
    found.state = reduceEvents(found.initialState, found.events);
    found.logHeadSeq = computeLogHeadSeq(found.events);
    found.updatedAt = new Date().toISOString();
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

  async saveMemoryFacts(
    campaignId: string,
    sessionId: string,
    facts: SaveMemoryFactInput[],
  ): Promise<StoredMemoryFact[]> {
    const found = this.campaigns.get(campaignId);
    if (!found || facts.length === 0) return [];
    const seen = new Set(
      found.memoryFacts
        .filter((f) => f.revertedBySeq == null)
        .map((f) => `${f.eventSeq}::${f.content}`),
    );
    const created: StoredMemoryFact[] = [];
    const now = new Date().toISOString();

    for (const fact of facts) {
      const content = fact.content.trim();
      if (!content) continue;
      const eventSeq = Math.max(0, Math.trunc(fact.eventSeq));
      const dedupeKey = `${eventSeq}::${content}`;
      if (seen.has(dedupeKey)) continue;
      seen.add(dedupeKey);
      const row: StoredMemoryFact = {
        id: randomUUID(),
        campaignId,
        sessionId,
        category: fact.category,
        content,
        importance: Math.min(10, Math.max(1, Math.trunc(fact.importance ?? 5))),
        eventSeq,
        revertedBySeq: null,
        source: fact.source ?? "engine",
        createdAt: now,
      };
      found.memoryFacts.push(row);
      created.push({ ...row });
    }
    return created;
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
