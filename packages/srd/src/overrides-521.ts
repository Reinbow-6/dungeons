import type { Condition5e } from '@dungeons/rules';
import type { Condition521RuleMeta } from './schemas.js';

export const SRD_VERSION = '5.2.1' as const;

export interface ConflictResolution<T> {
  resolved: T;
  rulesetVersion: typeof SRD_VERSION;
  supersededLegacy51: boolean;
}

/**
 * Precedence rule: whenever legacy 5.1 data contradicts SRD 5.2.1,
 * SRD 5.2.1 always wins.
 */
export function resolveSrdConflict<T>(
  entry521: T,
  legacy51Entry?: Partial<T>,
): ConflictResolution<T> {
  return {
    resolved: entry521,
    rulesetVersion: SRD_VERSION,
    supersededLegacy51: Boolean(legacy51Entry),
  };
}

/**
 * Normative SRD 5.2.1 mechanical metadata by condition.
 * Aligns `packages/srd` lookup results with `packages/rules/src/modifiers.ts`.
 */
export const CONDITION_521_RULES: Record<Condition5e, Condition521RuleMeta> = {
  blinded: {
    autoFailSightChecks: true,
    disadvantageOnAttacks: true,
    grantsAdvantageToAttackers: true,
  },
  charmed: {},
  deafened: {},
  exhaustion: {
    d20TestPenaltyPerLevel: -2,
    speedPenaltyFeetPerLevel: -5,
    maxLevels: 6,
  },
  frightened: {
    disadvantageOnChecks: true,
    disadvantageOnAttacks: true,
  },
  grappled: {},
  incapacitated: {
    incapacitated: true,
  },
  invisible: {
    disadvantageOnAttacks: false,
  },
  paralyzed: {
    incapacitated: true,
    grantsAdvantageToAttackers: true,
  },
  petrified: {
    incapacitated: true,
    grantsAdvantageToAttackers: true,
  },
  poisoned: {
    disadvantageOnChecks: true,
    disadvantageOnAttacks: true,
  },
  prone: {
    disadvantageOnAttacks: true,
  },
  restrained: {
    disadvantageOnAttacks: true,
    grantsAdvantageToAttackers: true,
  },
  stunned: {
    incapacitated: true,
    grantsAdvantageToAttackers: true,
  },
  unconscious: {
    incapacitated: true,
    grantsAdvantageToAttackers: true,
  },
};
