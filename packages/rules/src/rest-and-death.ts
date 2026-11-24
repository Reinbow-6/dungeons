import { z } from 'zod';
import {
  applyDelta,
  type GameEvent,
  type GameStateDelta,
} from './events.js';
import {
  getAbilityModifier,
  getCheckModifier,
  getConditionPenalty,
} from './modifiers.js';
import type { ResolverContext } from './resolvers.js';
import {
  RollModeSchema,
  rollD20,
  rollDice,
  RulesError,
} from './rng.js';
import {
  VisibilitySchema,
  type Character,
  type DeathSaves,
  type GameState,
  type HitDieType,
} from './types.js';

function inferHitDie(character: Character): { die: HitDieType; current: number; max: number } {
  if (character.hitDice) {
    return { ...character.hitDice };
  }
  const cls = character.className.toLowerCase();
  let die: HitDieType = 'd8';
  if (cls.includes('bárb') || cls.includes('barb')) die = 'd12';
  else if (
    cls.includes('guerr') ||
    cls.includes('fight') ||
    cls.includes('explor') ||
    cls.includes('rang') ||
    cls.includes('palad')
  ) {
    die = 'd10';
  } else if (cls.includes('mag') || cls.includes('wiz') || cls.includes('hech') || cls.includes('sorc')) {
    die = 'd6';
  }
  const max = Math.max(1, character.level);
  return { die, current: max, max };
}

// ---------- take_rest ----------

export const ResolveTakeRestInputSchema = z
  .object({
    sceneId: z.string().min(1),
    actorId: z.string().min(1),
    restType: z.enum(['short', 'long']),
    hitDiceToSpend: z.number().int().min(0).max(20).optional(),
    visibility: VisibilitySchema.optional(),
  })
  .strict();
export type ResolveTakeRestInput = z.infer<typeof ResolveTakeRestInputSchema>;

export type TakeRestErrorCode =
  | 'INVALID_INPUT'
  | 'INVALID_SCENE'
  | 'UNKNOWN_ACTOR'
  | 'IN_COMBAT';

export type ResolveTakeRestResult =
  | {
      ok: true;
      actorId: string;
      actorName: string;
      restType: 'short' | 'long';
      hpBefore: number;
      hpAfter: number;
      hpHealed: number;
      hitDiceSpent: number;
      hitDiceRolls: number[];
      hitDiceAfter: { die: HitDieType; current: number; max: number };
      slotsRestored: boolean;
      exhaustionBefore: number;
      exhaustionAfter: number;
      event: GameEvent;
      nextState: GameState;
    }
  | {
      ok: false;
      code: TakeRestErrorCode;
      messageEs: string;
    };

interface CharacterRestOutcome {
  actorId: string;
  actorName: string;
  hpBefore: number;
  hpAfter: number;
  hpHealed: number;
  hitDiceSpent: number;
  hitDiceRolls: number[];
  hitDiceAfter: { die: HitDieType; current: number; max: number };
  slotsRestored: boolean;
  exhaustionBefore: number;
  exhaustionAfter: number;
  delta: GameStateDelta;
}

function computeCharacterRestOutcome(
  actor: Character,
  restType: 'short' | 'long',
  hitDiceToSpend: number | undefined,
  rng: ResolverContext['rng'],
): CharacterRestOutcome {
  const poolBefore = inferHitDie(actor);
  const hpBefore = actor.hp.current;
  const exhaustionBefore = actor.exhaustionLevel;
  const stateDelta: GameStateDelta = {};

  let hpAfter = hpBefore;
  let hitDiceSpent = 0;
  const hitDiceRolls: number[] = [];
  let hitDiceAfter = { ...poolBefore };
  let slotsRestored = false;
  let exhaustionAfter = exhaustionBefore;

  if (restType === 'short') {
    const desired =
      hitDiceToSpend !== undefined
        ? hitDiceToSpend
        : hpBefore < actor.hp.max
          ? 1
          : 0;
    const toSpend = Math.max(0, Math.min(desired, poolBefore.current));
    const conMod = getAbilityModifier(actor.abilities.con);
    let healed = 0;

    for (let i = 0; i < toSpend; i += 1) {
      if (hpBefore + healed >= actor.hp.max) break;
      const roll = rollDice(`1${poolBefore.die}`, rng);
      hitDiceRolls.push(...roll.rolls);
      healed += Math.max(1, roll.total + conMod);
      hitDiceSpent += 1;
    }

    hpAfter = Math.min(actor.hp.max, hpBefore + healed);
    hitDiceAfter = {
      die: poolBefore.die,
      max: poolBefore.max,
      current: Math.max(0, poolBefore.current - hitDiceSpent),
    };

    if (hpAfter !== hpBefore) {
      stateDelta.hpChanges = [
        { actorId: actor.id, before: hpBefore, after: hpAfter },
      ];
    }
    if (hitDiceSpent > 0 || !actor.hitDice) {
      stateDelta.hitDiceChanges = [
        {
          actorId: actor.id,
          before: poolBefore.current,
          after: hitDiceAfter.current,
          die: poolBefore.die,
          max: poolBefore.max,
        },
      ];
    }
    if (hpBefore === 0 && hpAfter > 0) {
      if (actor.conditions.includes('unconscious')) {
        stateDelta.conditionsRemoved = [
          { actorId: actor.id, condition: 'unconscious' },
        ];
      }
      if (actor.deathSaves) {
        stateDelta.deathSaveChanges = [
          {
            actorId: actor.id,
            before: actor.deathSaves,
            after: { successes: 0, failures: 0, stable: false },
          },
        ];
      }
    }
  } else {
    hpAfter = actor.hp.max;
    if (hpAfter !== hpBefore) {
      stateDelta.hpChanges = [
        { actorId: actor.id, before: hpBefore, after: hpAfter },
      ];
    }
    if (actor.hp.temp > 0) {
      stateDelta.tempHpChanges = [
        { actorId: actor.id, before: actor.hp.temp, after: 0 },
      ];
    }

    const slotChanges: NonNullable<GameStateDelta['spellSlotChanges']> = [];
    for (const [lvl, pool] of Object.entries(actor.spellSlots)) {
      if (pool.current < pool.max) {
        slotChanges.push({
          actorId: actor.id,
          level: lvl,
          before: pool.current,
          after: pool.max,
        });
      }
    }
    if (slotChanges.length > 0) {
      stateDelta.spellSlotChanges = slotChanges;
      slotsRestored = true;
    }

    hitDiceAfter = {
      die: poolBefore.die,
      max: poolBefore.max,
      current: poolBefore.max,
    };
    if (poolBefore.current < poolBefore.max || !actor.hitDice) {
      stateDelta.hitDiceChanges = [
        {
          actorId: actor.id,
          before: poolBefore.current,
          after: poolBefore.max,
          die: poolBefore.die,
          max: poolBefore.max,
        },
      ];
    }

    if (exhaustionBefore > 0) {
      exhaustionAfter = Math.max(0, exhaustionBefore - 1);
      stateDelta.exhaustionChanges = [
        {
          actorId: actor.id,
          before: exhaustionBefore,
          after: exhaustionAfter,
        },
      ];
    }

    if (actor.conditions.includes('unconscious')) {
      stateDelta.conditionsRemoved = [
        { actorId: actor.id, condition: 'unconscious' },
      ];
    }
    if (
      actor.deathSaves &&
      (actor.deathSaves.successes > 0 ||
        actor.deathSaves.failures > 0 ||
        actor.deathSaves.stable)
    ) {
      stateDelta.deathSaveChanges = [
        {
          actorId: actor.id,
          before: actor.deathSaves,
          after: { successes: 0, failures: 0, stable: false },
        },
      ];
    }
    if (actor.concentratingOn) {
      stateDelta.concentrationChanges = [
        { actorId: actor.id, before: actor.concentratingOn, after: null },
      ];
    }
  }

  return {
    actorId: actor.id,
    actorName: actor.name,
    hpBefore,
    hpAfter,
    hpHealed: Math.max(0, hpAfter - hpBefore),
    hitDiceSpent,
    hitDiceRolls,
    hitDiceAfter,
    slotsRestored,
    exhaustionBefore,
    exhaustionAfter,
    delta: stateDelta,
  };
}

export function resolveTakeRest(
  state: GameState,
  rawInput: unknown,
  ctx: ResolverContext,
): ResolveTakeRestResult {
  const parsed = ResolveTakeRestInputSchema.safeParse(rawInput);
  if (!parsed.success) {
    return {
      ok: false,
      code: 'INVALID_INPUT',
      messageEs: `Parámetros inválidos en take_rest: ${parsed.error.issues[0]?.message ?? 'formato incorrecto'}.`,
    };
  }

  const input = parsed.data;
  if (input.sceneId !== state.sceneId || !state.scenes[input.sceneId]) {
    return {
      ok: false,
      code: 'INVALID_SCENE',
      messageEs: `La escena "${input.sceneId}" no coincide con la escena activa ("${state.sceneId}").`,
    };
  }

  if (state.combat?.active) {
    return {
      ok: false,
      code: 'IN_COMBAT',
      messageEs: 'No se puede tomar un descanso mientras haya un combate activo.',
    };
  }

  const actor = state.characters[input.actorId];
  if (!actor) {
    return {
      ok: false,
      code: 'UNKNOWN_ACTOR',
      messageEs: `No existe el personaje "${input.actorId}".`,
    };
  }

  const outcome = computeCharacterRestOutcome(
    actor,
    input.restType,
    input.hitDiceToSpend,
    ctx.rng,
  );
  const {
    hpBefore,
    hpAfter,
    hitDiceSpent,
    hitDiceRolls,
    hitDiceAfter,
    slotsRestored,
    exhaustionBefore,
    exhaustionAfter,
    delta: stateDelta,
  } = outcome;

  const nextSeq = state.lastSeq + 1;
  const event: GameEvent = {
    id: ctx.createId(),
    campaignId: state.campaignId,
    sessionId: state.sessionId,
    seq: nextSeq,
    type: 'REST_TAKEN',
    source: 'engine',
    visibility: input.visibility ?? 'public',
    actor: actor.id,
    checkId: null,
    declaredTotal: null,
    dieResults: hitDiceRolls.length > 0 ? hitDiceRolls : null,
    payload: {
      sceneId: input.sceneId,
      actorId: actor.id,
      actorName: actor.name,
      restType: input.restType,
      hpBefore,
      hpAfter,
      hpHealed: Math.max(0, hpAfter - hpBefore),
      hitDiceSpent,
      hitDiceRolls,
      hitDiceAfter,
      slotsRestored,
      exhaustionBefore,
      exhaustionAfter,
    },
    stateDelta,
    revertedByEventId: null,
    createdAt: ctx.now(),
  };

  const nextState = applyDelta(state, stateDelta, nextSeq);

  return {
    ok: true,
    actorId: actor.id,
    actorName: actor.name,
    restType: input.restType,
    hpBefore,
    hpAfter,
    hpHealed: Math.max(0, hpAfter - hpBefore),
    hitDiceSpent,
    hitDiceRolls,
    hitDiceAfter,
    slotsRestored,
    exhaustionBefore,
    exhaustionAfter,
    event,
    nextState,
  };
}

// ---------- party_rest ----------

export const ResolvePartyRestInputSchema = z
  .object({
    sceneId: z.string().min(1),
    restType: z.enum(['short', 'long']),
    hitDiceToSpendPerPc: z.number().int().min(0).max(20).optional(),
    visibility: VisibilitySchema.optional(),
  })
  .strict();
export type ResolvePartyRestInput = z.infer<typeof ResolvePartyRestInputSchema>;

export interface PartyRestMemberSummary {
  actorId: string;
  actorName: string;
  hpBefore: number;
  hpAfter: number;
  hpHealed: number;
  hitDiceSpent: number;
  slotsRestored: boolean;
  exhaustionBefore: number;
  exhaustionAfter: number;
}

export type ResolvePartyRestResult =
  | {
      ok: true;
      restType: 'short' | 'long';
      members: PartyRestMemberSummary[];
      event: GameEvent;
      nextState: GameState;
    }
  | {
      ok: false;
      code: TakeRestErrorCode;
      messageEs: string;
    };

export function resolvePartyRest(
  state: GameState,
  rawInput: unknown,
  ctx: ResolverContext,
): ResolvePartyRestResult {
  const parsed = ResolvePartyRestInputSchema.safeParse(rawInput);
  if (!parsed.success) {
    return {
      ok: false,
      code: 'INVALID_INPUT',
      messageEs: `Parámetros inválidos en descanso grupal: ${parsed.error.issues[0]?.message ?? 'formato incorrecto'}.`,
    };
  }

  const input = parsed.data;
  if (input.sceneId !== state.sceneId || !state.scenes[input.sceneId]) {
    return {
      ok: false,
      code: 'INVALID_SCENE',
      messageEs: `La escena "${input.sceneId}" no coincide con la escena activa ("${state.sceneId}").`,
    };
  }

  if (state.combat?.active) {
    return {
      ok: false,
      code: 'IN_COMBAT',
      messageEs: 'No se puede tomar un descanso mientras haya un combate activo.',
    };
  }

  const pcs = Object.values(state.characters).sort((a, b) =>
    a.id.localeCompare(b.id, 'en'),
  );
  if (pcs.length === 0) {
    return {
      ok: false,
      code: 'UNKNOWN_ACTOR',
      messageEs: 'No hay personajes activos en la campaña.',
    };
  }

  const stateDelta: GameStateDelta = {};
  const members: PartyRestMemberSummary[] = [];
  const allRolls: number[] = [];

  for (const pc of pcs) {
    const out = computeCharacterRestOutcome(
      pc,
      input.restType,
      input.hitDiceToSpendPerPc,
      ctx.rng,
    );
    members.push({
      actorId: out.actorId,
      actorName: out.actorName,
      hpBefore: out.hpBefore,
      hpAfter: out.hpAfter,
      hpHealed: out.hpHealed,
      hitDiceSpent: out.hitDiceSpent,
      slotsRestored: out.slotsRestored,
      exhaustionBefore: out.exhaustionBefore,
      exhaustionAfter: out.exhaustionAfter,
    });
    allRolls.push(...out.hitDiceRolls);

    if (out.delta.hpChanges?.length) {
      stateDelta.hpChanges = [...(stateDelta.hpChanges ?? []), ...out.delta.hpChanges];
    }
    if (out.delta.tempHpChanges?.length) {
      stateDelta.tempHpChanges = [
        ...(stateDelta.tempHpChanges ?? []),
        ...out.delta.tempHpChanges,
      ];
    }
    if (out.delta.hitDiceChanges?.length) {
      stateDelta.hitDiceChanges = [
        ...(stateDelta.hitDiceChanges ?? []),
        ...out.delta.hitDiceChanges,
      ];
    }
    if (out.delta.spellSlotChanges?.length) {
      stateDelta.spellSlotChanges = [
        ...(stateDelta.spellSlotChanges ?? []),
        ...out.delta.spellSlotChanges,
      ];
    }
    if (out.delta.exhaustionChanges?.length) {
      stateDelta.exhaustionChanges = [
        ...(stateDelta.exhaustionChanges ?? []),
        ...out.delta.exhaustionChanges,
      ];
    }
    if (out.delta.conditionsRemoved?.length) {
      stateDelta.conditionsRemoved = [
        ...(stateDelta.conditionsRemoved ?? []),
        ...out.delta.conditionsRemoved,
      ];
    }
    if (out.delta.deathSaveChanges?.length) {
      stateDelta.deathSaveChanges = [
        ...(stateDelta.deathSaveChanges ?? []),
        ...out.delta.deathSaveChanges,
      ];
    }
    if (out.delta.concentrationChanges?.length) {
      stateDelta.concentrationChanges = [
        ...(stateDelta.concentrationChanges ?? []),
        ...out.delta.concentrationChanges,
      ];
    }
  }

  const nextSeq = state.lastSeq + 1;
  const event: GameEvent = {
    id: ctx.createId(),
    campaignId: state.campaignId,
    sessionId: state.sessionId,
    seq: nextSeq,
    type: 'REST_TAKEN',
    source: 'engine',
    visibility: input.visibility ?? 'public',
    actor: 'party',
    checkId: null,
    declaredTotal: null,
    dieResults: allRolls.length > 0 ? allRolls : null,
    payload: {
      sceneId: input.sceneId,
      restType: input.restType,
      party: true,
      members,
    },
    stateDelta,
    revertedByEventId: null,
    createdAt: ctx.now(),
  };

  const nextState = applyDelta(state, stateDelta, nextSeq);

  return {
    ok: true,
    restType: input.restType,
    members,
    event,
    nextState,
  };
}

// ---------- death_save ----------

export const ResolveDeathSaveInputSchema = z
  .object({
    sceneId: z.string().min(1),
    actorId: z.string().min(1),
    mode: RollModeSchema.optional(),
    visibility: VisibilitySchema.optional(),
  })
  .strict();
export type ResolveDeathSaveInput = z.infer<typeof ResolveDeathSaveInputSchema>;

export type DeathSaveErrorCode =
  | 'INVALID_INPUT'
  | 'INVALID_SCENE'
  | 'UNKNOWN_ACTOR'
  | 'NOT_DYING'
  | 'ALREADY_STABLE'
  | 'ALREADY_DEAD';

export type DeathSaveOutcome =
  | 'critical_recovery'
  | 'success'
  | 'stabilized'
  | 'failure'
  | 'critical_failure'
  | 'dead';

export type ResolveDeathSaveResult =
  | {
      ok: true;
      actorId: string;
      actorName: string;
      rolls: number[];
      naturalRoll: number;
      modifier: number;
      total: number;
      outcome: DeathSaveOutcome;
      deathSavesAfter: DeathSaves;
      hpAfter: number;
      event: GameEvent;
      nextState: GameState;
    }
  | {
      ok: false;
      code: DeathSaveErrorCode;
      messageEs: string;
    };

export function resolveDeathSave(
  state: GameState,
  rawInput: unknown,
  ctx: ResolverContext,
): ResolveDeathSaveResult {
  const parsed = ResolveDeathSaveInputSchema.safeParse(rawInput);
  if (!parsed.success) {
    return {
      ok: false,
      code: 'INVALID_INPUT',
      messageEs: `Parámetros inválidos en death_save: ${parsed.error.issues[0]?.message ?? 'formato incorrecto'}.`,
    };
  }

  const input = parsed.data;
  if (input.sceneId !== state.sceneId || !state.scenes[input.sceneId]) {
    return {
      ok: false,
      code: 'INVALID_SCENE',
      messageEs: `La escena "${input.sceneId}" no coincide con la escena activa ("${state.sceneId}").`,
    };
  }

  const actor = state.characters[input.actorId];
  if (!actor) {
    return {
      ok: false,
      code: 'UNKNOWN_ACTOR',
      messageEs: `No existe el personaje "${input.actorId}".`,
    };
  }

  if (actor.hp.current > 0) {
    return {
      ok: false,
      code: 'NOT_DYING',
      messageEs: `${actor.name} tiene ${actor.hp.current} PG y no necesita tirar salvación contra la muerte.`,
    };
  }

  const before: DeathSaves = actor.deathSaves
    ? { ...actor.deathSaves }
    : { successes: 0, failures: 0, stable: false };

  if (before.failures >= 3) {
    return {
      ok: false,
      code: 'ALREADY_DEAD',
      messageEs: `${actor.name} ya acumuló 3 fallos de salvación contra la muerte.`,
    };
  }

  if (before.stable) {
    return {
      ok: false,
      code: 'ALREADY_STABLE',
      messageEs: `${actor.name} ya se encuentra estable en 0 PG.`,
    };
  }

  const roll = rollD20(ctx.rng, input.mode ?? 'normal');
  const exhaustionMod = getConditionPenalty(actor, state.ruleset).d20Modifier;
  const total = roll.chosen + exhaustionMod;

  let after: DeathSaves = { ...before };
  let outcome: DeathSaveOutcome;
  let hpAfter = 0;
  const stateDelta: GameStateDelta = {};

  if (roll.chosen === 20) {
    outcome = 'critical_recovery';
    hpAfter = 1;
    after = { successes: 0, failures: 0, stable: false };
    stateDelta.hpChanges = [{ actorId: actor.id, before: 0, after: 1 }];
    if (actor.conditions.includes('unconscious')) {
      stateDelta.conditionsRemoved = [
        { actorId: actor.id, condition: 'unconscious' },
      ];
    }
  } else if (roll.chosen === 1) {
    const failures = Math.min(3, before.failures + 2);
    after = { successes: before.successes, failures, stable: false };
    outcome = failures >= 3 ? 'dead' : 'critical_failure';
  } else if (total >= 10) {
    const successes = Math.min(3, before.successes + 1);
    const stable = successes >= 3;
    after = { successes, failures: before.failures, stable };
    outcome = stable ? 'stabilized' : 'success';
  } else {
    const failures = Math.min(3, before.failures + 1);
    after = { successes: before.successes, failures, stable: false };
    outcome = failures >= 3 ? 'dead' : 'failure';
  }

  stateDelta.deathSaveChanges = [{ actorId: actor.id, before, after }];
  if (outcome === 'dead') {
    stateDelta.flagsSet = { [`pc:${actor.id}:dead`]: true };
  }

  const nextSeq = state.lastSeq + 1;
  const event: GameEvent = {
    id: ctx.createId(),
    campaignId: state.campaignId,
    sessionId: state.sessionId,
    seq: nextSeq,
    type: 'DEATH_SAVE_RESOLVED',
    source: 'engine',
    visibility: input.visibility ?? 'public',
    actor: actor.id,
    checkId: null,
    declaredTotal: null,
    dieResults: roll.rolls,
    payload: {
      sceneId: input.sceneId,
      actorId: actor.id,
      actorName: actor.name,
      rolls: roll.rolls,
      naturalRoll: roll.chosen,
      modifier: exhaustionMod,
      total,
      outcome,
      deathSavesAfter: after,
      hpAfter,
    },
    stateDelta,
    revertedByEventId: null,
    createdAt: ctx.now(),
  };

  const nextState = applyDelta(state, stateDelta, nextSeq);

  return {
    ok: true,
    actorId: actor.id,
    actorName: actor.name,
    rolls: roll.rolls,
    naturalRoll: roll.chosen,
    modifier: exhaustionMod,
    total,
    outcome,
    deathSavesAfter: after,
    hpAfter,
    event,
    nextState,
  };
}

// ---------- heal ----------

export const ResolveHealInputSchema = z
  .object({
    sceneId: z.string().min(1),
    actorId: z.string().min(1),
    targetId: z.string().min(1),
    source: z.enum(['potion', 'medicine_stabilize', 'feature']),
    itemId: z.string().min(1).optional(),
    diceExpression: z.string().min(1).optional(),
    reason: z.string().min(1),
    visibility: VisibilitySchema.optional(),
  })
  .strict();
export type ResolveHealInput = z.infer<typeof ResolveHealInputSchema>;

export type HealErrorCode =
  | 'INVALID_INPUT'
  | 'INVALID_SCENE'
  | 'UNKNOWN_ACTOR'
  | 'ITEM_NOT_FOUND'
  | 'NOT_DYING'
  | 'INVALID_DICE_EXPRESSION';

export type ResolveHealResult =
  | {
      ok: true;
      actorId: string;
      targetId: string;
      targetName: string;
      source: 'potion' | 'medicine_stabilize' | 'feature';
      hpBefore: number;
      hpAfter: number;
      hpHealed: number;
      rolls: number[];
      stabilized: boolean;
      medicineCheck?: {
        naturalRoll: number;
        modifier: number;
        total: number;
        dc: number;
        success: boolean;
      };
      itemConsumed?: string;
      event: GameEvent;
      nextState: GameState;
    }
  | {
      ok: false;
      code: HealErrorCode;
      messageEs: string;
    };

export function resolveHeal(
  state: GameState,
  rawInput: unknown,
  ctx: ResolverContext,
): ResolveHealResult {
  const parsed = ResolveHealInputSchema.safeParse(rawInput);
  if (!parsed.success) {
    return {
      ok: false,
      code: 'INVALID_INPUT',
      messageEs: `Parámetros inválidos en heal: ${parsed.error.issues[0]?.message ?? 'formato incorrecto'}.`,
    };
  }

  const input = parsed.data;
  if (input.sceneId !== state.sceneId || !state.scenes[input.sceneId]) {
    return {
      ok: false,
      code: 'INVALID_SCENE',
      messageEs: `La escena "${input.sceneId}" no coincide con la escena activa ("${state.sceneId}").`,
    };
  }

  const actor = state.characters[input.actorId];
  if (!actor) {
    return {
      ok: false,
      code: 'UNKNOWN_ACTOR',
      messageEs: `No existe el personaje "${input.actorId}".`,
    };
  }

  const target = state.characters[input.targetId];
  if (!target) {
    return {
      ok: false,
      code: 'UNKNOWN_ACTOR',
      messageEs: `No existe el personaje objetivo "${input.targetId}".`,
    };
  }

  const hpBefore = target.hp.current;
  let hpAfter = hpBefore;
  let rolls: number[] = [];
  let stabilized = false;
  let itemConsumed: string | undefined;
  let medicineCheck:
    | {
        naturalRoll: number;
        modifier: number;
        total: number;
        dc: number;
        success: boolean;
      }
    | undefined;
  const stateDelta: GameStateDelta = {};

  if (input.source === 'potion') {
    const itemId = input.itemId ?? 'potion-of-healing';
    const invItem = actor.inventory.find(
      (i) => i.itemId === itemId && i.quantity > 0,
    );
    if (!invItem) {
      return {
        ok: false,
        code: 'ITEM_NOT_FOUND',
        messageEs: `${actor.name} no tiene "${itemId}" en su inventario.`,
      };
    }

    const expr =
      itemId === 'potion-of-greater-healing'
        ? '4d4+4'
        : '2d4+2';
    const roll = rollDice(expr, ctx.rng);
    rolls = roll.rolls;
    const healed = Math.max(1, roll.total);
    hpAfter = Math.min(target.hp.max, hpBefore + healed);
    itemConsumed = invItem.name;

    stateDelta.inventoryDelta = [
      { actorId: actor.id, itemId: invItem.itemId, qtyDelta: -1 },
    ];
    stateDelta.hpChanges = [
      { actorId: target.id, before: hpBefore, after: hpAfter },
    ];
  } else if (input.source === 'medicine_stabilize') {
    if (hpBefore > 0) {
      return {
        ok: false,
        code: 'NOT_DYING',
        messageEs: `${target.name} tiene ${hpBefore} PG; no necesita estabilización.`,
      };
    }
    const mod = getCheckModifier(actor, 'medicine', state.ruleset).totalMod;
    const roll = rollD20(ctx.rng, 'normal');
    rolls = roll.rolls;
    const total = roll.chosen + mod;
    const success = total >= 10;
    medicineCheck = {
      naturalRoll: roll.chosen,
      modifier: mod,
      total,
      dc: 10,
      success,
    };

    if (success) {
      stabilized = true;
      const dsBefore = target.deathSaves ?? {
        successes: 0,
        failures: 0,
        stable: false,
      };
      stateDelta.deathSaveChanges = [
        {
          actorId: target.id,
          before: dsBefore,
          after: {
            successes: dsBefore.successes,
            failures: dsBefore.failures,
            stable: true,
          },
        },
      ];
    }
  } else {
    // feature (e.g. Second Wind: 1d10 + level)
    const expr = input.diceExpression ?? `1d10+${actor.level}`;
    try {
      const roll = rollDice(expr, ctx.rng);
      rolls = roll.rolls;
      const healed = Math.max(1, roll.total);
      hpAfter = Math.min(target.hp.max, hpBefore + healed);
      stateDelta.hpChanges = [
        { actorId: target.id, before: hpBefore, after: hpAfter },
      ];
    } catch (err) {
      if (err instanceof RulesError) {
        return {
          ok: false,
          code: 'INVALID_DICE_EXPRESSION',
          messageEs: err.message,
        };
      }
      throw err;
    }
  }

  if (hpBefore === 0 && hpAfter > 0) {
    if (target.conditions.includes('unconscious')) {
      stateDelta.conditionsRemoved = [
        { actorId: target.id, condition: 'unconscious' },
      ];
    }
    if (target.deathSaves) {
      stateDelta.deathSaveChanges = [
        {
          actorId: target.id,
          before: target.deathSaves,
          after: { successes: 0, failures: 0, stable: false },
        },
      ];
    }
  }

  const nextSeq = state.lastSeq + 1;
  const event: GameEvent = {
    id: ctx.createId(),
    campaignId: state.campaignId,
    sessionId: state.sessionId,
    seq: nextSeq,
    type: 'HEALING_APPLIED',
    source: 'engine',
    visibility: input.visibility ?? 'public',
    actor: actor.id,
    checkId: null,
    declaredTotal: null,
    dieResults: rolls.length > 0 ? rolls : null,
    payload: {
      sceneId: input.sceneId,
      actorId: actor.id,
      targetId: target.id,
      targetName: target.name,
      source: input.source,
      reason: input.reason,
      hpBefore,
      hpAfter,
      hpHealed: Math.max(0, hpAfter - hpBefore),
      stabilized,
      ...(medicineCheck ? { medicineCheck } : {}),
      ...(itemConsumed ? { itemConsumed } : {}),
    },
    stateDelta,
    revertedByEventId: null,
    createdAt: ctx.now(),
  };

  const nextState = applyDelta(state, stateDelta, nextSeq);

  return {
    ok: true,
    actorId: actor.id,
    targetId: target.id,
    targetName: target.name,
    source: input.source,
    hpBefore,
    hpAfter,
    hpHealed: Math.max(0, hpAfter - hpBefore),
    rolls,
    stabilized,
    ...(medicineCheck ? { medicineCheck } : {}),
    ...(itemConsumed ? { itemConsumed } : {}),
    event,
    nextState,
  };
}
