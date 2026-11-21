import { rollD20, type Rng, type RollMode } from './rng.js';
import {
  SKILL_TO_ABILITY,
  type Ability,
  type Character,
  type CheckTarget,
  type Condition5e,
  type RulesetProfile,
  type Skill,
} from './types.js';

export function getAbilityModifier(score: number): number {
  return Math.floor((score - 10) / 2);
}

export function getProficiencyBonus(level: number): number {
  const clamped = Math.min(20, Math.max(1, Math.trunc(level)));
  return Math.floor((clamped - 1) / 4) + 2;
}

export function combineRollMode(
  requested: RollMode,
  forcedDisadvantage: boolean,
): RollMode {
  if (!forcedDisadvantage) {
    return requested;
  }
  if (requested === 'advantage') {
    return 'normal';
  }
  return 'disadvantage';
}

export function resolveRollMode(params: {
  requested?: RollMode;
  hasAdvantage?: boolean;
  hasDisadvantage?: boolean;
}): RollMode {
  const adv = params.requested === 'advantage' || Boolean(params.hasAdvantage);
  const dis =
    params.requested === 'disadvantage' || Boolean(params.hasDisadvantage);
  if (adv && dis) {
    return 'normal';
  }
  if (adv) {
    return 'advantage';
  }
  if (dis) {
    return 'disadvantage';
  }
  return 'normal';
}

export interface ConditionPenaltySummary {
  d20Modifier: number;
  speedPenaltyFeet: number;
  effectiveExhaustionLevel: number;
  isExhaustionLethal: boolean;
  imposesDisadvantageOnChecks: boolean;
  imposesDisadvantageOnAttacks: boolean;
  grantsAdvantageOnAttacks: boolean;
  grantsAdvantageToAttackers: boolean;
  imposesDisadvantageToAttackers: boolean;
  isIncapacitated: boolean;
  autoFailSightChecks: boolean;
  autoFailStrDexSaves: boolean;
  disadvantageOnDexSaves: boolean;
  autoCritFromMelee: boolean;
}

/**
 * Computes normalized SRD 5.2.1 condition effects for a list of conditions + exhaustion level.
 */
export function getConditionsEffects(
  conditions: readonly Condition5e[],
  exhaustionLevel = 0,
): ConditionPenaltySummary {
  const rawLevel =
    exhaustionLevel > 0
      ? exhaustionLevel
      : conditions.includes('exhaustion')
        ? 1
        : 0;
  const effectiveExhaustionLevel = Math.max(0, Math.min(6, Math.trunc(rawLevel)));

  // SRD 5.2.1: each Exhaustion level imposes -2 to D20 Tests and -5 ft speed; level 6 is lethal.
  const d20Modifier =
    effectiveExhaustionLevel > 0 ? -2 * effectiveExhaustionLevel : 0;
  const speedPenaltyFeet =
    effectiveExhaustionLevel > 0 ? -5 * effectiveExhaustionLevel : 0;

  const set = new Set<Condition5e>(conditions);
  const hasBlinded = set.has('blinded');
  const hasFrightened = set.has('frightened');
  const hasIncapacitated = set.has('incapacitated');
  const hasInvisible = set.has('invisible');
  const hasParalyzed = set.has('paralyzed');
  const hasPetrified = set.has('petrified');
  const hasPoisoned = set.has('poisoned');
  const hasProne = set.has('prone');
  const hasRestrained = set.has('restrained');
  const hasStunned = set.has('stunned');
  const hasUnconscious = set.has('unconscious');

  const isIncapacitated =
    hasIncapacitated ||
    hasParalyzed ||
    hasPetrified ||
    hasStunned ||
    hasUnconscious;

  return {
    d20Modifier,
    speedPenaltyFeet,
    effectiveExhaustionLevel,
    isExhaustionLethal: effectiveExhaustionLevel >= 6,
    imposesDisadvantageOnChecks: hasPoisoned || hasFrightened,
    imposesDisadvantageOnAttacks:
      hasBlinded ||
      hasFrightened ||
      hasPoisoned ||
      hasProne ||
      hasRestrained,
    grantsAdvantageOnAttacks: hasInvisible,
    grantsAdvantageToAttackers:
      hasBlinded ||
      hasParalyzed ||
      hasPetrified ||
      hasRestrained ||
      hasStunned ||
      hasUnconscious,
    imposesDisadvantageToAttackers: hasInvisible,
    isIncapacitated,
    autoFailSightChecks: hasBlinded || hasUnconscious,
    autoFailStrDexSaves:
      hasParalyzed || hasPetrified || hasStunned || hasUnconscious,
    disadvantageOnDexSaves: hasRestrained,
    autoCritFromMelee: hasParalyzed || hasUnconscious,
  };
}

/**
 * Computes active condition modifiers following SRD 5.2.1 rules.
 * `5e-lite` is a strict subset of `5e-full` and shares the same core penalties.
 */
export function getConditionPenalty(
  character: Character,
  _ruleset: RulesetProfile,
): ConditionPenaltySummary {
  return getConditionsEffects(character.conditions, character.exhaustionLevel);
}

function isSkill(target: CheckTarget): target is Skill {
  return Object.prototype.hasOwnProperty.call(SKILL_TO_ABILITY, target);
}

export interface CheckModifierBreakdown {
  ability: Ability;
  abilityMod: number;
  proficiencyMod: number;
  conditionMod: number;
  totalMod: number;
  imposesDisadvantage: boolean;
}

export function getCheckModifier(
  character: Character,
  target: CheckTarget,
  ruleset: RulesetProfile,
): CheckModifierBreakdown {
  const ability: Ability = isSkill(target) ? SKILL_TO_ABILITY[target] : target;
  const abilityMod = getAbilityModifier(character.abilities[ability]);

  let proficiencyMod = 0;
  if (isSkill(target)) {
    const tier = character.skillProficiencies[target] ?? 'none';
    const pb = getProficiencyBonus(character.level);
    if (tier === 'proficient') {
      proficiencyMod = pb;
    } else if (tier === 'expertise') {
      proficiencyMod = pb * 2;
    }
  }

  const conditions = getConditionPenalty(character, ruleset);
  const conditionMod = conditions.d20Modifier;

  return {
    ability,
    abilityMod,
    proficiencyMod,
    conditionMod,
    totalMod: abilityMod + proficiencyMod + conditionMod,
    imposesDisadvantage: conditions.imposesDisadvantageOnChecks,
  };
}

export interface SaveModifierBreakdown {
  ability: Ability;
  abilityMod: number;
  proficiencyMod: number;
  conditionMod: number;
  totalMod: number;
}

export function getSavingThrowModifier(
  character: Character,
  ability: Ability,
  ruleset: RulesetProfile,
): SaveModifierBreakdown {
  const abilityMod = getAbilityModifier(character.abilities[ability]);
  const isProficient = character.savingThrowProficiencies.includes(ability);
  const proficiencyMod = isProficient ? getProficiencyBonus(character.level) : 0;
  const conditionMod = getConditionPenalty(character, ruleset).d20Modifier;

  return {
    ability,
    abilityMod,
    proficiencyMod,
    conditionMod,
    totalMod: abilityMod + proficiencyMod + conditionMod,
  };
}

export type DamageRelation = 'normal' | 'resistant' | 'vulnerable' | 'immune';

/**
 * Resolves SRD damage multipliers (`immune` > cancelled `resistant+vulnerable` > `resistant` > `vulnerable`).
 */
export function resolveDamageRelation(
  rawDamage: number,
  damageType: string,
  sets: {
    immunities?: Iterable<string>;
    resistances?: Iterable<string>;
    vulnerabilities?: Iterable<string>;
  },
): { relation: DamageRelation; damageApplied: number } {
  const normalized = damageType.trim().toLowerCase();
  const immunities = new Set(
    Array.from(sets.immunities ?? [], (t) => t.trim().toLowerCase()),
  );
  const resistances = new Set(
    Array.from(sets.resistances ?? [], (t) => t.trim().toLowerCase()),
  );
  const vulnerabilities = new Set(
    Array.from(sets.vulnerabilities ?? [], (t) => t.trim().toLowerCase()),
  );

  if (immunities.has(normalized)) {
    return { relation: 'immune', damageApplied: 0 };
  }
  const hasResist = resistances.has(normalized);
  const hasVuln = vulnerabilities.has(normalized);
  if (hasResist && hasVuln) {
    return { relation: 'normal', damageApplied: rawDamage };
  }
  if (hasResist) {
    return { relation: 'resistant', damageApplied: Math.floor(rawDamage / 2) };
  }
  if (hasVuln) {
    return { relation: 'vulnerable', damageApplied: rawDamage * 2 };
  }
  return { relation: 'normal', damageApplied: rawDamage };
}

export interface ConcentrationCheckOutcome {
  spell: string;
  dc: number;
  naturalRoll: number | null;
  modifier: number;
  total: number | null;
  maintained: boolean;
}

/**
 * Evaluates an SRD 5.2.1 Concentration check after taking damage.
 */
export function evaluateConcentrationCheck(params: {
  character: Character;
  damageApplied: number;
  hpAfter: number;
  ruleset: RulesetProfile;
  rng: Rng;
}): ConcentrationCheckOutcome | undefined {
  const { character, damageApplied, hpAfter, ruleset, rng } = params;
  if (damageApplied <= 0 || !character.concentratingOn) {
    return undefined;
  }

  const spell = character.concentratingOn;
  const dc = Math.max(10, Math.floor(damageApplied / 2));
  const saveBreakdown = getSavingThrowModifier(character, 'con', ruleset);
  const effects = getConditionPenalty(character, ruleset);

  if (hpAfter <= 0 || effects.isIncapacitated) {
    return {
      spell,
      dc,
      naturalRoll: null,
      modifier: saveBreakdown.totalMod,
      total: null,
      maintained: false,
    };
  }

  const roll = rollD20(rng, 'normal');
  const total = roll.chosen + saveBreakdown.totalMod;
  return {
    spell,
    dc,
    naturalRoll: roll.chosen,
    modifier: saveBreakdown.totalMod,
    total,
    maintained: total >= dc,
  };
}

