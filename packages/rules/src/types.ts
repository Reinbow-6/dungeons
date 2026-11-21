import { z } from 'zod';

export const RulesetProfileSchema = z.enum(['5e-lite', '5e-full']);
export type RulesetProfile = z.infer<typeof RulesetProfileSchema>;

export const FieldAuthoritySchema = z.enum(['engine', 'player', 'mirrored']);
export type FieldAuthority = z.infer<typeof FieldAuthoritySchema>;

export const RollAuthoritySchema = z.enum([
  'engine-rolled',
  'player-declared',
  'hidden',
]);
export type RollAuthority = z.infer<typeof RollAuthoritySchema>;

export const VisibilitySchema = z.enum(['public', 'owner-only', 'dm-only']);
export type Visibility = z.infer<typeof VisibilitySchema>;

export const AbilitySchema = z.enum(['str', 'dex', 'con', 'int', 'wis', 'cha']);
export type Ability = z.infer<typeof AbilitySchema>;

export const SkillSchema = z.enum([
  'acrobatics',
  'animal_handling',
  'arcana',
  'athletics',
  'deception',
  'history',
  'insight',
  'intimidation',
  'investigation',
  'medicine',
  'nature',
  'perception',
  'performance',
  'persuasion',
  'religion',
  'sleight_of_hand',
  'stealth',
  'survival',
]);
export type Skill = z.infer<typeof SkillSchema>;

export const SKILL_TO_ABILITY: Record<Skill, Ability> = {
  acrobatics: 'dex',
  animal_handling: 'wis',
  arcana: 'int',
  athletics: 'str',
  deception: 'cha',
  history: 'int',
  insight: 'wis',
  intimidation: 'cha',
  investigation: 'int',
  medicine: 'wis',
  nature: 'int',
  perception: 'wis',
  performance: 'cha',
  persuasion: 'cha',
  religion: 'int',
  sleight_of_hand: 'dex',
  stealth: 'dex',
  survival: 'wis',
};

export const CheckTargetSchema = z.union([SkillSchema, AbilitySchema]);
export type CheckTarget = z.infer<typeof CheckTargetSchema>;

export const ProficiencyTierSchema = z.enum(['none', 'proficient', 'expertise']);
export type ProficiencyTier = z.infer<typeof ProficiencyTierSchema>;

export const Condition5eSchema = z.enum([
  'blinded',
  'charmed',
  'deafened',
  'exhaustion',
  'frightened',
  'grappled',
  'incapacitated',
  'invisible',
  'paralyzed',
  'petrified',
  'poisoned',
  'prone',
  'restrained',
  'stunned',
  'unconscious',
]);
export type Condition5e = z.infer<typeof Condition5eSchema>;

export const CharacterFieldKeySchema = z.enum([
  'abilities',
  'skills',
  'savingThrows',
  'hp',
  'ac',
  'inventory',
  'spellSlots',
  'conditions',
]);
export type CharacterFieldKey = z.infer<typeof CharacterFieldKeySchema>;

export const CharacterAuthoritySchema = z.object({
  abilities: FieldAuthoritySchema,
  skills: FieldAuthoritySchema,
  savingThrows: FieldAuthoritySchema,
  hp: FieldAuthoritySchema,
  ac: FieldAuthoritySchema,
  inventory: FieldAuthoritySchema,
  spellSlots: FieldAuthoritySchema,
  conditions: FieldAuthoritySchema,
});
export type CharacterAuthority = z.infer<typeof CharacterAuthoritySchema>;

export function createDefaultAuthority(
  mode: 'digital' | 'hybrid',
): CharacterAuthority {
  if (mode === 'digital') {
    return {
      abilities: 'engine',
      skills: 'engine',
      savingThrows: 'engine',
      hp: 'engine',
      ac: 'engine',
      inventory: 'engine',
      spellSlots: 'engine',
      conditions: 'engine',
    };
  }

  return {
    abilities: 'mirrored',
    skills: 'mirrored',
    savingThrows: 'mirrored',
    hp: 'mirrored',
    ac: 'mirrored',
    inventory: 'mirrored',
    spellSlots: 'mirrored',
    conditions: 'engine',
  };
}

export const AbilitiesBlockSchema = z.object({
  str: z.number().int().min(1).max(30),
  dex: z.number().int().min(1).max(30),
  con: z.number().int().min(1).max(30),
  int: z.number().int().min(1).max(30),
  wis: z.number().int().min(1).max(30),
  cha: z.number().int().min(1).max(30),
});
export type AbilitiesBlock = z.infer<typeof AbilitiesBlockSchema>;

export const InventoryItemSchema = z.object({
  itemId: z.string().min(1),
  name: z.string().min(1),
  quantity: z.number().int().min(0),
});
export type InventoryItem = z.infer<typeof InventoryItemSchema>;

export const SpellSlotPoolSchema = z.object({
  current: z.number().int().min(0),
  max: z.number().int().min(0),
});
export type SpellSlotPool = z.infer<typeof SpellSlotPoolSchema>;

export const CharacterSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  species: z.string().min(1),
  className: z.string().min(1),
  level: z.number().int().min(1).max(20),
  abilities: AbilitiesBlockSchema,
  skillProficiencies: z.record(SkillSchema, ProficiencyTierSchema),
  savingThrowProficiencies: z.array(AbilitySchema),
  hp: z.object({
    current: z.number().int().min(0),
    max: z.number().int().min(1),
    temp: z.number().int().min(0),
  }),
  ac: z.number().int().min(1).max(40),
  speed: z.number().int().min(0),
  conditions: z.array(Condition5eSchema),
  exhaustionLevel: z.number().int().min(0).max(6).default(0),
  inventory: z.array(InventoryItemSchema),
  spellSlots: z.record(z.string(), SpellSlotPoolSchema),
  concentratingOn: z.string().nullable(),
  resistances: z.array(z.string().min(1)).optional(),
  authority: CharacterAuthoritySchema,
  rollAuthority: RollAuthoritySchema,
});
export type Character = z.infer<typeof CharacterSchema>;

export const CombatantKindSchema = z.enum(['pc', 'enemy', 'ally']);
export type CombatantKind = z.infer<typeof CombatantKindSchema>;

export const CombatantAttackSchema = z.object({
  id: z.string().min(1),
  nameEs: z.string().min(1),
  attackBonus: z.number().int(),
  damageDice: z.string().min(1),
  damageType: z.string().min(1),
});
export type CombatantAttack = z.infer<typeof CombatantAttackSchema>;

export const CombatantSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  kind: CombatantKindSchema,
  actorId: z.string().min(1).optional(),
  creatureId: z.string().min(1).optional(),
  initiative: z.number().int(),
  hp: z.object({
    current: z.number().int().min(0),
    max: z.number().int().min(1),
  }),
  ac: z.number().int().min(1).max(40),
  attacks: z.array(CombatantAttackSchema),
  vulnerabilities: z.array(z.string().min(1)),
  immunities: z.array(z.string().min(1)),
  resistances: z.array(z.string().min(1)).optional(),
  conditions: z.array(Condition5eSchema).optional(),
  defeated: z.boolean(),
});
export type Combatant = z.infer<typeof CombatantSchema>;

export const CombatStateSchema = z.object({
  active: z.boolean(),
  round: z.number().int().min(1),
  turnIndex: z.number().int().min(0),
  combatants: z.array(CombatantSchema),
});
export type CombatState = z.infer<typeof CombatStateSchema>;

export interface SceneClue {
  id: string;
  dc: number;
  titleEs: string;
  descriptionEs: string;
  tacticalEffectEs: string;
}

export interface TransitionRequirement {
  requiredClues?: string[];
  requiredFlags?: string[];
}

export interface SceneDefinition {
  id: string;
  titleEs: string;
  summaryEs: string;
  narrativeHookEs?: string;
  allowedTransitions: string[];
  clues: SceneClue[];
  /** Requisitos opcionales por arista, con clave "origen>destino". */
  transitionRequirements?: Record<string, TransitionRequirement>;
}

export interface GameState {
  campaignId: string;
  sessionId: string;
  ruleset: RulesetProfile;
  sceneId: string;
  lastSeq: number;
  characters: Record<string, Character>;
  flags: Record<string, boolean | string | number>;
  unlockedClues: Record<string, string[]>;
  scenes: Record<string, SceneDefinition>;
  combat?: CombatState | null;
}
