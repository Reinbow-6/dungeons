import { z } from 'zod';
import {
  CombatStateSchema,
  Condition5eSchema,
  VisibilitySchema,
  type Character,
  type CombatState,
  type Condition5e,
  type GameState,
} from './types.js';

export const EventSourceSchema = z.enum([
  'engine',
  'player-declared',
  'imported',
]);
export type EventSource = z.infer<typeof EventSourceSchema>;

export const EventTypeSchema = z.enum([
  'CHECK_RESOLVED',
  'SAVE_RESOLVED',
  'CLUES_UNLOCKED',
  'SCENE_TRANSITION',
  'DAMAGE_APPLIED',
  'CONDITION_CHANGED',
  'INVENTORY_CHANGED',
  'COMBAT_STARTED',
  'COMBAT_ATTACK',
  'COMBAT_TURN_ADVANCED',
  'COMBAT_ENDED',
  'ROLLBACK',
]);
export type EventType = z.infer<typeof EventTypeSchema>;

export const GameStateDeltaSchema = z.object({
  sceneId: z.string().min(1).optional(),
  flagsSet: z
    .record(z.union([z.boolean(), z.string(), z.number()]))
    .optional(),
  hpChanges: z
    .array(
      z.object({
        actorId: z.string().min(1),
        before: z.number().int().min(0),
        after: z.number().int().min(0),
      }),
    )
    .optional(),
  tempHpChanges: z
    .array(
      z.object({
        actorId: z.string().min(1),
        before: z.number().int().min(0),
        after: z.number().int().min(0),
      }),
    )
    .optional(),
  conditionsAdded: z
    .array(
      z.object({
        actorId: z.string().min(1),
        condition: Condition5eSchema,
      }),
    )
    .optional(),
  conditionsRemoved: z
    .array(
      z.object({
        actorId: z.string().min(1),
        condition: Condition5eSchema,
      }),
    )
    .optional(),
  inventoryDelta: z
    .array(
      z.object({
        actorId: z.string().min(1),
        itemId: z.string().min(1),
        name: z.string().min(1).optional(),
        qtyDelta: z.number().int(),
      }),
    )
    .optional(),
  cluesUnlocked: z.array(z.string().min(1)).optional(),
  combat: CombatStateSchema.nullable().optional(),
});
export type GameStateDelta = z.infer<typeof GameStateDeltaSchema>;

export const GameEventSchema = z.object({
  id: z.string().min(1),
  campaignId: z.string().min(1),
  sessionId: z.string().min(1),
  seq: z.number().int().positive(),
  type: EventTypeSchema,
  source: EventSourceSchema,
  visibility: VisibilitySchema,
  actor: z.string().min(1),
  checkId: z.string().nullable(),
  declaredTotal: z.number().int().nullable(),
  dieResults: z.array(z.number().int().min(1).max(20)).nullable(),
  payload: z.record(z.unknown()),
  stateDelta: GameStateDeltaSchema,
  revertedByEventId: z.string().nullable(),
  createdAt: z.string().min(1),
});
export type GameEvent = z.infer<typeof GameEventSchema>;

function cloneCharacter(char: Character): Character {
  return {
    ...char,
    abilities: { ...char.abilities },
    skillProficiencies: { ...char.skillProficiencies },
    savingThrowProficiencies: [...char.savingThrowProficiencies],
    hp: { ...char.hp },
    conditions: [...char.conditions],
    inventory: char.inventory.map((item) => ({ ...item })),
    spellSlots: Object.fromEntries(
      Object.entries(char.spellSlots).map(([lvl, pool]) => [lvl, { ...pool }]),
    ),
    authority: { ...char.authority },
  };
}

function cloneCombatState(combat: CombatState): CombatState {
  return {
    active: combat.active,
    round: combat.round,
    turnIndex: combat.turnIndex,
    combatants: combat.combatants.map((c) => ({
      ...c,
      hp: { ...c.hp },
      attacks: c.attacks.map((a) => ({ ...a })),
      vulnerabilities: [...c.vulnerabilities],
      immunities: [...c.immunities],
    })),
  };
}

/**
 * Pure, immutable state transition applying a deterministic `GameStateDelta`.
 */
export function applyDelta(
  state: GameState,
  delta: GameStateDelta,
  seq: number,
): GameState {
  const nextSceneId = delta.sceneId ?? state.sceneId;
  const nextFlags = delta.flagsSet
    ? { ...state.flags, ...delta.flagsSet }
    : { ...state.flags };

  let nextCharacters = state.characters;
  const needsCharacterCopy =
    (delta.hpChanges && delta.hpChanges.length > 0) ||
    (delta.tempHpChanges && delta.tempHpChanges.length > 0) ||
    (delta.conditionsAdded && delta.conditionsAdded.length > 0) ||
    (delta.conditionsRemoved && delta.conditionsRemoved.length > 0) ||
    (delta.inventoryDelta && delta.inventoryDelta.length > 0);

  if (needsCharacterCopy) {
    nextCharacters = { ...state.characters };
    const ensureCloned = (actorId: string): Character | undefined => {
      const current = nextCharacters[actorId];
      if (!current) return undefined;
      if (current === state.characters[actorId]) {
        const cloned = cloneCharacter(current);
        nextCharacters[actorId] = cloned;
        return cloned;
      }
      return current;
    };

    for (const change of delta.hpChanges ?? []) {
      const char = ensureCloned(change.actorId);
      if (char) {
        char.hp.current = Math.max(0, Math.min(char.hp.max, change.after));
      }
    }

    for (const change of delta.tempHpChanges ?? []) {
      const char = ensureCloned(change.actorId);
      if (char) {
        char.hp.temp = Math.max(0, change.after);
      }
    }

    for (const added of delta.conditionsAdded ?? []) {
      const char = ensureCloned(added.actorId);
      if (char && !char.conditions.includes(added.condition as Condition5e)) {
        char.conditions.push(added.condition as Condition5e);
        if (added.condition === 'exhaustion' && char.exhaustionLevel === 0) {
          char.exhaustionLevel = 1;
        }
      }
    }

    for (const removed of delta.conditionsRemoved ?? []) {
      const char = ensureCloned(removed.actorId);
      if (char) {
        char.conditions = char.conditions.filter((c) => c !== removed.condition);
        if (removed.condition === 'exhaustion') {
          char.exhaustionLevel = 0;
        }
      }
    }

    for (const inv of delta.inventoryDelta ?? []) {
      const char = ensureCloned(inv.actorId);
      if (!char) continue;
      const existingIdx = char.inventory.findIndex(
        (item) => item.itemId === inv.itemId,
      );
      if (existingIdx >= 0) {
        const existing = char.inventory[existingIdx];
        if (!existing) continue;
        const nextQty = existing.quantity + inv.qtyDelta;
        if (nextQty <= 0) {
          char.inventory.splice(existingIdx, 1);
        } else {
          existing.quantity = nextQty;
        }
      } else if (inv.qtyDelta > 0) {
        char.inventory.push({
          itemId: inv.itemId,
          name: inv.name ?? inv.itemId,
          quantity: inv.qtyDelta,
        });
      }
    }
  }

  const nextUnlockedClues: Record<string, string[]> = Object.fromEntries(
    Object.entries(state.unlockedClues).map(([k, list]) => [k, [...list]]),
  );

  if (delta.cluesUnlocked && delta.cluesUnlocked.length > 0) {
    const existing = nextUnlockedClues[nextSceneId] ?? [];
    const seen = new Set(existing);
    for (const clueId of delta.cluesUnlocked) {
      if (!seen.has(clueId)) {
        seen.add(clueId);
        existing.push(clueId);
      }
    }
    nextUnlockedClues[nextSceneId] = existing;
  }

  let nextCombat: CombatState | null | undefined;
  if (delta.combat !== undefined) {
    nextCombat = delta.combat ? cloneCombatState(delta.combat) : null;
  } else if (state.combat !== undefined) {
    nextCombat = state.combat ? cloneCombatState(state.combat) : null;
    if (nextCombat && nextCombat.active && delta.hpChanges && delta.hpChanges.length > 0) {
      for (const change of delta.hpChanges) {
        const combatant = nextCombat.combatants.find(
          (c) => c.actorId === change.actorId || c.id === change.actorId,
        );
        if (combatant) {
          const clampedHp = Math.max(0, Math.min(combatant.hp.max, change.after));
          combatant.hp.current = clampedHp;
          combatant.defeated = clampedHp <= 0;
        }
      }
    }
  }

  const nextState: GameState = {
    ...state,
    sceneId: nextSceneId,
    lastSeq: seq,
    characters: nextCharacters,
    flags: nextFlags,
    unlockedClues: nextUnlockedClues,
  };

  if (nextCombat !== undefined) {
    nextState.combat = nextCombat;
  }

  return nextState;
}

/**
 * Deterministic event-sourced replay: rebuilds `GameState` from active events.
 */
export function reduceEvents(
  initialState: GameState,
  events: readonly GameEvent[],
): GameState {
  const active = events
    .filter((e) => e.revertedByEventId === null && e.type !== 'ROLLBACK')
    .slice()
    .sort((a, b) => a.seq - b.seq);

  let current = initialState;
  for (const event of active) {
    current = applyDelta(current, event.stateDelta, event.seq);
  }
  return current;
}

export type RollbackResult =
  | {
      ok: true;
      rollbackEvent: GameEvent;
      events: GameEvent[];
      state: GameState;
    }
  | {
      ok: false;
      code: 'INVALID_TARGET_SEQ';
      messageEs: string;
    };

export interface RollbackContext {
  createId: () => string;
  now: () => string;
  actor?: string;
}

/**
 * Reverts campaign state back to `targetSeq` by marking subsequent events with
 * `revertedByEventId`, appending an auditable `ROLLBACK` event, and replaying.
 */
export function rollbackToSeq(
  initialState: GameState,
  events: readonly GameEvent[],
  targetSeq: number,
  ctx: RollbackContext,
): RollbackResult {
  const activeNonRollback = events.filter(
    (e) => e.revertedByEventId === null && e.type !== 'ROLLBACK',
  );
  const maxActiveSeq = activeNonRollback.reduce(
    (max, e) => (e.seq > max ? e.seq : max),
    0,
  );

  if (
    !Number.isInteger(targetSeq) ||
    targetSeq < 0 ||
    targetSeq > maxActiveSeq
  ) {
    return {
      ok: false,
      code: 'INVALID_TARGET_SEQ',
      messageEs: `Secuencia de rollback inválida (${targetSeq}). Rango permitido: 0..${maxActiveSeq}.`,
    };
  }

  const maxAllSeq = events.reduce((max, e) => (e.seq > max ? e.seq : max), 0);
  const rollbackId = ctx.createId();
  const revertedEventIds: string[] = [];

  const updatedEvents: GameEvent[] = events.map((event) => {
    if (
      event.revertedByEventId === null &&
      event.type !== 'ROLLBACK' &&
      event.seq > targetSeq
    ) {
      revertedEventIds.push(event.id);
      return {
        ...event,
        revertedByEventId: rollbackId,
      };
    }
    return event;
  });

  const rollbackEvent: GameEvent = {
    id: rollbackId,
    campaignId: initialState.campaignId,
    sessionId: initialState.sessionId,
    seq: maxAllSeq + 1,
    type: 'ROLLBACK',
    source: 'engine',
    visibility: 'public',
    actor: ctx.actor ?? 'system',
    checkId: null,
    declaredTotal: null,
    dieResults: null,
    payload: {
      targetSeq,
      revertedEventIds,
    },
    stateDelta: {},
    revertedByEventId: null,
    createdAt: ctx.now(),
  };

  const nextEvents = [...updatedEvents, rollbackEvent];
  const state = reduceEvents(initialState, nextEvents);

  return {
    ok: true,
    rollbackEvent,
    events: nextEvents,
    state,
  };
}
