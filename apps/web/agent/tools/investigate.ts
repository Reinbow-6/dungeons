import { resolveInvestigate } from "@dungeons/rules";
import { tool } from "ai";
import { z } from "zod";

import type { InvestigateToolOutput } from "@/agent/types";
import { RollModeZod, type DmToolRuntime } from "./runtime";

export function createInvestigateTool(rt: DmToolRuntime) {
  return tool({
    description:
      "Inspecciona la escena actual para desbloquear pistas escalonadas según la CD alcanzada (Investigación o Percepción).",
    inputSchema: z
      .object({
        sceneId: z.string().min(1),
        actorId: z.string().min(1),
        skill: z.enum(["investigation", "perception"]).optional(),
        mode: RollModeZod.optional(),
      })
      .strict(),
    execute: async (input): Promise<InvestigateToolOutput> => {
      const state = rt.getState();
      const res = resolveInvestigate(state, input, {
        rng: rt.rng,
        createId: rt.createId,
        now: rt.now,
      });

      if (!res.ok) {
        return { ok: false, messageEs: res.messageEs };
      }

      await rt.commitEvent(res.event, res.nextState);
      return {
        ok: true,
        messageEs:
          res.unlockedClues.length > 0
            ? `Tirada ${res.total}: desbloqueaste ${res.unlockedClues.length} pista(s) nueva(s).`
            : `Tirada ${res.total}: no descubriste pistas nuevas en esta escena.`,
        total: res.total,
        naturalRoll: res.naturalRoll,
        modifier: res.modifier,
        unlockedClues: res.unlockedClues.map((c) => ({
          id: c.id,
          dc: c.dc,
          titleEs: c.titleEs,
          descriptionEs: c.descriptionEs,
          tacticalEffectEs: c.tacticalEffectEs,
        })),
        allUnlockedClueIds: res.allUnlockedClueIds,
        seq: res.event.seq,
      };
    },
  });
}
