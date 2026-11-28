import { z } from 'zod';
import {
  buildRollTags,
  collectConcentrationPurge,
} from './effects.js';
import {
  applyDelta,
  type GameEvent,
  type GameStateDelta,
} from './events.js';
import {
  combineRollMode,
  evaluateConcentrationCheck,
  getCheckModifier,
  getConditionPenalty,
  getProficiencyBonus,
  getSavingThrowModifier,
  resolveDamageRelation,
  resolveRollMode,
  type ConcentrationCheckOutcome,
  type DamageRelation,
} from './modifiers.js';
import {
  RollModeSchema,
  rollD20,
  rollDice,
  RulesError,
  type Rng,
  type RollMode,
} from './rng.js';
import {
  AbilitySchema,
  CheckTargetSchema,
  Condition5eSchema,
  EffectExpiryTimingSchema,
  SKILL_TO_ABILITY,
  VisibilitySchema,
  type ActiveEffect,
  type Character,
  type Condition5e,
  type GameState,
  type ResolvedModifierEntry,
  type SceneClue,
  type Visibility,
} from './types.js';

export interface ResolverContext {
  rng: Rng;
  createId: () => string;
  now: () => string;
}

export type ResolverErrorCode =
  | 'INVALID_INPUT'
  | 'INVALID_SCENE'
  | 'UNKNOWN_ACTOR'
  | 'WRONG_MODE'
  | 'DC_REQUIRED'
  | 'FORBIDDEN_TRANSITION'
  | 'IMPOSSIBLE_DIE'
  | 'INCOHERENT_TOTAL'
  | 'INVALID_DICE_EXPRESSION';

type DcResolution =
  | { ok: true; dc: number; source: 'scene-clue' | 'declared' }
  | {
      ok: false;
      code: 'DC_REQUIRED' | 'INVALID_INPUT';
      messageEs: string;
    };

/** Resuelve la CD desde el dato de escena cuando se entrega `dcRef`. */
function resolveSceneDc(
  state: GameState,
  sceneId: string,
  dcRef: string | undefined,
  dc: number | undefined,
): DcResolution {
  if (dcRef) {
    const clue = state.scenes[sceneId]?.clues.find((c) => c.id === dcRef);
    if (clue) {
      return { ok: true, dc: clue.dc, source: 'scene-clue' };
    }
    if (dc !== undefined) {
      return { ok: true, dc, source: 'declared' };
    }
    return {
      ok: false,
      code: 'INVALID_INPUT',
      messageEs: `No existe una pista/DC con id "${dcRef}" en la escena "${sceneId}".`,
    };
  }
  if (dc === undefined) {
    return {
      ok: false,
      code: 'DC_REQUIRED',
      messageEs: 'Falta la CD: enviá dcRef con el id de una pista de la escena o un dc numérico.',
    };
  }
  return { ok: true, dc, source: 'declared' };
}

// ---------- resolve_check ----------

export const ResolveCheckInputSchema = z
  .object({
    sceneId: z.string().min(1),
    actorId: z.string().min(1),
    skill: CheckTargetSchema,
    dc: z.number().int().min(1).max(40).optional(),
    dcRef: z.string().min(1).optional(),
    mode: RollModeSchema.optional(),
    requiresSight: z.boolean().optional(),
    visibility: VisibilitySchema.optional(),
    checkId: z.string().min(1).optional(),
  })
  .strict();
export type ResolveCheckInput = z.infer<typeof ResolveCheckInputSchema>;

export type ResolveCheckResult =
  | {
      ok: true;
      checkId: string;
      success: boolean;
      autoFailed?: boolean;
      margin: number;
      total: number;
      dc: number;
      naturalRoll: number;
      modifier: number;
      breakdown?: ResolvedModifierEntry[];
      effectiveMode: RollMode;
      rolls: number[];
      event: GameEvent;
      nextState: GameState;
    }
  | {
      ok: false;
      code:
        | 'INVALID_INPUT'
        | 'INVALID_SCENE'
        | 'UNKNOWN_ACTOR'
        | 'WRONG_MODE'
        | 'DC_REQUIRED';
      messageEs: string;
    };

export function resolveCheck(
  state: GameState,
  rawInput: unknown,
  ctx: ResolverContext,
): ResolveCheckResult {
  const parsed = ResolveCheckInputSchema.safeParse(rawInput);
  if (!parsed.success) {
    return {
      ok: false,
      code: 'INVALID_INPUT',
      messageEs: `Parámetros inválidos en resolve_check: ${parsed.error.issues[0]?.message ?? 'formato incorrecto'}.`,
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
      messageEs: `No existe el personaje "${input.actorId}" en el estado actual.`,
    };
  }

  if (actor.rollAuthority === 'player-declared') {
    return {
      ok: false,
      code: 'WRONG_MODE',
      messageEs: `El personaje "${actor.id}" declara sus tiradas en modo híbrido: usá declare_check en lugar de resolve_check.`,
    };
  }

  const resolvedDc = resolveSceneDc(
    state,
    input.sceneId,
    input.dcRef,
    input.dc,
  );
  if (!resolvedDc.ok) {
    return { ok: false, code: resolvedDc.code, messageEs: resolvedDc.messageEs };
  }

  const ability =
    input.skill in SKILL_TO_ABILITY
      ? SKILL_TO_ABILITY[input.skill as keyof typeof SKILL_TO_ABILITY]
      : input.skill;
  const tags = buildRollTags({
    kind: 'check',
    skill: input.skill,
    ability: ability as Character['savingThrowProficiencies'][number],
    requiresSight: input.requiresSight,
    conditions: actor.conditions,
    inCombat: Boolean(state.combat?.active),
    sceneId: input.sceneId,
  });
  const modBreakdown = getCheckModifier(actor, input.skill, state.ruleset, {
    rng: ctx.rng,
    tags,
  });
  const condEffects = getConditionPenalty(actor, state.ruleset);
  const effectiveMode = resolveRollMode({
    requested: input.mode ?? 'normal',
    hasAdvantage: modBreakdown.grantsAdvantage,
    hasDisadvantage: modBreakdown.imposesDisadvantage,
  });
  const checkId = input.checkId ?? ctx.createId();
  const nextSeq = state.lastSeq + 1;

  const autoFailed = Boolean(input.requiresSight && condEffects.autoFailSightChecks);
  const roll = autoFailed ? null : rollD20(ctx.rng, effectiveMode);
  const naturalRoll = roll ? roll.chosen : 0;
  const rolls = roll ? roll.rolls : [];
  const total = roll ? naturalRoll + modBreakdown.totalMod : 0;
  const success = autoFailed ? false : total >= resolvedDc.dc;
  const margin = autoFailed ? -resolvedDc.dc : total - resolvedDc.dc;

  const stateDelta: GameStateDelta = {
    flagsSet: {
      [`check:${checkId}:success`]: success,
    },
    ...(modBreakdown.consumedEffectIds.length > 0
      ? {
          effectsRemoved: modBreakdown.consumedEffectIds.map((effectId) => ({
            targetId: actor.id,
            effectId,
          })),
        }
      : {}),
  };

  const event: GameEvent = {
    id: ctx.createId(),
    campaignId: state.campaignId,
    sessionId: state.sessionId,
    seq: nextSeq,
    type: 'CHECK_RESOLVED',
    source: 'engine',
    visibility: input.visibility ?? 'public',
    actor: actor.id,
    checkId,
    declaredTotal: null,
    dieResults: rolls,
    payload: {
      sceneId: input.sceneId,
      skill: input.skill,
      dc: resolvedDc.dc,
      dcRef: input.dcRef ?? null,
      dcSource: resolvedDc.source,
      dcDeclaredByModel: input.dc ?? null,
      mode: effectiveMode,
      modifier: modBreakdown.totalMod,
      breakdown: modBreakdown.breakdown,
      total,
      success,
      margin,
      ...(autoFailed ? { autoFailed: true, autoFailReason: 'CONDITION_AUTO_FAIL' } : {}),
    },
    stateDelta,
    revertedByEventId: null,
    createdAt: ctx.now(),
  };

  const nextState = applyDelta(state, stateDelta, nextSeq);

  return {
    ok: true,
    checkId,
    success,
    ...(autoFailed ? { autoFailed: true } : {}),
    margin,
    total,
    dc: resolvedDc.dc,
    naturalRoll,
    modifier: modBreakdown.totalMod,
    breakdown: modBreakdown.breakdown,
    effectiveMode,
    rolls,
    event,
    nextState,
  };
}

// ---------- resolve_save ----------

export const ResolveSaveInputSchema = z
  .object({
    sceneId: z.string().min(1),
    actorId: z.string().min(1),
    ability: AbilitySchema,
    dc: z.number().int().min(1).max(40).optional(),
    dcRef: z.string().min(1).optional(),
    mode: RollModeSchema.optional(),
    visibility: VisibilitySchema.optional(),
    checkId: z.string().min(1).optional(),
  })
  .strict();
export type ResolveSaveInput = z.infer<typeof ResolveSaveInputSchema>;

export type ResolveSaveResult =
  | {
      ok: true;
      checkId: string;
      success: boolean;
      autoFailed?: boolean;
      margin: number;
      total: number;
      dc: number;
      naturalRoll: number;
      modifier: number;
      breakdown?: ResolvedModifierEntry[];
      effectiveMode?: RollMode;
      rolls: number[];
      event: GameEvent;
      nextState: GameState;
    }
  | {
      ok: false;
      code:
        | 'INVALID_INPUT'
        | 'INVALID_SCENE'
        | 'UNKNOWN_ACTOR'
        | 'WRONG_MODE'
        | 'DC_REQUIRED';
      messageEs: string;
    };

export function resolveSave(
  state: GameState,
  rawInput: unknown,
  ctx: ResolverContext,
): ResolveSaveResult {
  const parsed = ResolveSaveInputSchema.safeParse(rawInput);
  if (!parsed.success) {
    return {
      ok: false,
      code: 'INVALID_INPUT',
      messageEs: `Parámetros inválidos en resolve_save: ${parsed.error.issues[0]?.message ?? 'formato incorrecto'}.`,
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
      messageEs: `No existe el personaje "${input.actorId}" en el estado actual.`,
    };
  }

  if (actor.rollAuthority === 'player-declared') {
    return {
      ok: false,
      code: 'WRONG_MODE',
      messageEs: `El personaje "${actor.id}" declara sus tiradas en modo híbrido: usá declare_check en lugar de resolve_save.`,
    };
  }

  const resolvedDc = resolveSceneDc(
    state,
    input.sceneId,
    input.dcRef,
    input.dc,
  );
  if (!resolvedDc.ok) {
    return { ok: false, code: resolvedDc.code, messageEs: resolvedDc.messageEs };
  }

  const saveTags = buildRollTags({
    kind: 'save',
    ability: input.ability,
    conditions: actor.conditions,
    inCombat: Boolean(state.combat?.active),
    sceneId: input.sceneId,
  });
  const saveBreakdown = getSavingThrowModifier(
    actor,
    input.ability,
    state.ruleset,
    { rng: ctx.rng, tags: saveTags },
  );
  const condEffects = getConditionPenalty(actor, state.ruleset);
  const isStrOrDex = input.ability === 'str' || input.ability === 'dex';
  const autoFailed = Boolean(condEffects.autoFailStrDexSaves && isStrOrDex);
  const effectiveMode = resolveRollMode({
    requested: input.mode ?? 'normal',
    hasAdvantage: saveBreakdown.grantsAdvantage,
    hasDisadvantage:
      saveBreakdown.imposesDisadvantage ||
      (condEffects.disadvantageOnDexSaves && input.ability === 'dex'),
  });
  const checkId = input.checkId ?? ctx.createId();
  const nextSeq = state.lastSeq + 1;

  const roll = autoFailed ? null : rollD20(ctx.rng, effectiveMode);
  const naturalRoll = roll ? roll.chosen : 0;
  const rolls = roll ? roll.rolls : [];
  const total = roll ? naturalRoll + saveBreakdown.totalMod : 0;
  const success = autoFailed ? false : total >= resolvedDc.dc;
  const margin = autoFailed ? -resolvedDc.dc : total - resolvedDc.dc;

  const stateDelta: GameStateDelta = {
    flagsSet: {
      [`save:${checkId}:success`]: success,
    },
    ...(saveBreakdown.consumedEffectIds.length > 0
      ? {
          effectsRemoved: saveBreakdown.consumedEffectIds.map((effectId) => ({
            targetId: actor.id,
            effectId,
          })),
        }
      : {}),
  };

  const event: GameEvent = {
    id: ctx.createId(),
    campaignId: state.campaignId,
    sessionId: state.sessionId,
    seq: nextSeq,
    type: 'SAVE_RESOLVED',
    source: 'engine',
    visibility: input.visibility ?? 'public',
    actor: actor.id,
    checkId,
    declaredTotal: null,
    dieResults: rolls,
    payload: {
      sceneId: input.sceneId,
      ability: input.ability,
      dc: resolvedDc.dc,
      dcRef: input.dcRef ?? null,
      dcSource: resolvedDc.source,
      dcDeclaredByModel: input.dc ?? null,
      mode: effectiveMode,
      modifier: saveBreakdown.totalMod,
      breakdown: saveBreakdown.breakdown,
      total,
      success,
      margin,
      ...(autoFailed ? { autoFailed: true, autoFailReason: 'CONDITION_AUTO_FAIL' } : {}),
    },
    stateDelta,
    revertedByEventId: null,
    createdAt: ctx.now(),
  };

  const nextState = applyDelta(state, stateDelta, nextSeq);

  return {
    ok: true,
    checkId,
    success,
    ...(autoFailed ? { autoFailed: true } : {}),
    margin,
    total,
    dc: resolvedDc.dc,
    naturalRoll,
    modifier: saveBreakdown.totalMod,
    breakdown: saveBreakdown.breakdown,
    effectiveMode,
    rolls,
    event,
    nextState,
  };
}

// ---------- declare_check ----------

export const DeclareCheckInputSchema = z
  .object({
    sceneId: z.string().min(1),
    actorId: z.string().min(1),
    skill: CheckTargetSchema,
    dc: z.number().int().min(1).max(40).optional(),
    dcRef: z.string().min(1).optional(),
    declaredTotal: z.number().int().optional(),
    dieResults: z.array(z.number().int().min(1).max(20)).min(1).max(2),
    mode: RollModeSchema.optional(),
    visibility: VisibilitySchema.optional(),
    checkId: z.string().min(1).optional(),
  })
  .strict();
export type DeclareCheckInput = z.infer<typeof DeclareCheckInputSchema>;

// Loose structural pre-parser so out-of-range dice produce structured IMPOSSIBLE_DIE errors.
const DeclareCheckShapeSchema = z
  .object({
    sceneId: z.string().min(1),
    actorId: z.string().min(1),
    skill: CheckTargetSchema,
    dc: z.number().int().min(1).max(40).optional(),
    dcRef: z.string().min(1).optional(),
    declaredTotal: z.number().int().optional(),
    dieResults: z.array(z.number()),
    mode: RollModeSchema.optional(),
    visibility: VisibilitySchema.optional(),
    checkId: z.string().min(1).optional(),
  })
  .strict();

export type DeclareCheckResult =
  | {
      ok: true;
      checkId: string;
      success: boolean;
      margin: number;
      total: number;
      dc: number;
      declaredTotal: number;
      naturalRoll: number;
      expectedModifier: number;
      breakdown?: ResolvedModifierEntry[];
      stateDelta: GameStateDelta;
      event: GameEvent;
      nextState: GameState;
    }
  | {
      ok: false;
      code:
        | 'IMPOSSIBLE_DIE'
        | 'INCOHERENT_TOTAL'
        | 'UNKNOWN_ACTOR'
        | 'INVALID_SCENE'
        | 'INVALID_INPUT'
        | 'WRONG_MODE'
        | 'DC_REQUIRED';
      messageEs: string;
      expectedRange: { min: number; max: number };
    };

function pickNaturalRoll(dieResults: readonly number[], mode: RollMode): number {
  const first = dieResults[0] ?? 1;
  if (mode === 'normal' || dieResults.length === 1) {
    return first;
  }
  const second = dieResults[1] ?? first;
  return mode === 'advantage' ? Math.max(first, second) : Math.min(first, second);
}

function validatePaperPlayerTotal(
  actor: Character,
  naturalRoll: number,
  declaredTotal: number,
  diceRange: { min: number; max: number } = { min: 0, max: 0 },
): { valid: boolean; expectedRange: { min: number; max: number } } {
  const pb = getProficiencyBonus(actor.level);
  const minMod = -5 + diceRange.min;
  const maxMod = 10 + 2 * pb + diceRange.max;
  const expectedRange = {
    min: naturalRoll + minMod,
    max: naturalRoll + maxMod,
  };
  return {
    valid: declaredTotal >= expectedRange.min && declaredTotal <= expectedRange.max,
    expectedRange,
  };
}

export function declareCheck(
  state: GameState,
  rawInput: unknown,
  ctx: ResolverContext,
): DeclareCheckResult {
  const shape = DeclareCheckShapeSchema.safeParse(rawInput);
  if (!shape.success) {
    return {
      ok: false,
      code: 'INVALID_INPUT',
      messageEs: `Entrada inválida en declare_check: ${shape.error.issues[0]?.message ?? 'formato incorrecto'}.`,
      expectedRange: { min: 1, max: 20 },
    };
  }

  const input = shape.data;
  if (input.sceneId !== state.sceneId || !state.scenes[input.sceneId]) {
    return {
      ok: false,
      code: 'INVALID_SCENE',
      messageEs: `La escena "${input.sceneId}" no coincide con la escena activa ("${state.sceneId}").`,
      expectedRange: { min: 1, max: 20 },
    };
  }

  const actor = state.characters[input.actorId];
  if (!actor) {
    return {
      ok: false,
      code: 'UNKNOWN_ACTOR',
      messageEs: `No existe el personaje "${input.actorId}" en el estado actual.`,
      expectedRange: { min: 1, max: 20 },
    };
  }

  if (actor.rollAuthority === 'engine-rolled') {
    return {
      ok: false,
      code: 'WRONG_MODE',
      messageEs: `El personaje "${actor.id}" usa tiradas del motor: usá resolve_check en lugar de declare_check.`,
      expectedRange: { min: 1, max: 20 },
    };
  }

  const resolvedDc = resolveSceneDc(
    state,
    input.sceneId,
    input.dcRef,
    input.dc,
  );
  if (!resolvedDc.ok) {
    return {
      ok: false,
      code: resolvedDc.code,
      messageEs: resolvedDc.messageEs,
      expectedRange: { min: 1, max: 20 },
    };
  }

  const skillAbility =
    input.skill in SKILL_TO_ABILITY
      ? SKILL_TO_ABILITY[input.skill as keyof typeof SKILL_TO_ABILITY]
      : input.skill;
  const declareTags = buildRollTags({
    kind: 'check',
    skill: input.skill,
    ability: skillAbility as Character['savingThrowProficiencies'][number],
    conditions: actor.conditions,
    inCombat: Boolean(state.combat?.active),
    sceneId: input.sceneId,
  });
  const modBreakdown = getCheckModifier(actor, input.skill, state.ruleset, {
    ...(input.declaredTotal === undefined ? { rng: ctx.rng } : {}),
    tags: declareTags,
  });
  const effectiveMode = resolveRollMode({
    requested: input.mode ?? 'normal',
    hasAdvantage: modBreakdown.grantsAdvantage,
    hasDisadvantage: modBreakdown.imposesDisadvantage,
  });
  const expectedDieCount = effectiveMode === 'normal' ? 1 : 2;

  if (input.dieResults.length !== expectedDieCount) {
    return {
      ok: false,
      code: 'IMPOSSIBLE_DIE',
      messageEs: `Se esperaban ${expectedDieCount} dado(s) para el modo "${effectiveMode}", pero se recibieron ${input.dieResults.length}. Corregí la tirada.`,
      expectedRange: { min: 1, max: 20 },
    };
  }

  for (const die of input.dieResults) {
    if (!Number.isInteger(die) || die < 1 || die > 20) {
      return {
        ok: false,
        code: 'IMPOSSIBLE_DIE',
        messageEs: `Valor de d20 imposible (${die}). Cada dado debe estar entre 1 y 20. Corregí la tirada.`,
        expectedRange: { min: 1, max: 20 },
      };
    }
  }

  const naturalRoll = pickNaturalRoll(input.dieResults, effectiveMode);
  const sheetAuthority = actor.authority.skills;

  let resolvedTotal: number;
  if (input.declaredTotal === undefined) {
    resolvedTotal = naturalRoll + modBreakdown.totalMod;
  } else if (sheetAuthority === 'player') {
    const check = validatePaperPlayerTotal(
      actor,
      naturalRoll,
      input.declaredTotal,
      modBreakdown.diceBonusRange,
    );
    if (!check.valid) {
      return {
        ok: false,
        code: 'INCOHERENT_TOTAL',
        messageEs: `El total declarado (${input.declaredTotal}) es físicamente incoherente con el dado (${naturalRoll}) para nivel ${actor.level}. Esperado entre ${check.expectedRange.min} y ${check.expectedRange.max}. Corregilo antes de continuar.`,
        expectedRange: check.expectedRange,
      };
    }
    resolvedTotal = input.declaredTotal;
  } else {
    const minTotal =
      naturalRoll + modBreakdown.totalMod + modBreakdown.diceBonusRange.min;
    const maxTotal =
      naturalRoll + modBreakdown.totalMod + modBreakdown.diceBonusRange.max;
    const expectedRange = {
      min: 1 + modBreakdown.totalMod + modBreakdown.diceBonusRange.min,
      max: 20 + modBreakdown.totalMod + modBreakdown.diceBonusRange.max,
    };
    if (input.declaredTotal < minTotal || input.declaredTotal > maxTotal) {
      return {
        ok: false,
        code: 'INCOHERENT_TOTAL',
        messageEs:
          minTotal === maxTotal
            ? `Total incoherente: declaraste ${input.declaredTotal}, pero ${naturalRoll} + (${modBreakdown.totalMod >= 0 ? '+' : ''}${modBreakdown.totalMod}) = ${minTotal}. Corregí el total.`
            : `Total incoherente: declaraste ${input.declaredTotal}, pero con bonificadores activos debe estar entre ${minTotal} y ${maxTotal}. Corregí el total.`,
        expectedRange,
      };
    }
    resolvedTotal = input.declaredTotal;
  }

  const success = resolvedTotal >= resolvedDc.dc;
  const margin = resolvedTotal - resolvedDc.dc;
  const checkId = input.checkId ?? ctx.createId();
  const nextSeq = state.lastSeq + 1;

  const stateDelta: GameStateDelta = {
    flagsSet: {
      [`check:${checkId}:success`]: success,
    },
    ...(modBreakdown.consumedEffectIds.length > 0
      ? {
          effectsRemoved: modBreakdown.consumedEffectIds.map((effectId) => ({
            targetId: actor.id,
            effectId,
          })),
        }
      : {}),
  };

  const event: GameEvent = {
    id: ctx.createId(),
    campaignId: state.campaignId,
    sessionId: state.sessionId,
    seq: nextSeq,
    type: 'CHECK_RESOLVED',
    source: 'player-declared',
    visibility: input.visibility ?? 'public',
    actor: actor.id,
    checkId,
    declaredTotal: resolvedTotal,
    dieResults: [...input.dieResults],
    payload: {
      sceneId: input.sceneId,
      skill: input.skill,
      dc: resolvedDc.dc,
      dcRef: input.dcRef ?? null,
      dcSource: resolvedDc.source,
      dcDeclaredByModel: input.dc ?? null,
      mode: effectiveMode,
      expectedModifier: modBreakdown.totalMod,
      breakdown: modBreakdown.breakdown,
      total: resolvedTotal,
      success,
      margin,
    },
    stateDelta,
    revertedByEventId: null,
    createdAt: ctx.now(),
  };

  const nextState = applyDelta(state, stateDelta, nextSeq);

  return {
    ok: true,
    checkId,
    success,
    margin,
    total: resolvedTotal,
    dc: resolvedDc.dc,
    declaredTotal: resolvedTotal,
    naturalRoll,
    expectedModifier: modBreakdown.totalMod,
    breakdown: modBreakdown.breakdown,
    stateDelta,
    event,
    nextState,
  };
}

// ---------- resolve_investigate ----------

export const ResolveInvestigateInputSchema = z
  .object({
    sceneId: z.string().min(1),
    actorId: z.string().min(1),
    skill: z.enum(['investigation', 'perception']).optional(),
    mode: RollModeSchema.optional(),
    declared: z
      .object({
        declaredTotal: z.number().int().optional(),
        dieResults: z.array(z.number()),
      })
      .strict()
      .optional(),
    visibility: VisibilitySchema.optional(),
    checkId: z.string().min(1).optional(),
  })
  .strict();
export type ResolveInvestigateInput = z.infer<
  typeof ResolveInvestigateInputSchema
>;

export type ResolveInvestigateResult =
  | {
      ok: true;
      checkId: string;
      total: number;
      naturalRoll: number;
      modifier: number;
      breakdown?: ResolvedModifierEntry[];
      unlockedClues: SceneClue[];
      allUnlockedClueIds: string[];
      event: GameEvent;
      nextState: GameState;
    }
  | {
      ok: false;
      code:
        | 'INVALID_INPUT'
        | 'INVALID_SCENE'
        | 'UNKNOWN_ACTOR'
        | 'IMPOSSIBLE_DIE'
        | 'INCOHERENT_TOTAL'
        | 'WRONG_MODE'
        | 'DC_REQUIRED';
      messageEs: string;
      expectedRange?: { min: number; max: number };
    };

export function resolveInvestigate(
  state: GameState,
  rawInput: unknown,
  ctx: ResolverContext,
): ResolveInvestigateResult {
  const parsed = ResolveInvestigateInputSchema.safeParse(rawInput);
  if (!parsed.success) {
    return {
      ok: false,
      code: 'INVALID_INPUT',
      messageEs: `Parámetros inválidos en investigate: ${parsed.error.issues[0]?.message ?? 'formato incorrecto'}.`,
    };
  }

  const input = parsed.data;
  const scene = state.scenes[input.sceneId];
  if (input.sceneId !== state.sceneId || !scene) {
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
      messageEs: `No existe el personaje "${input.actorId}" en el estado actual.`,
    };
  }

  const skill = input.skill ?? 'investigation';
  const checkId = input.checkId ?? ctx.createId();
  let total: number;
  let naturalRoll: number;
  let modifier: number;
  let breakdown: ResolvedModifierEntry[] | undefined;
  let effectsRemoved: GameStateDelta['effectsRemoved'];
  let dieResults: number[];
  let source: 'engine' | 'player-declared';
  let declaredTotal: number | null;

  if (input.declared) {
    const lowestDc = scene.clues.reduce(
      (min, clue) => (clue.dc < min ? clue.dc : min),
      12,
    );
    const declResult = declareCheck(
      state,
      {
        sceneId: input.sceneId,
        actorId: input.actorId,
        skill,
        dc: lowestDc,
        ...(input.declared.declaredTotal !== undefined
          ? { declaredTotal: input.declared.declaredTotal }
          : {}),
        dieResults: input.declared.dieResults,
        ...(input.mode ? { mode: input.mode } : {}),
        ...(input.visibility ? { visibility: input.visibility } : {}),
        checkId,
      },
      ctx,
    );
    if (!declResult.ok) {
      return {
        ok: false,
        code: declResult.code,
        messageEs: declResult.messageEs,
        expectedRange: declResult.expectedRange,
      };
    }

    total = declResult.total;
    naturalRoll = declResult.naturalRoll;
    modifier = declResult.expectedModifier;
    breakdown = declResult.breakdown;
    effectsRemoved = declResult.stateDelta.effectsRemoved;
    dieResults = [...input.declared.dieResults];
    source = 'player-declared';
    declaredTotal = declResult.declaredTotal;
  } else {
    if (actor.rollAuthority === 'player-declared') {
      return {
        ok: false,
        code: 'WRONG_MODE',
        messageEs: `El personaje "${actor.id}" está en Modo Híbrido (dados físicos): pedí la tirada al jugador con declare_check (purpose: "investigate") en lugar de tirar con investigate.`,
      };
    }
    const ability = SKILL_TO_ABILITY[skill];
    const tags = buildRollTags({
      kind: 'check',
      skill,
      ability,
      conditions: actor.conditions,
      inCombat: Boolean(state.combat?.active),
      sceneId: input.sceneId,
    });
    const modBreakdown = getCheckModifier(actor, skill, state.ruleset, {
      rng: ctx.rng,
      tags,
    });
    const effectiveMode = resolveRollMode({
      requested: input.mode ?? 'normal',
      hasAdvantage: modBreakdown.grantsAdvantage,
      hasDisadvantage: modBreakdown.imposesDisadvantage,
    });
    const roll = rollD20(ctx.rng, effectiveMode);
    total = roll.chosen + modBreakdown.totalMod;
    naturalRoll = roll.chosen;
    modifier = modBreakdown.totalMod;
    breakdown = modBreakdown.breakdown;
    if (modBreakdown.consumedEffectIds.length > 0) {
      effectsRemoved = modBreakdown.consumedEffectIds.map((effectId) => ({
        targetId: actor.id,
        effectId,
      }));
    }
    dieResults = roll.rolls;
    source = 'engine';
    declaredTotal = null;
  }

  const alreadyUnlocked = new Set(state.unlockedClues[input.sceneId] ?? []);
  const newlyUnlocked = scene.clues.filter(
    (clue) => clue.dc <= total && !alreadyUnlocked.has(clue.id),
  );
  const nextSeq = state.lastSeq + 1;

  const stateDelta: GameStateDelta = {
    cluesUnlocked: newlyUnlocked.map((c) => c.id),
    ...(effectsRemoved && effectsRemoved.length > 0 ? { effectsRemoved } : {}),
  };

  const event: GameEvent = {
    id: ctx.createId(),
    campaignId: state.campaignId,
    sessionId: state.sessionId,
    seq: nextSeq,
    type: 'CLUES_UNLOCKED',
    source,
    visibility: input.visibility ?? 'public',
    actor: actor.id,
    checkId,
    declaredTotal,
    dieResults,
    payload: {
      sceneId: input.sceneId,
      skill,
      total,
      ...(breakdown ? { breakdown } : {}),
      newlyUnlockedIds: newlyUnlocked.map((c) => c.id),
    },
    stateDelta,
    revertedByEventId: null,
    createdAt: ctx.now(),
  };

  const nextState = applyDelta(state, stateDelta, nextSeq);

  return {
    ok: true,
    checkId,
    total,
    naturalRoll,
    modifier,
    ...(breakdown ? { breakdown } : {}),
    unlockedClues: newlyUnlocked,
    allUnlockedClueIds: nextState.unlockedClues[input.sceneId] ?? [],
    event,
    nextState,
  };
}

// ---------- transition_scene ----------

export const TransitionSceneInputSchema = z
  .object({
    targetSceneId: z.string().min(1),
    actorId: z.string().min(1).optional(),
    reason: z.string().min(1),
    visibility: VisibilitySchema.optional(),
  })
  .strict();
export type TransitionSceneInput = z.infer<typeof TransitionSceneInputSchema>;

export type TransitionSceneResult =
  | {
      ok: true;
      fromSceneId: string;
      toSceneId: string;
      event: GameEvent;
      nextState: GameState;
    }
  | {
      ok: false;
      code: 'INVALID_INPUT' | 'INVALID_SCENE' | 'FORBIDDEN_TRANSITION' | 'MISSING_PRECONDITION';
      messageEs: string;
    };

export function transitionScene(
  state: GameState,
  rawInput: unknown,
  ctx: ResolverContext,
): TransitionSceneResult {
  const parsed = TransitionSceneInputSchema.safeParse(rawInput);
  if (!parsed.success) {
    return {
      ok: false,
      code: 'INVALID_INPUT',
      messageEs: `Parámetros inválidos en transition_scene: ${parsed.error.issues[0]?.message ?? 'formato incorrecto'}.`,
    };
  }

  const input = parsed.data;
  const currentScene = state.scenes[state.sceneId];
  const targetScene = state.scenes[input.targetSceneId];

  if (!currentScene || !targetScene) {
    return {
      ok: false,
      code: 'INVALID_SCENE',
      messageEs: `Escena destino desconocida: "${input.targetSceneId}".`,
    };
  }

  if (!currentScene.allowedTransitions.includes(input.targetSceneId)) {
    return {
      ok: false,
      code: 'FORBIDDEN_TRANSITION',
      messageEs: `Transición no permitida desde "${state.sceneId}" hacia "${input.targetSceneId}".`,
    };
  }

  const requirement =
    currentScene.transitionRequirements?.[
      `${state.sceneId}>${input.targetSceneId}`
    ];
  if (requirement) {
    const unlockedClues = new Set(state.unlockedClues[state.sceneId] ?? []);
    const missingClues = (requirement.requiredClues ?? []).filter(
      (clueId) => !unlockedClues.has(clueId),
    );
    const missingFlags = (requirement.requiredFlags ?? []).filter(
      (flag) => !state.flags[flag],
    );
    if (missingClues.length > 0 || missingFlags.length > 0) {
      const missing = [
        ...missingClues.map((clueId) => `pista "${clueId}"`),
        ...missingFlags.map((flag) => `flag "${flag}"`),
      ];
      return {
        ok: false,
        code: 'MISSING_PRECONDITION',
        messageEs: `Faltan requisitos para avanzar a "${input.targetSceneId}": ${missing.join(', ')}. Usá investigate en la escena actual para desbloquearlos.`,
      };
    }
  }

  const nextSeq = state.lastSeq + 1;
  const stateDelta: GameStateDelta = {
    sceneId: input.targetSceneId,
  };

  const event: GameEvent = {
    id: ctx.createId(),
    campaignId: state.campaignId,
    sessionId: state.sessionId,
    seq: nextSeq,
    type: 'SCENE_TRANSITION',
    source: 'engine',
    visibility: input.visibility ?? 'public',
    actor: input.actorId ?? 'system',
    checkId: null,
    declaredTotal: null,
    dieResults: null,
    payload: {
      fromSceneId: state.sceneId,
      toSceneId: input.targetSceneId,
      reason: input.reason,
    },
    stateDelta,
    revertedByEventId: null,
    createdAt: ctx.now(),
  };

  const nextState = applyDelta(state, stateDelta, nextSeq);

  return {
    ok: true,
    fromSceneId: state.sceneId,
    toSceneId: input.targetSceneId,
    event,
    nextState,
  };
}

// ---------- resolve_damage_roll ----------

export const ResolveDamageRollInputSchema = z
  .object({
    sceneId: z.string().min(1),
    sourceActorId: z.string().min(1),
    targetActorId: z.string().min(1),
    diceExpression: z.string().min(1),
    damageType: z.string().min(1).optional(),
    visibility: VisibilitySchema.optional(),
  })
  .strict();
export type ResolveDamageRollInput = z.infer<
  typeof ResolveDamageRollInputSchema
>;

export type ResolveDamageRollResult =
  | {
      ok: true;
      damageRolled: number;
      damageApplied: number;
      damageRelation: DamageRelation;
      rolls: number[];
      hpBefore: number;
      hpAfter: number;
      concentrationCheck?: ConcentrationCheckOutcome;
      event: GameEvent;
      nextState: GameState;
    }
  | {
      ok: false;
      code:
        | 'INVALID_INPUT'
        | 'INVALID_SCENE'
        | 'UNKNOWN_ACTOR'
        | 'INVALID_DICE_EXPRESSION';
      messageEs: string;
    };

export function resolveDamageRoll(
  state: GameState,
  rawInput: unknown,
  ctx: ResolverContext,
): ResolveDamageRollResult {
  const parsed = ResolveDamageRollInputSchema.safeParse(rawInput);
  if (!parsed.success) {
    return {
      ok: false,
      code: 'INVALID_INPUT',
      messageEs: `Parámetros inválidos en resolve_damage_roll: ${parsed.error.issues[0]?.message ?? 'formato incorrecto'}.`,
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

  const target = state.characters[input.targetActorId];
  if (!target) {
    return {
      ok: false,
      code: 'UNKNOWN_ACTOR',
      messageEs: `No existe el objetivo "${input.targetActorId}" en el estado actual.`,
    };
  }

  let rollResult;
  try {
    rollResult = rollDice(input.diceExpression, ctx.rng);
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

  const damageRolled = Math.max(0, rollResult.total);
  const dmgRel = input.damageType
    ? resolveDamageRelation(damageRolled, input.damageType, {
        resistances: target.resistances,
      })
    : { relation: 'normal' as DamageRelation, damageApplied: damageRolled };
  const damageApplied = dmgRel.damageApplied;

  const absorbedByTemp = Math.min(target.hp.temp, damageApplied);
  const remainingDamage = damageApplied - absorbedByTemp;
  const hpBefore = target.hp.current;
  const hpAfter = Math.max(0, hpBefore - remainingDamage);
  const concentrationCheck = evaluateConcentrationCheck({
    character: target,
    damageApplied,
    hpAfter,
    ruleset: state.ruleset,
    rng: ctx.rng,
  });
  const nextSeq = state.lastSeq + 1;

  const stateDelta: GameStateDelta = {
    hpChanges: [
      {
        actorId: target.id,
        before: hpBefore,
        after: hpAfter,
      },
    ],
    ...(absorbedByTemp > 0
      ? {
          tempHpChanges: [
            {
              actorId: target.id,
              before: target.hp.temp,
              after: Math.max(0, target.hp.temp - absorbedByTemp),
            },
          ],
        }
      : {}),
    ...(concentrationCheck && !concentrationCheck.maintained && target.concentratingOn
      ? {
          concentrationChanges: [
            {
              actorId: target.id,
              before: target.concentratingOn,
              after: null,
            },
          ],
        }
      : {}),
  };

  const event: GameEvent = {
    id: ctx.createId(),
    campaignId: state.campaignId,
    sessionId: state.sessionId,
    seq: nextSeq,
    type: 'DAMAGE_APPLIED',
    source: 'engine',
    visibility: input.visibility ?? 'public',
    actor: input.sourceActorId,
    checkId: null,
    declaredTotal: null,
    dieResults: null,
    payload: {
      sceneId: input.sceneId,
      sourceActorId: input.sourceActorId,
      targetActorId: target.id,
      diceExpression: input.diceExpression,
      damageType: input.damageType ?? null,
      damageRelation: dmgRel.relation,
      rolls: rollResult.rolls,
      damageRolled,
      damageApplied,
      absorbedByTemp,
      concentrationCheck: concentrationCheck ?? null,
    },
    stateDelta,
    revertedByEventId: null,
    createdAt: ctx.now(),
  };

  const nextState = applyDelta(state, stateDelta, nextSeq);

  return {
    ok: true,
    damageRolled,
    damageApplied,
    damageRelation: dmgRel.relation,
    rolls: rollResult.rolls,
    hpBefore,
    hpAfter,
    ...(concentrationCheck ? { concentrationCheck } : {}),
    event,
    nextState,
  };
}

// ---------- resolve_inventory_change ----------

export const ResolveInventoryChangeInputSchema = z
  .object({
    sceneId: z.string().min(1),
    actorId: z.string().min(1),
    itemId: z.string().min(1),
    itemName: z.string().min(1).optional(),
    qtyDelta: z
      .number()
      .int()
      .min(-99)
      .max(99)
      .refine((v) => v !== 0, 'qtyDelta no puede ser 0.'),
    reason: z.string().min(1),
    visibility: VisibilitySchema.optional(),
  })
  .strict();
export type ResolveInventoryChangeInput = z.infer<
  typeof ResolveInventoryChangeInputSchema
>;

export type ResolveInventoryChangeResult =
  | {
      ok: true;
      itemId: string;
      itemName: string;
      quantityBefore: number;
      quantityAfter: number;
      event: GameEvent;
      nextState: GameState;
    }
  | {
      ok: false;
      code: 'INVALID_INPUT' | 'INVALID_SCENE' | 'UNKNOWN_ACTOR';
      messageEs: string;
    };

export function resolveInventoryChange(
  state: GameState,
  rawInput: unknown,
  ctx: ResolverContext,
): ResolveInventoryChangeResult {
  const parsed = ResolveInventoryChangeInputSchema.safeParse(rawInput);
  if (!parsed.success) {
    return {
      ok: false,
      code: 'INVALID_INPUT',
      messageEs: `Parámetros inválidos en inventory: ${parsed.error.issues[0]?.message ?? 'formato incorrecto'}.`,
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
      messageEs: `No existe el personaje "${input.actorId}" en el estado actual.`,
    };
  }

  const existing = actor.inventory.find((i) => i.itemId === input.itemId);
  const quantityBefore = existing?.quantity ?? 0;
  const quantityAfter = Math.max(0, quantityBefore + input.qtyDelta);
  const resolvedName = existing?.name ?? input.itemName ?? input.itemId;
  const nextSeq = state.lastSeq + 1;

  const stateDelta: GameStateDelta = {
    inventoryDelta: [
      {
        actorId: actor.id,
        itemId: input.itemId,
        ...(input.itemName ? { name: input.itemName } : {}),
        qtyDelta: input.qtyDelta,
      },
    ],
  };

  const event: GameEvent = {
    id: ctx.createId(),
    campaignId: state.campaignId,
    sessionId: state.sessionId,
    seq: nextSeq,
    type: 'INVENTORY_CHANGED',
    source: 'engine',
    visibility: input.visibility ?? 'public',
    actor: actor.id,
    checkId: null,
    declaredTotal: null,
    dieResults: null,
    payload: {
      sceneId: input.sceneId,
      itemId: input.itemId,
      itemName: resolvedName,
      qtyDelta: input.qtyDelta,
      quantityBefore,
      quantityAfter,
      reason: input.reason,
    },
    stateDelta,
    revertedByEventId: null,
    createdAt: ctx.now(),
  };

  const nextState = applyDelta(state, stateDelta, nextSeq);

  return {
    ok: true,
    itemId: input.itemId,
    itemName: resolvedName,
    quantityBefore,
    quantityAfter,
    event,
    nextState,
  };
}

// ---------- resolve_condition_change ----------

const INCAPACITATING_CONDITIONS_SET = new Set<Condition5e>([
  'incapacitated',
  'paralyzed',
  'petrified',
  'stunned',
  'unconscious',
]);

export const ResolveConditionChangeInputSchema = z
  .object({
    sceneId: z.string().min(1),
    actorId: z.string().min(1),
    addConditions: z.array(Condition5eSchema).min(1).optional(),
    removeConditions: z.array(Condition5eSchema).min(1).optional(),
    exhaustionDelta: z.number().int().min(-6).max(6).optional(),
    concentratingOn: z.string().min(1).nullable().optional(),
    durationRounds: z.number().int().min(1).max(100).optional(),
    expiryTiming: EffectExpiryTimingSchema.optional(),
    reason: z.string().min(1),
    visibility: VisibilitySchema.optional(),
  })
  .strict();
export type ResolveConditionChangeInput = z.infer<
  typeof ResolveConditionChangeInputSchema
>;

export type ResolveConditionChangeResult =
  | {
      ok: true;
      actorId: string;
      conditionsAfter: Condition5e[];
      exhaustionLevelAfter: number;
      concentratingOnAfter: string | null;
      event: GameEvent;
      nextState: GameState;
    }
  | {
      ok: false;
      code: 'INVALID_INPUT' | 'INVALID_SCENE' | 'UNKNOWN_ACTOR';
      messageEs: string;
    };

export function resolveConditionChange(
  state: GameState,
  rawInput: unknown,
  ctx: ResolverContext,
): ResolveConditionChangeResult {
  const parsed = ResolveConditionChangeInputSchema.safeParse(rawInput);
  if (!parsed.success) {
    return {
      ok: false,
      code: 'INVALID_INPUT',
      messageEs: `Parámetros inválidos en apply_condition: ${parsed.error.issues[0]?.message ?? 'formato incorrecto'}.`,
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
      messageEs: `No existe el personaje "${input.actorId}" en el estado actual.`,
    };
  }

  const hasMutation =
    (input.addConditions && input.addConditions.length > 0) ||
    (input.removeConditions && input.removeConditions.length > 0) ||
    (input.exhaustionDelta !== undefined && input.exhaustionDelta !== 0) ||
    input.concentratingOn !== undefined;

  if (!hasMutation) {
    return {
      ok: false,
      code: 'INVALID_INPUT',
      messageEs:
        'Debés indicar al menos un cambio de condición, nivel de agotamiento o concentración.',
    };
  }

  const uniqueAdd = Array.from(new Set(input.addConditions ?? []));
  const uniqueRemove = Array.from(new Set(input.removeConditions ?? []));

  let effectiveExhaustionDelta = input.exhaustionDelta;
  if (effectiveExhaustionDelta === undefined) {
    if (uniqueAdd.includes('exhaustion')) {
      effectiveExhaustionDelta = 1;
    } else if (uniqueRemove.includes('exhaustion')) {
      effectiveExhaustionDelta = -actor.exhaustionLevel;
    }
  }

  const nextExhaustion =
    effectiveExhaustionDelta !== undefined
      ? Math.max(0, Math.min(6, actor.exhaustionLevel + effectiveExhaustionDelta))
      : actor.exhaustionLevel;

  const conditionsAdded: Array<{ actorId: string; condition: Condition5e }> =
    uniqueAdd
      .filter((c) => c !== 'exhaustion')
      .map((condition) => ({ actorId: actor.id, condition }));
  if (nextExhaustion > 0 && !actor.conditions.includes('exhaustion')) {
    conditionsAdded.push({ actorId: actor.id, condition: 'exhaustion' });
  }

  const conditionsRemoved: Array<{ actorId: string; condition: Condition5e }> =
    uniqueRemove
      .filter((c) => c !== 'exhaustion')
      .map((condition) => ({ actorId: actor.id, condition }));
  if (nextExhaustion === 0 && actor.conditions.includes('exhaustion')) {
    conditionsRemoved.push({ actorId: actor.id, condition: 'exhaustion' });
  }

  const addedIncapacitating = uniqueAdd.some((c) =>
    INCAPACITATING_CONDITIONS_SET.has(c),
  );
  const removedSet = new Set(uniqueRemove);
  const remainsIncapacitated =
    addedIncapacitating ||
    actor.conditions.some(
      (c) => !removedSet.has(c) && INCAPACITATING_CONDITIONS_SET.has(c),
    );

  let concentrationChanges:
    | Array<{ actorId: string; before: string | null; after: string | null }>
    | undefined;
  const concPurgeEffects: Array<{ targetId: string; effectId: string }> = [];

  if (addedIncapacitating || (input.concentratingOn && remainsIncapacitated)) {
    if (actor.concentratingOn !== null) {
      const purged = collectConcentrationPurge(state, actor.id, actor.concentratingOn);
      concPurgeEffects.push(...purged.effectsRemoved);
      for (const rem of purged.conditionsRemoved) {
        if (!conditionsRemoved.some((c) => c.actorId === rem.actorId && c.condition === rem.condition)) {
          conditionsRemoved.push(rem);
        }
      }
      concentrationChanges = [
        { actorId: actor.id, before: actor.concentratingOn, after: null },
      ];
    }
  } else if (
    input.concentratingOn !== undefined &&
    input.concentratingOn !== actor.concentratingOn
  ) {
    if (actor.concentratingOn) {
      const purged = collectConcentrationPurge(state, actor.id, actor.concentratingOn);
      concPurgeEffects.push(...purged.effectsRemoved);
      for (const rem of purged.conditionsRemoved) {
        if (!conditionsRemoved.some((c) => c.actorId === rem.actorId && c.condition === rem.condition)) {
          conditionsRemoved.push(rem);
        }
      }
    }
    concentrationChanges = [
      {
        actorId: actor.id,
        before: actor.concentratingOn,
        after: input.concentratingOn,
      },
    ];
  }

  const timedEffectsAdded: Array<{ targetId: string; effect: ActiveEffect }> = [];
  if (input.durationRounds !== undefined && uniqueAdd.length > 0) {
    for (const cond of uniqueAdd) {
      if (cond === 'exhaustion') continue;
      timedEffectsAdded.push({
        targetId: actor.id,
        effect: {
          id: ctx.createId(),
          slug: `condition:${cond}`,
          labelEs: cond,
          durationRounds: input.durationRounds,
          remainingRounds: input.durationRounds,
          expiryTiming: input.expiryTiming ?? 'end_of_owner_turn',
          expiresOnCombatEnd: false,
          expiresOnRest: 'long',
          linkedCondition: cond,
          modifiers: [],
        },
      });
    }
  }

  const stateDelta: GameStateDelta = {
    ...(conditionsAdded.length > 0 ? { conditionsAdded } : {}),
    ...(conditionsRemoved.length > 0 ? { conditionsRemoved } : {}),
    ...(timedEffectsAdded.length > 0 ? { effectsAdded: timedEffectsAdded } : {}),
    ...(concPurgeEffects.length > 0 ? { effectsRemoved: concPurgeEffects } : {}),
    ...(nextExhaustion !== actor.exhaustionLevel
      ? {
          exhaustionChanges: [
            {
              actorId: actor.id,
              before: actor.exhaustionLevel,
              after: nextExhaustion,
            },
          ],
        }
      : {}),
    ...(concentrationChanges ? { concentrationChanges } : {}),
  };

  const nextSeq = state.lastSeq + 1;
  const event: GameEvent = {
    id: ctx.createId(),
    campaignId: state.campaignId,
    sessionId: state.sessionId,
    seq: nextSeq,
    type: 'CONDITION_CHANGED',
    source: 'engine',
    visibility: input.visibility ?? 'public',
    actor: actor.id,
    checkId: null,
    declaredTotal: null,
    dieResults: null,
    payload: {
      sceneId: input.sceneId,
      actorId: actor.id,
      addConditions: uniqueAdd,
      removeConditions: uniqueRemove,
      exhaustionBefore: actor.exhaustionLevel,
      exhaustionAfter: nextExhaustion,
      reason: input.reason,
    },
    stateDelta,
    revertedByEventId: null,
    createdAt: ctx.now(),
  };

  const nextState = applyDelta(state, stateDelta, nextSeq);
  const updatedActor = nextState.characters[actor.id]!;

  return {
    ok: true,
    actorId: actor.id,
    conditionsAfter: [...updatedActor.conditions],
    exhaustionLevelAfter: updatedActor.exhaustionLevel,
    concentratingOnAfter: updatedActor.concentratingOn,
    event,
    nextState,
  };
}
