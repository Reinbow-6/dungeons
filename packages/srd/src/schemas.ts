import {
  AbilitySchema,
  Condition5eSchema,
  SkillSchema,
} from '@dungeons/rules';
import { z } from 'zod';

export const SrdRuleCategorySchema = z.enum([
  'condition',
  'skill',
  'equipment',
  'spell',
  'monster',
]);
export type SrdRuleCategory = z.infer<typeof SrdRuleCategorySchema>;

export const SrdManifestSchema = z.object({
  sourceRepo: z.string(),
  sourcePath: z.string(),
  commitSha: z.string(),
  srdVersion: z.literal('5.2.1'),
  license: z.literal('CC-BY-4.0'),
  counts: z.record(z.string(), z.number().int().nonnegative()),
});
export type SrdManifest = z.infer<typeof SrdManifestSchema>;

export interface Condition521RuleMeta {
  d20TestPenaltyPerLevel?: number;
  speedPenaltyFeetPerLevel?: number;
  maxLevels?: number;
  disadvantageOnChecks?: boolean;
  disadvantageOnAttacks?: boolean;
  grantsAdvantageToAttackers?: boolean;
  autoFailSightChecks?: boolean;
  incapacitated?: boolean;
}

export interface SrdCondition {
  index: z.infer<typeof Condition5eSchema>;
  name: string;
  nameEs: string;
  description: string;
  descriptionEs: string;
  rulesetVersion: '5.2.1';
  mechanicalMeta: Condition521RuleMeta;
}

export interface SrdSkill {
  index: string;
  ruleSkill: z.infer<typeof SkillSchema>;
  name: string;
  nameEs: string;
  ability: z.infer<typeof AbilitySchema>;
  description: string;
  descriptionEs: string;
  rulesetVersion: '5.2.1';
}

export interface SrdEquipment {
  index: string;
  name: string;
  nameEs: string;
  categories: string[];
  costText: string | null;
  weight: number | null;
  damageDice: string | null;
  damageType: string | null;
  armorClassBase: number | null;
  description: string;
  descriptionEs: string;
  rulesetVersion: '5.2.1';
}

export interface SrdSpell {
  index: string;
  name: string;
  nameEs: string;
  level: number;
  school: string;
  castingTime: string;
  ritual: boolean;
  range: string;
  components: string[];
  duration: string;
  concentration: boolean;
  description: string;
  descriptionEs: string;
  rulesetVersion: '5.2.1';
}

export interface SrdMonster {
  index: string;
  name: string;
  nameEs: string;
  size: string;
  type: string;
  alignment: string;
  ac: number;
  hp: number;
  hitDice: string;
  challengeRating: number;
  xp: number;
  speedText: string;
  abilities: {
    str: number;
    dex: number;
    con: number;
    int: number;
    wis: number;
    cha: number;
  };
  damageVulnerabilities: string[];
  damageResistances: string[];
  damageImmunities: string[];
  conditionImmunities: string[];
  rulesetVersion: '5.2.1';
}

export interface SrdLookupResult {
  category: SrdRuleCategory;
  index: string;
  name: string;
  nameEs: string;
  summaryEs: string;
  rulesetVersion: '5.2.1';
}

export interface AguasQuietasCreatureAttack {
  nameEs: string;
  kind: 'melee' | 'ranged';
  attackBonus: number;
  damageDice: string;
  damageType: string;
  rangeText: string;
}

export interface AguasQuietasCreatureStatBlock {
  id: string;
  nameEs: string;
  srdBaseIndex: string;
  cr: number;
  ac: number;
  hp: number;
  speedTextEs: string;
  abilities: {
    str: number;
    dex: number;
    con: number;
    int: number;
    wis: number;
    cha: number;
  };
  skills: Record<string, number>;
  vulnerabilities: string[];
  immunities: string[];
  traitsEs: string[];
  attacks: AguasQuietasCreatureAttack[];
  rulesetVersion: '5.2.1';
}
