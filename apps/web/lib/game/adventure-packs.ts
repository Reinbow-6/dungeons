import {
  AGUAS_QUIETAS_PACK,
  BUILTIN_ADVENTURE_PACKS,
  type AdventurePack,
  type RulesetProfile,
} from "@dungeons/rules";
import { AGUAS_QUIETAS_BESTIARY } from "@dungeons/srd";

export interface AdventurePackSummary {
  id: string;
  titleEs: string;
  subtitleEs?: string;
  recommendedRuleset: RulesetProfile;
  recommendedLevels?: { min: number; max: number };
  sceneCount: number;
  clueCount: number;
  creatureCount: number;
  builtin: boolean;
  updatedAt?: string;
}

const RESOLVED_BUILTINS: Record<string, AdventurePack> = Object.fromEntries(
  Object.entries(BUILTIN_ADVENTURE_PACKS).map(([id, pack]) => {
    if (id === "aguas-quietas" && pack.bestiary.length === 0) {
      return [
        id,
        {
          ...pack,
          bestiary: AGUAS_QUIETAS_BESTIARY.map((c) => ({ ...c })),
        },
      ];
    }
    return [id, pack];
  }),
);

export function getBuiltinAdventurePack(id: string): AdventurePack | null {
  return RESOLVED_BUILTINS[id] ?? null;
}

export function isBuiltinAdventurePack(id: string): boolean {
  return Boolean(RESOLVED_BUILTINS[id]);
}

export function summarizeAdventurePack(
  pack: AdventurePack,
  options: { builtin: boolean; updatedAt?: string },
): AdventurePackSummary {
  const scenes = Object.values(pack.scenes);
  const clueCount = scenes.reduce((sum, s) => sum + s.clues.length, 0);
  return {
    id: pack.id,
    titleEs: pack.titleEs,
    ...(pack.subtitleEs ? { subtitleEs: pack.subtitleEs } : {}),
    recommendedRuleset: pack.recommendedRuleset,
    ...(pack.recommendedLevels
      ? { recommendedLevels: pack.recommendedLevels }
      : {}),
    sceneCount: scenes.length,
    clueCount,
    creatureCount: pack.bestiary.length,
    builtin: options.builtin,
    ...(options.updatedAt ? { updatedAt: options.updatedAt } : {}),
  };
}

export function listBuiltinAdventurePackSummaries(): AdventurePackSummary[] {
  return Object.values(RESOLVED_BUILTINS).map((pack) =>
    summarizeAdventurePack(pack, { builtin: true }),
  );
}

export function getFallbackAdventurePack(): AdventurePack {
  return RESOLVED_BUILTINS["aguas-quietas"] ?? AGUAS_QUIETAS_PACK;
}
