import { endCombat } from "@dungeons/rules";
import { tool } from "ai";
import { z } from "zod";

import type { CombatEndToolOutput } from "@/agent/types";
import type { DmToolRuntime } from "./runtime";

export function createCombatEndTool(rt: DmToolRuntime) {
  return tool({
    description:
      "Finaliza el combate activo registrando el desenlace (victory, fled o truce) y limpiando el tracker de iniciativa.",
    inputSchema: z
      .object({
        sceneId: z.string().min(1),
        outcome: z.enum(["victory", "fled", "truce"]),
        reason: z.string().min(1),
      })
      .strict(),
    execute: async (input): Promise<CombatEndToolOutput> => {
      const state = rt.getState();
      const res = endCombat(state, input, {
        rng: rt.rng,
        createId: rt.createId,
        now: rt.now,
      });

      if (!res.ok) {
        return { ok: false, messageEs: res.messageEs };
      }

      await rt.commitEvent(res.event, res.nextState);

      const outcomeLabel =
        input.outcome === "victory"
          ? "Victoria"
          : input.outcome === "fled"
            ? "Retirada"
            : "Tregua";

      return {
        ok: true,
        messageEs: `Combate finalizado (${outcomeLabel}) tras ${res.roundsElapsed} ronda(s): ${input.reason}`,
        outcome: input.outcome,
        reason: input.reason,
        roundsElapsed: res.roundsElapsed,
        seq: res.event.seq,
      };
    },
  });
}
