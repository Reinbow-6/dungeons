import type { UIDataTypes, UIMessage } from "ai";

export interface ResolveCheckToolInput {
  sceneId: string;
  actorId: string;
  skill: string;
  dc?: number;
  dcRef?: string;
  mode?: "normal" | "advantage" | "disadvantage";
  requiresSight?: boolean;
}

export interface ResolveCheckToolOutput {
  ok: boolean;
  code?: string;
  messageEs: string;
  checkId?: string;
  skill?: string;
  dc?: number;
  dcRef?: string;
  autoFailed?: boolean;
  rolls?: number[];
  naturalRoll?: number;
  modifier?: number;
  total?: number;
  success?: boolean;
  margin?: number;
  seq?: number;
}

export interface ResolveSaveToolInput {
  sceneId: string;
  actorId: string;
  ability: string;
  dc?: number;
  dcRef?: string;
  mode?: "normal" | "advantage" | "disadvantage";
}

export interface ResolveSaveToolOutput {
  ok: boolean;
  code?: string;
  messageEs: string;
  checkId?: string;
  ability?: string;
  dc?: number;
  dcRef?: string;
  autoFailed?: boolean;
  rolls?: number[];
  naturalRoll?: number;
  modifier?: number;
  total?: number;
  success?: boolean;
  margin?: number;
  seq?: number;
}

export interface DeclareCheckToolInput {
  sceneId: string;
  actorId: string;
  skill: string;
  dc?: number;
  dcRef?: string;
  mode?: "normal" | "advantage" | "disadvantage";
  promptEs: string;
}

export interface DeclareCheckToolOutput {
  ok?: boolean;
  code?: string;
  checkId: string;
  skill: string;
  dc: number;
  dcRef?: string;
  declaredTotal: number;
  dieResults: number[];
  naturalRoll: number;
  expectedModifier: number;
  success: boolean;
  margin: number;
}

export interface InvestigateToolInput {
  sceneId: string;
  actorId: string;
  skill?: "investigation" | "perception";
  mode?: "normal" | "advantage" | "disadvantage";
}

export interface InvestigateToolOutput {
  ok: boolean;
  messageEs: string;
  total?: number;
  naturalRoll?: number;
  modifier?: number;
  unlockedClues?: Array<{
    id: string;
    dc: number;
    titleEs: string;
    descriptionEs: string;
    tacticalEffectEs: string;
  }>;
  allUnlockedClueIds?: string[];
  seq?: number;
}

export interface TransitionSceneToolInput {
  targetSceneId: string;
  actorId?: string;
  reason: string;
}

export interface TransitionSceneToolOutput {
  ok: boolean;
  messageEs: string;
  fromSceneId?: string;
  toSceneId?: string;
  titleEs?: string;
  summaryEs?: string;
  narrativeHookEs?: string;
  allowedTransitions?: string[];
  seq?: number;
}

export interface InventoryToolInput {
  sceneId: string;
  actorId: string;
  itemId: string;
  itemName?: string;
  qtyDelta: number;
  reason: string;
}

export interface InventoryToolOutput {
  ok: boolean;
  messageEs: string;
  itemId?: string;
  itemName?: string;
  quantityBefore?: number;
  quantityAfter?: number;
  seq?: number;
}

export interface RollbackToolInput {
  targetSeq: number;
  reason: string;
}

export interface RollbackToolOutput {
  ok: boolean;
  code?: string;
  messageEs: string;
  targetSeq?: number;
  newSceneId?: string;
  lastSeq?: number;
}

export interface LookupRulesToolInput {
  query: string;
  category?: "condition" | "skill" | "equipment" | "spell" | "monster";
  limit?: number;
}

export interface LookupRulesToolOutput {
  ok: boolean;
  results: Array<{
    category: string;
    index: string;
    name: string;
    nameEs: string;
    summaryEs: string;
    rulesetVersion: string;
  }>;
}

export type AguasQuietasCreatureId =
  | "explorador_espesura"
  | "necrofago_de_rio"
  | "comandante_mireia";

export interface CombatStartToolInput {
  sceneId: string;
  enemies: Array<{
    creatureId: AguasQuietasCreatureId;
    count: number;
  }>;
}

export interface CombatStartToolOutput {
  ok: boolean;
  messageEs: string;
  round?: number;
  activeCombatant?: {
    id: string;
    name: string;
    kind: "pc" | "enemy" | "ally";
    initiative: number;
  };
  initiativeOrder?: Array<{
    id: string;
    name: string;
    kind: "pc" | "enemy" | "ally";
    initiative: number;
    hp: { current: number; max: number };
    ac: number;
    attacks: Array<{
      id: string;
      nameEs: string;
      attackBonus: number;
      damageDice: string;
      damageType: string;
    }>;
  }>;
  seq?: number;
}

export interface CombatAttackToolInput {
  sceneId: string;
  attackerId: string;
  targetId: string;
  attackId?: string;
  mode?: "normal" | "advantage" | "disadvantage";
}

export interface CombatAttackToolOutput {
  ok: boolean;
  messageEs: string;
  attackerId?: string;
  attackerName?: string;
  targetId?: string;
  targetName?: string;
  attackId?: string;
  attackNameEs?: string;
  attackRolls?: number[];
  naturalRoll?: number;
  attackBonus?: number;
  attackTotal?: number;
  targetAc?: number;
  hit?: boolean;
  isCritical?: boolean;
  isCriticalMiss?: boolean;
  damageType?: string;
  damageExpressionUsed?: string | null;
  damageRolls?: number[];
  rawDamage?: number;
  damageRelation?: "normal" | "resistant" | "vulnerable" | "immune";
  damageApplied?: number;
  targetHpBefore?: number;
  targetHpAfter?: number;
  targetDefeated?: boolean;
  allEnemiesDefeated?: boolean;
  allPcsDefeated?: boolean;
  concentrationCheck?: {
    spell: string;
    dc: number;
    naturalRoll: number | null;
    modifier: number;
    total: number | null;
    maintained: boolean;
  };
  seq?: number;
}

export interface ApplyConditionToolInput {
  sceneId: string;
  actorId: string;
  addConditions?: string[];
  removeConditions?: string[];
  exhaustionDelta?: number;
  concentratingOn?: string | null;
  reason: string;
}

export interface ApplyConditionToolOutput {
  ok: boolean;
  code?: string;
  messageEs: string;
  actorId?: string;
  conditionsAfter?: string[];
  exhaustionLevelAfter?: number;
  concentratingOnAfter?: string | null;
  seq?: number;
}

export interface RememberFactToolInput {
  category: "npc" | "promise" | "milestone" | "scene" | "item";
  content: string;
  importance?: number;
}

export interface RememberFactToolOutput {
  ok: boolean;
  messageEs: string;
  category?: string;
  content?: string;
  importance?: number;
  eventSeq?: number;
}

export interface CombatNextTurnToolInput {
  sceneId: string;
}

export interface CombatNextTurnToolOutput {
  ok: boolean;
  messageEs: string;
  round?: number;
  roundAdvanced?: boolean;
  turnIndex?: number;
  previousCombatantId?: string;
  activeCombatant?: {
    id: string;
    name: string;
    kind: "pc" | "enemy" | "ally";
    hp: { current: number; max: number };
    ac: number;
  };
  seq?: number;
}

export interface CombatEndToolInput {
  sceneId: string;
  outcome: "victory" | "fled" | "truce";
  reason: string;
}

export interface CombatEndToolOutput {
  ok: boolean;
  messageEs: string;
  outcome?: "victory" | "fled" | "truce";
  reason?: string;
  roundsElapsed?: number;
  seq?: number;
}

export interface CastSpellToolInput {
  sceneId: string;
  casterId: string;
  spellId: string;
  slotLevel?: number;
  targetId?: string;
  mode?: "normal" | "advantage" | "disadvantage";
}

export interface CastSpellToolOutput {
  ok: boolean;
  code?: string;
  messageEs: string;
  spellId?: string;
  spellNameEs?: string;
  slotLevelUsed?: number;
  kind?: "attack" | "save" | "auto_hit" | "heal" | "utility";
  concentration?: boolean;
  spellAttackBonus?: number;
  spellSaveDc?: number;
  targetId?: string;
  targetName?: string;
  attackRoll?: {
    rolls: number[];
    naturalRoll: number;
    total: number;
    targetAc: number;
    hit: boolean;
    isCritical: boolean;
    effectiveMode: "normal" | "advantage" | "disadvantage";
  };
  savingThrow?: {
    ability: string;
    dc: number;
    rolls: number[];
    naturalRoll: number;
    modifier: number;
    total: number;
    saved: boolean;
  };
  damageApplied?: number;
  damageType?: string;
  healingApplied?: number;
  targetHpAfter?: number;
  slotPoolAfter?: { current: number; max: number };
  seq?: number;
}

export interface TakeRestToolInput {
  sceneId: string;
  actorId: string;
  restType: "short" | "long";
  hitDiceToSpend?: number;
}

export interface TakeRestToolOutput {
  ok: boolean;
  code?: string;
  messageEs: string;
  actorId?: string;
  restType?: "short" | "long";
  hpBefore?: number;
  hpAfter?: number;
  hpHealed?: number;
  hitDiceSpent?: number;
  hitDiceAfter?: { die: string; current: number; max: number };
  slotsRestored?: boolean;
  exhaustionAfter?: number;
  seq?: number;
}

export interface DeathSaveToolInput {
  sceneId: string;
  actorId: string;
  mode?: "normal" | "advantage" | "disadvantage";
}

export interface DeathSaveToolOutput {
  ok: boolean;
  code?: string;
  messageEs: string;
  actorId?: string;
  naturalRoll?: number;
  total?: number;
  outcome?:
    | "critical_recovery"
    | "success"
    | "stabilized"
    | "failure"
    | "critical_failure"
    | "dead";
  deathSavesAfter?: { successes: number; failures: number; stable: boolean };
  hpAfter?: number;
  seq?: number;
}

export interface HealToolInput {
  sceneId: string;
  actorId: string;
  targetId: string;
  source: "potion" | "medicine_stabilize" | "feature";
  itemId?: string;
  diceExpression?: string;
  reason: string;
}

export interface HealToolOutput {
  ok: boolean;
  code?: string;
  messageEs: string;
  targetId?: string;
  targetName?: string;
  source?: "potion" | "medicine_stabilize" | "feature";
  hpBefore?: number;
  hpAfter?: number;
  hpHealed?: number;
  stabilized?: boolean;
  itemConsumed?: string;
  seq?: number;
}

export type SuggestedActionTone =
  | "blue"
  | "crimson"
  | "violet"
  | "emerald"
  | "amber";

export interface SuggestedActionItem {
  skill: string;
  tone?: SuggestedActionTone;
  label: string;
}

export interface SuggestActionsToolInput {
  sceneLabel?: string;
  actions: SuggestedActionItem[];
}

export interface SuggestActionsToolOutput {
  ok: boolean;
  sceneLabel?: string;
  actions: SuggestedActionItem[];
}

export type DmToolSetTypes = {
  resolve_check: {
    input: ResolveCheckToolInput;
    output: ResolveCheckToolOutput;
  };
  resolve_save: {
    input: ResolveSaveToolInput;
    output: ResolveSaveToolOutput;
  };
  declare_check: {
    input: DeclareCheckToolInput;
    output: DeclareCheckToolOutput;
  };
  investigate: {
    input: InvestigateToolInput;
    output: InvestigateToolOutput;
  };
  transition_scene: {
    input: TransitionSceneToolInput;
    output: TransitionSceneToolOutput;
  };
  inventory: {
    input: InventoryToolInput;
    output: InventoryToolOutput;
  };
  rollback_to_event: {
    input: RollbackToolInput;
    output: RollbackToolOutput;
  };
  lookup_rules: {
    input: LookupRulesToolInput;
    output: LookupRulesToolOutput;
  };
  combat_start: {
    input: CombatStartToolInput;
    output: CombatStartToolOutput;
  };
  combat_attack: {
    input: CombatAttackToolInput;
    output: CombatAttackToolOutput;
  };
  combat_next_turn: {
    input: CombatNextTurnToolInput;
    output: CombatNextTurnToolOutput;
  };
  combat_end: {
    input: CombatEndToolInput;
    output: CombatEndToolOutput;
  };
  apply_condition: {
    input: ApplyConditionToolInput;
    output: ApplyConditionToolOutput;
  };
  remember_fact: {
    input: RememberFactToolInput;
    output: RememberFactToolOutput;
  };
  cast_spell: {
    input: CastSpellToolInput;
    output: CastSpellToolOutput;
  };
  take_rest: {
    input: TakeRestToolInput;
    output: TakeRestToolOutput;
  };
  death_save: {
    input: DeathSaveToolInput;
    output: DeathSaveToolOutput;
  };
  heal: {
    input: HealToolInput;
    output: HealToolOutput;
  };
  suggest_actions: {
    input: SuggestActionsToolInput;
    output: SuggestActionsToolOutput;
  };
  ask_user: {
    input: {
      questions: Array<{
        question: string;
        choices: string[];
      }>;
    };
    output: Array<{ question: string; answer: string }>;
  };
  // Retained for backward compatibility with template trace components
  github_repo: {
    input: { owner: string; repo: string };
    output: { error: string } | { stars: number; name?: string; description?: string };
  };
  web_search: {
    input: { query?: string };
    output: unknown;
  };
};

export type DmChatUIMessage = UIMessage<
  {
    reasoningDurations?: Record<number, number>;
  },
  UIDataTypes,
  DmToolSetTypes
>;

export type DmChatMessagePart = DmChatUIMessage["parts"][number];
