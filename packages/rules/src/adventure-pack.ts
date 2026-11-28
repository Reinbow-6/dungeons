import { z } from 'zod';
import {
  AbilitiesBlockSchema,
  RulesetProfileSchema,
  SkillSchema,
  type GameState,
  type SceneDefinition,
} from './types.js';

export const AdventureSuggestedActionToneSchema = z.enum([
  'blue',
  'violet',
  'emerald',
  'amber',
  'rose',
]);
export type AdventureSuggestedActionTone = z.infer<
  typeof AdventureSuggestedActionToneSchema
>;

export const AdventureSuggestedActionSchema = z.object({
  skill: z.string().min(1),
  label: z.string().min(1),
  tone: AdventureSuggestedActionToneSchema,
});
export type AdventureSuggestedAction = z.infer<
  typeof AdventureSuggestedActionSchema
>;

export const AdventureCreatureAttackSchema = z.object({
  id: z.string().min(1).optional(),
  nameEs: z.string().min(1),
  kind: z.enum(['melee', 'ranged']),
  attackBonus: z.number().int(),
  damageDice: z.string().min(1),
  damageType: z.string().min(1),
  rangeText: z.string().min(1),
});
export type AdventureCreatureAttack = z.infer<
  typeof AdventureCreatureAttackSchema
>;

export const AdventureCreatureSchema = z.object({
  id: z.string().min(1),
  nameEs: z.string().min(1),
  srdBaseIndex: z.string().min(1).optional(),
  cr: z.number().nonnegative(),
  ac: z.number().int().min(1).max(30),
  hp: z.number().int().min(1),
  speedTextEs: z.string().min(1),
  abilities: AbilitiesBlockSchema,
  skills: z.record(SkillSchema, z.number().int()).default({}),
  vulnerabilities: z.array(z.string().min(1)).default([]),
  immunities: z.array(z.string().min(1)).default([]),
  resistances: z.array(z.string().min(1)).optional(),
  traitsEs: z.array(z.string().min(1)).default([]),
  attacks: z.array(AdventureCreatureAttackSchema).min(1),
  rulesetVersion: z.string().min(1).optional(),
});
export type AdventureCreature = z.infer<typeof AdventureCreatureSchema>;

export const LorebookCategorySchema = z.enum([
  'faction',
  'location',
  'npc',
  'creature',
  'world',
  'item',
]);

export const AdventureLorebookEntrySchema = z.object({
  id: z.string().min(1),
  titleEs: z.string().min(1),
  category: LorebookCategorySchema,
  keywords: z.array(z.string().min(1)).min(1),
  secondaryKeywords: z.array(z.string().min(1)).optional(),
  activeSceneIds: z.array(z.string().min(1)).optional(),
  requiresAnyClue: z.array(z.string().min(1)).optional(),
  constant: z.boolean().optional(),
  priority: z.number().int().min(1).max(100),
  contentEs: z.string().min(1),
});

export const NpcMindAttitudeRuleSchema = z.object({
  requiresClueId: z.string().min(1).optional(),
  requiresCombat: z.boolean().optional(),
  attitudeEs: z.string().min(1),
});
export type NpcMindAttitudeRule = z.infer<typeof NpcMindAttitudeRuleSchema>;

export const NpcMindTemplateSchema = z.object({
  id: z.string().min(1),
  nameEs: z.string().min(1),
  roleEs: z.string().min(1),
  activeSceneIds: z.array(z.string().min(1)).default([]),
  triggerKeywords: z.array(z.string().min(1)).default([]),
  revealInSceneWhenAnyClue: z
    .object({
      sceneId: z.string().min(1),
      clueIds: z.array(z.string().min(1)).min(1),
    })
    .optional(),
  knowsEs: z.string().min(1),
  doesNotKnowEs: z.string().min(1),
  wantsEs: z.string().min(1),
  hidesEs: z.string().min(1),
  defaultAttitudeEs: z.string().min(1),
  attitudeRules: z.array(NpcMindAttitudeRuleSchema).optional(),
});
export type NpcMindTemplate = z.infer<typeof NpcMindTemplateSchema>;

export const AdventureIntroSchema = z.object({
  soloParagraphsEs: z.array(z.string().min(1)).min(1),
  groupParagraphsEs: z.array(z.string().min(1)).min(1),
  suggestedActions: z.array(AdventureSuggestedActionSchema).min(1).max(4),
});
export type AdventureIntro = z.infer<typeof AdventureIntroSchema>;

export const SceneClueSchema = z.object({
  id: z.string().min(1),
  dc: z.number().int().min(1).max(35),
  titleEs: z.string().min(1),
  descriptionEs: z.string().min(1),
  tacticalEffectEs: z.string().min(1),
});

export const TransitionRequirementSchema = z.object({
  requiredClues: z.array(z.string().min(1)).optional(),
  requiredFlags: z.array(z.string().min(1)).optional(),
});

export const SceneDefinitionSchema: z.ZodType<SceneDefinition> = z.object({
  id: z.string().min(1),
  titleEs: z.string().min(1),
  summaryEs: z.string().min(1),
  narrativeHookEs: z.string().min(1).optional(),
  shortLabelEs: z.string().min(1).optional(),
  baseTension: z.number().int().min(0).max(100).optional(),
  allowedTransitions: z.array(z.string().min(1)),
  clues: z.array(SceneClueSchema),
  transitionRequirements: z
    .record(z.string().min(1), TransitionRequirementSchema)
    .optional(),
});

export const MainQuestStageSchema = z.object({
  id: z.string().min(1),
  order: z.number().int().min(1),
  titleEs: z.string().min(1),
  goalEs: z.string().min(1),
  sceneIds: z.array(z.string().min(1)).min(1),
  actTitleEs: z.string().min(1).optional(),
  dramaticBeatEs: z.string().min(1).optional(),
});
export type MainQuestStage = z.infer<typeof MainQuestStageSchema>;

export const AlternativeEndingSpecSchema = z.object({
  id: z.string().min(1),
  titleEs: z.string().min(1),
  summaryEs: z.string().min(1),
  isStandard: z.boolean().optional(),
  requiredClueGroups: z.array(z.array(z.string().min(1)).min(1)),
  hintEs: z.string().min(1),
});
export type AlternativeEndingSpec = z.infer<typeof AlternativeEndingSpecSchema>;

export const MainQuestSpecSchema = z.object({
  id: z.string().min(1),
  titleEs: z.string().min(1),
  objectiveEs: z.string().min(1),
  stages: z.array(MainQuestStageSchema).min(1),
  endings: z.array(AlternativeEndingSpecSchema).min(1),
});
export type MainQuestSpec = z.infer<typeof MainQuestSpecSchema>;

export interface EvaluatedEnding extends AlternativeEndingSpec {
  unlocked: boolean;
  matchedGroups: number;
  totalGroups: number;
}

export interface AdventureProgress {
  quest: MainQuestSpec;
  currentStageIndex: number;
  currentStage: MainQuestStage;
  completed: boolean;
  totalClues: number;
  discoveredClueIds: string[];
  discoveredCount: number;
  sceneTotalClues: number;
  sceneDiscoveredCount: number;
  endings: EvaluatedEnding[];
  unlockedAlternativeEndings: EvaluatedEnding[];
}

export const AdventurePackSchema = z.object({
  schemaVersion: z.literal(1),
  id: z
    .string()
    .regex(/^[a-z0-9][a-z0-9-_]{1,63}$/, 'El id debe ser un slug minúscula válido.'),
  titleEs: z.string().min(1),
  subtitleEs: z.string().min(1).optional(),
  worldSummaryEs: z.string().min(1),
  tonePromptEs: z.string().min(1),
  recommendedLevels: z
    .object({
      min: z.number().int().min(1).max(20),
      max: z.number().int().min(1).max(20),
    })
    .optional(),
  recommendedRuleset: RulesetProfileSchema,
  initialSceneId: z.string().min(1),
  epilogueSceneIds: z.array(z.string().min(1)),
  scenes: z.record(z.string().min(1), SceneDefinitionSchema),
  quest: MainQuestSpecSchema,
  intro: AdventureIntroSchema,
  bestiary: z.array(AdventureCreatureSchema).default([]),
  lorebook: z.array(AdventureLorebookEntrySchema).default([]),
  npcMinds: z.array(NpcMindTemplateSchema).default([]),
});
export type AdventurePack = z.infer<typeof AdventurePackSchema>;

export interface AdventurePackValidationResult {
  valid: boolean;
  errors: string[];
  warnings: string[];
  stats: {
    scenes: number;
    clues: number;
    creatures: number;
    lorebookEntries: number;
    npcMinds: number;
    reachableScenes: number;
  };
}

/**
 * Validates referential integrity, unique IDs, and graph reachability of an AdventurePack.
 */
export function validateAdventurePackGraph(
  pack: AdventurePack,
): AdventurePackValidationResult {
  const errors: string[] = [];
  const warnings: string[] = [];

  const sceneEntries = Object.entries(pack.scenes);
  if (sceneEntries.length === 0) {
    errors.push('El pack debe definir al menos una escena.');
  }

  for (const [key, scene] of sceneEntries) {
    if (key !== scene.id) {
      errors.push(
        `La clave de escena "${key}" no coincide con scene.id ("${scene.id}").`,
      );
    }
  }

  if (!pack.scenes[pack.initialSceneId]) {
    errors.push(
      `initialSceneId "${pack.initialSceneId}" no existe en pack.scenes.`,
    );
  }

  for (const epId of pack.epilogueSceneIds) {
    if (!pack.scenes[epId]) {
      errors.push(`epilogueSceneIds referencia escena inexistente "${epId}".`);
    }
  }

  const clueIds = new Set<string>();
  const duplicateClueIds = new Set<string>();
  let totalClues = 0;

  for (const scene of Object.values(pack.scenes)) {
    for (const clue of scene.clues) {
      totalClues += 1;
      if (clueIds.has(clue.id)) {
        duplicateClueIds.add(clue.id);
      } else {
        clueIds.add(clue.id);
      }
    }
  }
  for (const dupId of duplicateClueIds) {
    errors.push(`ID de pista duplicado en escenas: "${dupId}".`);
  }

  for (const scene of Object.values(pack.scenes)) {
    for (const target of scene.allowedTransitions) {
      if (!pack.scenes[target]) {
        errors.push(
          `Escena "${scene.id}" permite transición hacia escena inexistente "${target}".`,
        );
      }
    }

    if (scene.transitionRequirements) {
      for (const [edgeKey, req] of Object.entries(scene.transitionRequirements)) {
        const [fromId, toId] = edgeKey.split('>');
        if (!fromId || !toId || fromId !== scene.id || !pack.scenes[toId]) {
          errors.push(
            `Clave de transitionRequirements inválida "${edgeKey}" en escena "${scene.id}".`,
          );
        }
        for (const reqClue of req.requiredClues ?? []) {
          if (!clueIds.has(reqClue)) {
            errors.push(
              `transitionRequirements "${edgeKey}" exige pista inexistente "${reqClue}".`,
            );
          }
        }
      }
    }
  }

  for (const stage of pack.quest.stages) {
    for (const sceneId of stage.sceneIds) {
      if (!pack.scenes[sceneId]) {
        errors.push(
          `Etapa "${stage.id}" referencia escena inexistente "${sceneId}".`,
        );
      }
    }
  }

  for (const ending of pack.quest.endings) {
    for (const group of ending.requiredClueGroups) {
      for (const clueId of group) {
        if (!clueIds.has(clueId)) {
          errors.push(
            `Final "${ending.id}" referencia pista inexistente "${clueId}".`,
          );
        }
      }
    }
  }

  const checkUnique = (items: ReadonlyArray<{ id: string }>, kind: string) => {
    const seen = new Set<string>();
    for (const item of items) {
      if (seen.has(item.id)) {
        errors.push(`ID duplicado en ${kind}: "${item.id}".`);
      }
      seen.add(item.id);
    }
  };

  checkUnique(pack.bestiary, 'bestiary');
  checkUnique(pack.lorebook, 'lorebook');
  checkUnique(pack.npcMinds, 'npcMinds');

  // BFS reachability from initialSceneId
  const visited = new Set<string>();
  if (pack.scenes[pack.initialSceneId]) {
    const queue: string[] = [pack.initialSceneId];
    visited.add(pack.initialSceneId);
    while (queue.length > 0) {
      const currId = queue.shift()!;
      const curr = pack.scenes[currId];
      if (!curr) continue;
      for (const nextId of curr.allowedTransitions) {
        if (pack.scenes[nextId] && !visited.has(nextId)) {
          visited.add(nextId);
          queue.push(nextId);
        }
      }
    }
  }

  for (const sceneId of Object.keys(pack.scenes)) {
    if (!visited.has(sceneId)) {
      warnings.push(
        `La escena "${sceneId}" no es alcanzable desde initialSceneId ("${pack.initialSceneId}").`,
      );
    }
  }

  return {
    valid: errors.length === 0,
    errors,
    warnings,
    stats: {
      scenes: sceneEntries.length,
      clues: totalClues,
      creatures: pack.bestiary.length,
      lorebookEntries: pack.lorebook.length,
      npcMinds: pack.npcMinds.length,
      reachableScenes: visited.size,
    },
  };
}

export function getAdventureProgress(
  state: GameState,
  pack: AdventurePack,
): AdventureProgress {
  const discoveredSet = new Set<string>();
  for (const ids of Object.values(state.unlockedClues)) {
    for (const id of ids) {
      discoveredSet.add(id);
    }
  }

  let totalClues = 0;
  for (const scene of Object.values(state.scenes)) {
    totalClues += scene.clues.length;
  }

  const currentScene = state.scenes[state.sceneId];
  const sceneTotalClues = currentScene?.clues.length ?? 0;
  const sceneDiscoveredCount = (state.unlockedClues[state.sceneId] ?? []).length;

  const foundStageIndex = pack.quest.stages.findIndex((stage) =>
    stage.sceneIds.includes(state.sceneId),
  );
  const currentStageIndex = foundStageIndex >= 0 ? foundStageIndex : 0;
  const currentStage = pack.quest.stages[currentStageIndex]!;

  const endings: EvaluatedEnding[] = pack.quest.endings.map((ending) => {
    if (ending.requiredClueGroups.length === 0) {
      return {
        ...ending,
        unlocked: true,
        matchedGroups: 0,
        totalGroups: 0,
      };
    }
    const matchedGroups = ending.requiredClueGroups.filter((group) =>
      group.some((clueId) => discoveredSet.has(clueId)),
    ).length;
    return {
      ...ending,
      unlocked: matchedGroups === ending.requiredClueGroups.length,
      matchedGroups,
      totalGroups: ending.requiredClueGroups.length,
    };
  });

  return {
    quest: pack.quest,
    currentStageIndex,
    currentStage,
    completed: pack.epilogueSceneIds.includes(state.sceneId),
    totalClues,
    discoveredClueIds: Array.from(discoveredSet),
    discoveredCount: discoveredSet.size,
    sceneTotalClues,
    sceneDiscoveredCount,
    endings,
    unlockedAlternativeEndings: endings.filter(
      (e) => !e.isStandard && e.unlocked,
    ),
  };
}
