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

export const ModifierTargetSchema = z.enum([
  'd20',
  'check',
  'save',
  'attack',
  'damage',
  'ac',
  'speed',
]);
export type ModifierTarget = z.infer<typeof ModifierTargetSchema>;

export const ModifierStackTypeSchema = z.enum([
  'untyped',
  'status',
  'circumstance',
  'item',
  'spell',
]);
export type ModifierStackType = z.infer<typeof ModifierStackTypeSchema>;

export const SourcedModifierSchema = z.object({
  slug: z.string().min(1),
  labelEs: z.string().min(1),
  target: ModifierTargetSchema,
  value: z.number().int().optional(),
  dice: z.string().min(1).optional(),
  type: ModifierStackTypeSchema.default('untyped'),
  predicate: z.array(z.string().min(1)).optional(),
  grantsAdvantage: z.boolean().optional(),
  imposesDisadvantage: z.boolean().optional(),
  grantsAdvantageAgainst: z.boolean().optional(),
  imposesDisadvantageAgainst: z.boolean().optional(),
});
export type SourcedModifier = z.infer<typeof SourcedModifierSchema>;

export const ResolvedModifierEntrySchema = z.object({
  slug: z.string().min(1),
  labelEs: z.string().min(1),
  value: z.number().int(),
  diceExpression: z.string().optional(),
  diceRolls: z.array(z.number().int()).optional(),
  type: ModifierStackTypeSchema,
  ignored: z.boolean().optional(),
});
export type ResolvedModifierEntry = z.infer<typeof ResolvedModifierEntrySchema>;

export const EffectExpiryTimingSchema = z.enum([
  'start_of_owner_turn',
  'end_of_owner_turn',
  'start_of_source_turn',
  'end_of_source_turn',
]);
export type EffectExpiryTiming = z.infer<typeof EffectExpiryTimingSchema>;

export const ActiveEffectSchema = z.object({
  id: z.string().min(1),
  slug: z.string().min(1),
  labelEs: z.string().min(1),
  sourceActorId: z.string().min(1).optional(),
  concentrationSpell: z.string().min(1).optional(),
  durationRounds: z.number().int().min(1).nullable(),
  remainingRounds: z.number().int().min(0).nullable(),
  expiryTiming: EffectExpiryTimingSchema.optional(),
  expiresOnCombatEnd: z.boolean().optional(),
  expiresOnRest: z.enum(['short', 'long', 'none']).optional(),
  consumeOnUse: z.boolean().optional(),
  linkedCondition: Condition5eSchema.optional(),
  modifiers: z.array(SourcedModifierSchema).default([]),
});
export type ActiveEffect = z.infer<typeof ActiveEffectSchema>;

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

export const HitDieTypeSchema = z.enum(['d6', 'd8', 'd10', 'd12']);
export type HitDieType = z.infer<typeof HitDieTypeSchema>;

export const HitDicePoolSchema = z.object({
  die: HitDieTypeSchema,
  current: z.number().int().min(0),
  max: z.number().int().min(1),
});
export type HitDicePool = z.infer<typeof HitDicePoolSchema>;

export const DeathSavesSchema = z.object({
  successes: z.number().int().min(0).max(3),
  failures: z.number().int().min(0).max(3),
  stable: z.boolean(),
});
export type DeathSaves = z.infer<typeof DeathSavesSchema>;

export const CharacterSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  playerName: z.string().trim().min(1).max(40).optional(),
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
  spellcastingAbility: AbilitySchema.optional(),
  knownSpells: z.array(z.string().min(1)).optional(),
  hitDice: HitDicePoolSchema.optional(),
  deathSaves: DeathSavesSchema.optional(),
  concentratingOn: z.string().nullable(),
  resistances: z.array(z.string().min(1)).optional(),
  activeEffects: z.array(ActiveEffectSchema).optional(),
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
  activeEffects: z.array(ActiveEffectSchema).optional(),
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
  /** Etiqueta corta opcional para listas de partidas (p. ej. "Orilla del Río"). */
  shortLabelEs?: string;
  /** Tensión narrativa base 0-100 para computeTensionMeter. */
  baseTension?: number;
  allowedTransitions: string[];
  clues: SceneClue[];
  /** Requisitos opcionales por arista, con clave "origen>destino". */
  transitionRequirements?: Record<string, TransitionRequirement>;
}

export const TurnPhaseSchema = z.enum([
  'exploration',
  'awaiting_roll',
  'combat_turn',
  'resolving',
]);
export type TurnPhase = z.infer<typeof TurnPhaseSchema>;

export interface GameState {
  campaignId: string;
  sessionId: string;
  /** Slug del AdventurePack asociado (p. ej. "aguas-quietas"). */
  adventureId?: string;
  ruleset: RulesetProfile;
  sceneId: string;
  lastSeq: number;
  turnPhase?: TurnPhase;
  characters: Record<string, Character>;
  flags: Record<string, boolean | string | number>;
  unlockedClues: Record<string, string[]>;
  scenes: Record<string, SceneDefinition>;
  combat?: CombatState | null;
}
