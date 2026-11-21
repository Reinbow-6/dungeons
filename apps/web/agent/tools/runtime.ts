import type {
  GameEvent,
  GameState,
  Rng,
  RollbackResult,
} from "@dungeons/rules";
import { z } from "zod";

export const AbilityZod = z.enum(["str", "dex", "con", "int", "wis", "cha"]);

export const CheckTargetZod = z.enum([
  "acrobatics",
  "animal_handling",
  "arcana",
  "athletics",
  "deception",
  "history",
  "insight",
  "intimidation",
  "investigation",
  "medicine",
  "nature",
  "perception",
  "performance",
  "persuasion",
  "religion",
  "sleight_of_hand",
  "stealth",
  "survival",
  "str",
  "dex",
  "con",
  "int",
  "wis",
  "cha",
]);

export const RollModeZod = z.enum(["normal", "advantage", "disadvantage"]);

export interface DmToolRuntime {
  campaignId: string;
  sessionId: string;
  guestId: string;
  getState: () => GameState;
  getInitialState: () => GameState;
  getEvents: () => GameEvent[];
  getLogHeadSeq?: () => number;
  commitEvent: (
    event: GameEvent,
    nextState: GameState,
    expectedSeq?: number,
  ) => Promise<void>;
  commitRollback: (targetSeq: number, reason?: string) => Promise<RollbackResult>;
  rng: Rng;
  createId: () => string;
  now: () => string;
}
