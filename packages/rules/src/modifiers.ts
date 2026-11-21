import type { RollMode } from './rng.js';
import {
  SKILL_TO_ABILITY,
  type Ability,
  type Character,
  type CheckTarget,
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

export interface ConditionPenaltySummary {
  d20Modifier: number;
  imposesDisadvantageOnChecks: boolean;
}

/**
 * Computes active condition modifiers following SRD 5.2.1 rules.
 * `5e-lite` is a strict subset of `5e-full` and shares the same core penalties.
 */
export function getConditionPenalty(
  character: Character,
  _ruleset: RulesetProfile,
): ConditionPenaltySummary {
  const effectiveExhaustionLevel =
    character.exhaustionLevel > 0
      ? character.exhaustionLevel
      : character.conditions.includes('exhaustion')
        ? 1
        : 0;

  // SRD 5.2.1: each Exhaustion level imposes a -2 penalty to D20 Tests.
  const exhaustionPenalty =
    effectiveExhaustionLevel > 0 ? -2 * effectiveExhaustionLevel : 0;
  const imposesDisadvantageOnChecks = character.conditions.includes('poisoned');

  return {
    d20Modifier: exhaustionPenalty,
    imposesDisadvantageOnChecks,
  };
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
