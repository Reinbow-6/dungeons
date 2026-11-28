import { parseDiceExpression, rollDice, type Rng } from './rng.js';
import type {
  Ability,
  ActiveEffect,
  Character,
  Combatant,
  Condition5e,
  EffectExpiryTiming,
  GameState,
  ModifierTarget,
  ResolvedModifierEntry,
  SourcedModifier,
} from './types.js';

export interface ExpiredEffectSummary {
  targetId: string;
  targetName: string;
  effectId: string;
  slug: string;
  labelEs: string;
  linkedConditionRemoved?: Condition5e;
}

export interface SignedDiceRange {
  sign: 1 | -1;
  diceExpr: string;
  min: number;
  max: number;
}

const SIGNED_DICE_REGEX = /^\s*([+-])?\s*(.+)$/;

/**
 * Parses a signed additive dice expression like `"+1d4"` or `"-1d4"` into
 * a deterministic min/max contribution range.
 */
export function parseSignedDiceRange(expr: string): SignedDiceRange | null {
  const match = SIGNED_DICE_REGEX.exec(expr);
  if (!match) return null;
  const sign: 1 | -1 = match[1] === '-' ? -1 : 1;
  const inner = (match[2] ?? '').trim();
  if (!inner) return null;

  try {
    const parsed = parseDiceExpression(inner);
    const minAbs = parsed.count + parsed.modifier;
    const maxAbs = parsed.count * parsed.sides + parsed.modifier;
    const a = sign * minAbs;
    const b = sign * maxAbs;
    return {
      sign,
      diceExpr: `${parsed.count}d${parsed.sides}${parsed.modifier > 0 ? `+${parsed.modifier}` : parsed.modifier < 0 ? `${parsed.modifier}` : ''}`,
      min: Math.min(a, b),
      max: Math.max(a, b),
    };
  } catch {
    return null;
  }
}

/**
 * Evaluates a declarative predicate list (`['tag', '!excluded']`) against roll/context tags.
 */
export function evaluatePredicate(
  predicate: readonly string[] | undefined,
  tags: ReadonlySet<string>,
): boolean {
  if (!predicate || predicate.length === 0) return true;
  for (const clause of predicate) {
    if (clause.startsWith('!')) {
      const forbidden = clause.slice(1);
      if (forbidden && tags.has(forbidden)) return false;
    } else if (!tags.has(clause)) {
      return false;
    }
  }
  return true;
}

/**
 * Builds deterministic roll/context tags for declarative modifier predicates.
 */
export function buildRollTags(params: {
  kind: ModifierTarget;
  skill?: string;
  ability?: Ability;
  attackKind?: 'melee' | 'ranged';
  requiresSight?: boolean;
  conditions?: readonly Condition5e[];
  inCombat?: boolean;
  sceneId?: string;
}): Set<string> {
  const tags = new Set<string>();
  tags.add(params.kind);
  if (
    params.kind === 'check' ||
    params.kind === 'save' ||
    params.kind === 'attack' ||
    params.kind === 'd20'
  ) {
    tags.add('d20');
  }
  if (params.skill) tags.add(`check:${params.skill}`);
  if (params.ability) {
    tags.add(`ability:${params.ability}`);
    if (params.kind === 'save') {
      tags.add(`save:${params.ability}`);
    }
  }
  if (params.attackKind) tags.add(`attack:${params.attackKind}`);
  if (params.requiresSight) tags.add('sight');
  for (const c of params.conditions ?? []) {
    tags.add(`condition:${c}`);
  }
  if (params.inCombat !== undefined) {
    tags.add(params.inCombat ? 'in-combat' : 'out-of-combat');
  }
  if (params.sceneId) {
    tags.add(`scene:${params.sceneId}`);
  }
  return tags;
}

function targetMatches(modTarget: ModifierTarget, requested: ModifierTarget): boolean {
  if (modTarget === requested) return true;
  if (
    modTarget === 'd20' &&
    (requested === 'check' || requested === 'save' || requested === 'attack')
  ) {
    return true;
  }
  return false;
}

export interface ResolveModifiersResult {
  totalMod: number;
  breakdown: ResolvedModifierEntry[];
  grantsAdvantage: boolean;
  imposesDisadvantage: boolean;
  diceBonusRange: { min: number; max: number };
  consumedEffectIds: string[];
}

interface CandidateModifier {
  mod: SourcedModifier;
  value: number;
  diceExpression?: string;
  diceRolls?: number[];
  sourceEffect?: ActiveEffect;
}

/**
 * Evaluates base sourced modifiers + ActiveEffects using 5e-friendly stacking rules:
 * - Same `slug`: keeps strongest magnitude, shadows duplicates (`ignored: true`).
 * - `untyped`: stacks unconditionally.
 * - Named types (`status`, `circumstance`, `item`, `spell`): keeps highest positive bonus and lowest negative penalty per type.
 */
export function resolveModifiers(params: {
  baseModifiers?: readonly SourcedModifier[];
  activeEffects?: readonly ActiveEffect[];
  opponentEffects?: readonly ActiveEffect[];
  target: ModifierTarget;
  tags: ReadonlySet<string>;
  rng?: Rng;
}): ResolveModifiersResult {
  const candidates: CandidateModifier[] = [];
  let grantsAdvantage = false;
  let imposesDisadvantage = false;
  const diceBonusRange = { min: 0, max: 0 };
  const contributingEffects = new Set<string>();

  const considerModifier = (mod: SourcedModifier, sourceEffect?: ActiveEffect) => {
    if (!targetMatches(mod.target, params.target)) return;
    if (!evaluatePredicate(mod.predicate, params.tags)) return;

    if (mod.grantsAdvantage) grantsAdvantage = true;
    if (mod.imposesDisadvantage) imposesDisadvantage = true;

    let numericValue = mod.value ?? 0;
    let diceExpression: string | undefined;
    let diceRolls: number[] | undefined;

    if (mod.dice) {
      const parsedDice = parseSignedDiceRange(mod.dice);
      if (parsedDice) {
        if (params.rng) {
          const rolled = rollDice(parsedDice.diceExpr, params.rng);
          const signedVal = parsedDice.sign * rolled.total;
          numericValue += signedVal;
          diceExpression = `${parsedDice.sign === -1 ? '-' : '+'}${parsedDice.diceExpr}`;
          diceRolls = rolled.rolls;
        } else {
          diceExpression = `${parsedDice.sign === -1 ? '-' : '+'}${parsedDice.diceExpr}`;
          diceBonusRange.min += parsedDice.min;
          diceBonusRange.max += parsedDice.max;
        }
      }
    }

    const hasContribution =
      numericValue !== 0 ||
      Boolean(diceExpression) ||
      Boolean(mod.grantsAdvantage) ||
      Boolean(mod.imposesDisadvantage);
    if (!hasContribution) return;

    if (sourceEffect && sourceEffect.consumeOnUse) {
      contributingEffects.add(sourceEffect.id);
    }

    candidates.push({
      mod,
      value: numericValue,
      ...(diceExpression ? { diceExpression } : {}),
      ...(diceRolls ? { diceRolls } : {}),
      ...(sourceEffect ? { sourceEffect } : {}),
    });
  };

  for (const mod of params.baseModifiers ?? []) {
    considerModifier(mod);
  }
  for (const effect of params.activeEffects ?? []) {
    for (const mod of effect.modifiers) {
      considerModifier(mod, effect);
    }
  }
  for (const oppEffect of params.opponentEffects ?? []) {
    for (const mod of oppEffect.modifiers) {
      if (!targetMatches(mod.target, params.target)) continue;
      if (!evaluatePredicate(mod.predicate, params.tags)) continue;
      if (mod.grantsAdvantageAgainst) {
        grantsAdvantage = true;
        if (oppEffect.consumeOnUse) contributingEffects.add(oppEffect.id);
      }
      if (mod.imposesDisadvantageAgainst) {
        imposesDisadvantage = true;
        if (oppEffect.consumeOnUse) contributingEffects.add(oppEffect.id);
      }
    }
  }

  // Deduplicate same slug (keep highest abs value, or first if equal)
  const bestBySlug = new Map<string, number>();
  for (let i = 0; i < candidates.length; i += 1) {
    const c = candidates[i]!;
    const prevIdx = bestBySlug.get(c.mod.slug);
    if (prevIdx === undefined) {
      bestBySlug.set(c.mod.slug, i);
    } else if (Math.abs(c.value) > Math.abs(candidates[prevIdx]!.value)) {
      bestBySlug.set(c.mod.slug, i);
    }
  }

  const ignoredSet = new Set<number>();
  for (let i = 0; i < candidates.length; i += 1) {
    const c = candidates[i]!;
    if (bestBySlug.get(c.mod.slug) !== i) {
      ignoredSet.add(i);
    }
  }

  // Named stack types take single best positive and single worst negative per type
  const bestPosByType = new Map<string, number>();
  const worstNegByType = new Map<string, number>();
  for (let i = 0; i < candidates.length; i += 1) {
    if (ignoredSet.has(i)) continue;
    const c = candidates[i]!;
    const stackType = c.mod.type ?? 'untyped';
    if (stackType === 'untyped' || c.value === 0) continue;

    if (c.value > 0) {
      const prev = bestPosByType.get(stackType);
      if (prev === undefined || c.value > candidates[prev]!.value) {
        if (prev !== undefined) ignoredSet.add(prev);
        bestPosByType.set(stackType, i);
      } else {
        ignoredSet.add(i);
      }
    } else {
      const prev = worstNegByType.get(stackType);
      if (prev === undefined || c.value < candidates[prev]!.value) {
        if (prev !== undefined) ignoredSet.add(prev);
        worstNegByType.set(stackType, i);
      } else {
        ignoredSet.add(i);
      }
    }
  }

  let totalMod = 0;
  const breakdown: ResolvedModifierEntry[] = [];
  for (let i = 0; i < candidates.length; i += 1) {
    const c = candidates[i]!;
    const ignored = ignoredSet.has(i);
    if (!ignored) {
      totalMod += c.value;
    }
    if (c.value !== 0 || c.diceExpression) {
      breakdown.push({
        slug: c.mod.slug,
        labelEs: c.mod.labelEs,
        value: c.value,
        ...(c.diceExpression ? { diceExpression: c.diceExpression } : {}),
        ...(c.diceRolls ? { diceRolls: c.diceRolls } : {}),
        type: c.mod.type ?? 'untyped',
        ...(ignored ? { ignored: true } : {}),
      });
    }
  }

  return {
    totalMod,
    breakdown,
    grantsAdvantage,
    imposesDisadvantage,
    diceBonusRange,
    consumedEffectIds: Array.from(contributingEffects),
  };
}

export function getEffectiveAc(
  actor: { ac: number; activeEffects?: readonly ActiveEffect[] },
  tags?: ReadonlySet<string>,
): { baseAc: number; effectiveAc: number; breakdown: ResolvedModifierEntry[] } {
  const effectiveTags = tags ?? buildRollTags({ kind: 'ac' });
  const res = resolveModifiers({
    baseModifiers: [
      {
        slug: 'ac:base',
        labelEs: 'CA base',
        target: 'ac',
        value: actor.ac,
        type: 'untyped',
      },
    ],
    activeEffects: actor.activeEffects,
    target: 'ac',
    tags: effectiveTags,
  });
  return {
    baseAc: actor.ac,
    effectiveAc: Math.max(1, res.totalMod),
    breakdown: res.breakdown,
  };
}

export function getEffectiveSpeed(actor: {
  speed: number;
  conditions: readonly Condition5e[];
  exhaustionLevel?: number;
  activeEffects?: readonly ActiveEffect[];
}): { baseSpeed: number; effectiveSpeed: number; breakdown: ResolvedModifierEntry[] } {
  const exLevel =
    actor.exhaustionLevel && actor.exhaustionLevel > 0
      ? Math.min(6, actor.exhaustionLevel)
      : actor.conditions.includes('exhaustion')
        ? 1
        : 0;
  const baseModifiers: SourcedModifier[] = [
    {
      slug: 'speed:base',
      labelEs: 'Velocidad base',
      target: 'speed',
      value: actor.speed,
      type: 'untyped',
    },
  ];
  if (exLevel > 0) {
    baseModifiers.push({
      slug: 'exhaustion',
      labelEs: `Agotamiento Nv.${exLevel}`,
      target: 'speed',
      value: -5 * exLevel,
      type: 'status',
    });
  }
  const res = resolveModifiers({
    baseModifiers,
    activeEffects: actor.activeEffects,
    target: 'speed',
    tags: buildRollTags({ kind: 'speed', conditions: actor.conditions }),
  });
  return {
    baseSpeed: actor.speed,
    effectiveSpeed: Math.max(0, res.totalMod),
    breakdown: res.breakdown,
  };
}

function isConditionHeldByRemainingEffects(
  effects: readonly ActiveEffect[],
  removingIds: ReadonlySet<string>,
  condition: Condition5e,
): boolean {
  return effects.some(
    (ef) => !removingIds.has(ef.id) && ef.linkedCondition === condition,
  );
}

/**
 * Collects effect removals + unlinked conditions across characters & combatants when a
 * concentration spell ends on `sourceActorId`.
 */
export function collectConcentrationPurge(
  state: GameState,
  sourceActorId: string,
  spellName: string,
): {
  effectsRemoved: Array<{ targetId: string; effectId: string }>;
  conditionsRemoved: Array<{ actorId: string; condition: Condition5e }>;
} {
  const effectsRemoved: Array<{ targetId: string; effectId: string }> = [];
  const conditionsRemoved: Array<{ actorId: string; condition: Condition5e }> = [];

  for (const char of Object.values(state.characters)) {
    const effects = char.activeEffects ?? [];
    const matching = effects.filter(
      (ef) =>
        ef.sourceActorId === sourceActorId &&
        ef.concentrationSpell === spellName,
    );
    if (matching.length === 0) continue;
    const removingIds = new Set(matching.map((e) => e.id));
    for (const ef of matching) {
      effectsRemoved.push({ targetId: char.id, effectId: ef.id });
      if (
        ef.linkedCondition &&
        char.conditions.includes(ef.linkedCondition) &&
        !isConditionHeldByRemainingEffects(effects, removingIds, ef.linkedCondition)
      ) {
        conditionsRemoved.push({
          actorId: char.id,
          condition: ef.linkedCondition,
        });
      }
    }
  }

  for (const combatant of state.combat?.combatants ?? []) {
    if (combatant.actorId && state.characters[combatant.actorId]) {
      continue;
    }
    const effects = combatant.activeEffects ?? [];
    const matching = effects.filter(
      (ef) =>
        ef.sourceActorId === sourceActorId &&
        ef.concentrationSpell === spellName,
    );
    for (const ef of matching) {
      effectsRemoved.push({ targetId: combatant.id, effectId: ef.id });
    }
  }

  return { effectsRemoved, conditionsRemoved };
}

function doesIdMatchCombatant(id: string | undefined, combatant: Combatant): boolean {
  if (!id) return false;
  return id === combatant.id || (Boolean(combatant.actorId) && id === combatant.actorId);
}

function getEffectsForCombatant(state: GameState, combatant: Combatant): ActiveEffect[] {
  if (combatant.actorId && state.characters[combatant.actorId]) {
    return state.characters[combatant.actorId]!.activeEffects ?? combatant.activeEffects ?? [];
  }
  return combatant.activeEffects ?? [];
}

/**
 * Ticks finite `ActiveEffect` durations during `advanceCombatTurn` and expires any
 * effect whose `remainingRounds` reaches 0.
 */
export function tickCombatEffects(
  state: GameState,
  params: { previousCombatant: Combatant; activeCombatant: Combatant },
): {
  effectsUpdated: Array<{
    targetId: string;
    effectId: string;
    remainingRounds: number | null;
  }>;
  effectsRemoved: Array<{ targetId: string; effectId: string }>;
  conditionsRemoved: Array<{ actorId: string; condition: Condition5e }>;
  expiredEffects: ExpiredEffectSummary[];
} {
  const effectsUpdated: Array<{
    targetId: string;
    effectId: string;
    remainingRounds: number | null;
  }> = [];
  const effectsRemoved: Array<{ targetId: string; effectId: string }> = [];
  const conditionsRemoved: Array<{ actorId: string; condition: Condition5e }> = [];
  const expiredEffects: ExpiredEffectSummary[] = [];

  const seenTargets = new Set<string>();
  const targetEntries: Array<{
    targetId: string;
    targetName: string;
    combatant?: Combatant;
    character?: Character;
    effects: readonly ActiveEffect[];
  }> = [];

  for (const combatant of state.combat?.combatants ?? []) {
    const targetId =
      combatant.actorId && state.characters[combatant.actorId]
        ? combatant.actorId
        : combatant.id;
    if (seenTargets.has(targetId)) continue;
    seenTargets.add(targetId);
    targetEntries.push({
      targetId,
      targetName: combatant.name,
      combatant,
      character: combatant.actorId ? state.characters[combatant.actorId] : undefined,
      effects: getEffectsForCombatant(state, combatant),
    });
  }

  for (const entry of targetEntries) {
    const removingIds = new Set<string>();
    const toRemove: ActiveEffect[] = [];

    for (const ef of entry.effects) {
      if (ef.remainingRounds === null) continue;
      const timing: EffectExpiryTiming = ef.expiryTiming ?? 'end_of_owner_turn';

      const isOwnerPrevious =
        entry.combatant !== undefined &&
        doesIdMatchCombatant(entry.targetId, params.previousCombatant);
      const isOwnerActive =
        entry.combatant !== undefined &&
        doesIdMatchCombatant(entry.targetId, params.activeCombatant);

      const shouldTick =
        (timing === 'end_of_owner_turn' && isOwnerPrevious) ||
        (timing === 'start_of_owner_turn' && isOwnerActive) ||
        (timing === 'end_of_source_turn' &&
          doesIdMatchCombatant(ef.sourceActorId, params.previousCombatant)) ||
        (timing === 'start_of_source_turn' &&
          doesIdMatchCombatant(ef.sourceActorId, params.activeCombatant));

      if (!shouldTick) continue;

      const nextRemaining = ef.remainingRounds - 1;
      if (nextRemaining <= 0) {
        removingIds.add(ef.id);
        toRemove.push(ef);
        effectsRemoved.push({ targetId: entry.targetId, effectId: ef.id });
      } else {
        effectsUpdated.push({
          targetId: entry.targetId,
          effectId: ef.id,
          remainingRounds: nextRemaining,
        });
      }
    }

    for (const ef of toRemove) {
      let linkedConditionRemoved: Condition5e | undefined;
      if (
        ef.linkedCondition &&
        entry.character &&
        entry.character.conditions.includes(ef.linkedCondition) &&
        !isConditionHeldByRemainingEffects(entry.effects, removingIds, ef.linkedCondition)
      ) {
        linkedConditionRemoved = ef.linkedCondition;
        conditionsRemoved.push({
          actorId: entry.character.id,
          condition: ef.linkedCondition,
        });
      } else if (
        ef.linkedCondition &&
        !entry.character &&
        entry.combatant?.conditions?.includes(ef.linkedCondition) &&
        !isConditionHeldByRemainingEffects(entry.effects, removingIds, ef.linkedCondition)
      ) {
        linkedConditionRemoved = ef.linkedCondition;
      }

      expiredEffects.push({
        targetId: entry.targetId,
        targetName: entry.targetName,
        effectId: ef.id,
        slug: ef.slug,
        labelEs: ef.labelEs,
        ...(linkedConditionRemoved ? { linkedConditionRemoved } : {}),
      });
    }
  }

  return {
    effectsUpdated,
    effectsRemoved,
    conditionsRemoved,
    expiredEffects,
  };
}

/**
 * Collects combat-bound `ActiveEffect` removals when an encounter finishes (`endCombat`).
 */
export function collectCombatEndPurge(state: GameState): {
  effectsRemoved: Array<{ targetId: string; effectId: string }>;
  conditionsRemoved: Array<{ actorId: string; condition: Condition5e }>;
  expiredEffects: ExpiredEffectSummary[];
} {
  const effectsRemoved: Array<{ targetId: string; effectId: string }> = [];
  const conditionsRemoved: Array<{ actorId: string; condition: Condition5e }> = [];
  const expiredEffects: ExpiredEffectSummary[] = [];

  for (const char of Object.values(state.characters)) {
    const effects = char.activeEffects ?? [];
    const matching = effects.filter((ef) => ef.expiresOnCombatEnd === true);
    if (matching.length === 0) continue;
    const removingIds = new Set(matching.map((e) => e.id));
    for (const ef of matching) {
      effectsRemoved.push({ targetId: char.id, effectId: ef.id });
      let linkedConditionRemoved: Condition5e | undefined;
      if (
        ef.linkedCondition &&
        char.conditions.includes(ef.linkedCondition) &&
        !isConditionHeldByRemainingEffects(effects, removingIds, ef.linkedCondition)
      ) {
        linkedConditionRemoved = ef.linkedCondition;
        conditionsRemoved.push({
          actorId: char.id,
          condition: ef.linkedCondition,
        });
      }
      expiredEffects.push({
        targetId: char.id,
        targetName: char.name,
        effectId: ef.id,
        slug: ef.slug,
        labelEs: ef.labelEs,
        ...(linkedConditionRemoved ? { linkedConditionRemoved } : {}),
      });
    }
  }

  for (const c of state.combat?.combatants ?? []) {
    if (c.actorId && state.characters[c.actorId]) continue;
    const effects = c.activeEffects ?? [];
    for (const ef of effects.filter((e) => e.expiresOnCombatEnd === true)) {
      effectsRemoved.push({ targetId: c.id, effectId: ef.id });
      expiredEffects.push({
        targetId: c.id,
        targetName: c.name,
        effectId: ef.id,
        slug: ef.slug,
        labelEs: ef.labelEs,
      });
    }
  }

  return { effectsRemoved, conditionsRemoved, expiredEffects };
}

/**
 * Collects temporary `ActiveEffect` removals when `actor` completes a short or long rest.
 */
export function collectRestPurge(
  actor: Character,
  restType: 'short' | 'long',
): {
  effectsRemoved: Array<{ targetId: string; effectId: string }>;
  conditionsRemoved: Array<{ actorId: string; condition: Condition5e }>;
} {
  const effects = actor.activeEffects ?? [];
  const matching = effects.filter((ef) => {
    if (ef.expiresOnRest === 'none') return false;
    if (restType === 'long') return true;
    return (
      ef.expiresOnRest === 'short' ||
      (Boolean(ef.concentrationSpell) &&
        ef.durationRounds !== null &&
        ef.durationRounds <= 10)
    );
  });
  const removingIds = new Set(matching.map((e) => e.id));
  const effectsRemoved = matching.map((e) => ({
    targetId: actor.id,
    effectId: e.id,
  }));
  const conditionsRemoved: Array<{ actorId: string; condition: Condition5e }> = [];

  for (const ef of matching) {
    if (
      ef.linkedCondition &&
      actor.conditions.includes(ef.linkedCondition) &&
      !isConditionHeldByRemainingEffects(effects, removingIds, ef.linkedCondition)
    ) {
      conditionsRemoved.push({
        actorId: actor.id,
        condition: ef.linkedCondition,
      });
    }
  }

  return { effectsRemoved, conditionsRemoved };
}

/**
 * Factory producing deterministic `ActiveEffect` definitions for tactical SRD 5.2.1 spells.
 */
export function buildSpellActiveEffect(params: {
  spellId: string;
  effectId: string;
  sourceActorId: string;
  targetNameEs?: string;
}): ActiveEffect | null {
  const { spellId, effectId, sourceActorId } = params;
  switch (spellId) {
    case 'bless':
      return {
        id: effectId,
        slug: 'spell:bless',
        labelEs: 'Bendición',
        sourceActorId,
        concentrationSpell: 'Bendición',
        durationRounds: 10,
        remainingRounds: 10,
        expiryTiming: 'end_of_source_turn',
        expiresOnRest: 'short',
        modifiers: [
          {
            slug: 'spell:bless:attack',
            labelEs: 'Bendición',
            target: 'attack',
            dice: '+1d4',
            type: 'spell',
          },
          {
            slug: 'spell:bless:save',
            labelEs: 'Bendición',
            target: 'save',
            dice: '+1d4',
            type: 'spell',
          },
        ],
      };

    case 'bane':
      return {
        id: effectId,
        slug: 'spell:bane',
        labelEs: 'Perdición',
        sourceActorId,
        concentrationSpell: 'Perdición',
        durationRounds: 10,
        remainingRounds: 10,
        expiryTiming: 'end_of_source_turn',
        expiresOnRest: 'short',
        modifiers: [
          {
            slug: 'spell:bane:attack',
            labelEs: 'Perdición',
            target: 'attack',
            dice: '-1d4',
            type: 'spell',
          },
          {
            slug: 'spell:bane:save',
            labelEs: 'Perdición',
            target: 'save',
            dice: '-1d4',
            type: 'spell',
          },
        ],
      };

    case 'guidance':
      return {
        id: effectId,
        slug: 'spell:guidance',
        labelEs: 'Guía',
        sourceActorId,
        concentrationSpell: 'Guía',
        durationRounds: 10,
        remainingRounds: 10,
        expiryTiming: 'end_of_source_turn',
        expiresOnRest: 'short',
        consumeOnUse: true,
        modifiers: [
          {
            slug: 'spell:guidance:check',
            labelEs: 'Guía',
            target: 'check',
            dice: '+1d4',
            type: 'spell',
          },
        ],
      };

    case 'shield-of-faith':
      return {
        id: effectId,
        slug: 'spell:shield-of-faith',
        labelEs: 'Escudo de la fe',
        sourceActorId,
        concentrationSpell: 'Escudo de la fe',
        durationRounds: 100,
        remainingRounds: 100,
        expiryTiming: 'end_of_source_turn',
        expiresOnCombatEnd: false,
        expiresOnRest: 'short',
        modifiers: [
          {
            slug: 'spell:shield-of-faith:ac',
            labelEs: 'Escudo de la fe',
            target: 'ac',
            value: 2,
            type: 'spell',
          },
        ],
      };

    case 'shield':
      return {
        id: effectId,
        slug: 'spell:shield',
        labelEs: 'Escudo arcano',
        sourceActorId,
        durationRounds: 1,
        remainingRounds: 1,
        expiryTiming: 'start_of_owner_turn',
        expiresOnCombatEnd: true,
        expiresOnRest: 'short',
        modifiers: [
          {
            slug: 'spell:shield:ac',
            labelEs: 'Escudo arcano',
            target: 'ac',
            value: 5,
            type: 'spell',
          },
        ],
      };

    case 'faerie-fire':
      return {
        id: effectId,
        slug: 'spell:faerie-fire',
        labelEs: 'Fuego feérico',
        sourceActorId,
        concentrationSpell: 'Fuego feérico',
        durationRounds: 10,
        remainingRounds: 10,
        expiryTiming: 'end_of_source_turn',
        expiresOnRest: 'short',
        modifiers: [
          {
            slug: 'spell:faerie-fire:adv',
            labelEs: 'Fuego feérico',
            target: 'attack',
            type: 'spell',
            grantsAdvantageAgainst: true,
          },
        ],
      };

    case 'guiding-bolt':
      return {
        id: effectId,
        slug: 'spell:guiding-bolt',
        labelEs: 'Saeta guía',
        sourceActorId,
        durationRounds: 1,
        remainingRounds: 1,
        expiryTiming: 'end_of_source_turn',
        expiresOnCombatEnd: true,
        expiresOnRest: 'short',
        consumeOnUse: true,
        modifiers: [
          {
            slug: 'spell:guiding-bolt:adv',
            labelEs: 'Saeta guía',
            target: 'attack',
            type: 'spell',
            grantsAdvantageAgainst: true,
          },
        ],
      };

    case 'hold-person':
      return {
        id: effectId,
        slug: 'spell:hold-person',
        labelEs: 'Inmovilizar persona',
        sourceActorId,
        concentrationSpell: 'Inmovilizar persona',
        durationRounds: 10,
        remainingRounds: 10,
        expiryTiming: 'end_of_source_turn',
        expiresOnRest: 'short',
        linkedCondition: 'paralyzed',
        modifiers: [],
      };

    case 'sleep':
      return {
        id: effectId,
        slug: 'spell:sleep',
        labelEs: 'Dormir',
        sourceActorId,
        concentrationSpell: 'Dormir',
        durationRounds: 10,
        remainingRounds: 10,
        expiryTiming: 'end_of_source_turn',
        expiresOnRest: 'short',
        linkedCondition: 'incapacitated',
        modifiers: [],
      };

    case 'ray-of-frost':
      return {
        id: effectId,
        slug: 'spell:ray-of-frost',
        labelEs: 'Rayo de escarcha',
        sourceActorId,
        durationRounds: 1,
        remainingRounds: 1,
        expiryTiming: 'start_of_source_turn',
        expiresOnCombatEnd: true,
        expiresOnRest: 'short',
        modifiers: [
          {
            slug: 'spell:ray-of-frost:speed',
            labelEs: 'Rayo de escarcha',
            target: 'speed',
            value: -10,
            type: 'spell',
          },
        ],
      };

    default:
      return null;
  }
}
