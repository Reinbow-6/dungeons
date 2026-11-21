import { resolveConditionChange } from "@dungeons/rules";
import { tool } from "ai";
import { z } from "zod";

import type { ApplyConditionToolOutput } from "@/agent/types";
import { isStaleSeqError } from "@/lib/game/store";
import { Condition5eZod, type DmToolRuntime } from "./runtime";

export function createApplyConditionTool(rt: DmToolRuntime) {
  return tool({
    description:
      "Aplica o remueve condiciones oficiales SRD 5.2.1 (blinded, frightened, prone, restrained, poisoned, paralyzed, stunned, unconscious, invisible, incapacitated, exhaustion), niveles de agotamiento o concentración sobre un personaje.",
    inputSchema: z
      .object({
        sceneId: z.string().min(1),
        actorId: z.string().min(1),
        addConditions: z.array(Condition5eZod).min(1).optional(),
        removeConditions: z.array(Condition5eZod).min(1).optional(),
        exhaustionDelta: z.number().int().min(-6).max(6).optional(),
        concentratingOn: z.string().min(1).nullable().optional(),
        reason: z.string().min(1),
      })
      .strict(),
    execute: async (input): Promise<ApplyConditionToolOutput> => {
      const state = rt.getState();
      const res = resolveConditionChange(state, input, {
        rng: rt.rng,
        createId: rt.createId,
        now: rt.now,
      });

      if (!res.ok) {
        return { ok: false, code: res.code, messageEs: res.messageEs };
      }

      try {
        await rt.commitEvent(
          res.event,
          res.nextState,
          rt.getLogHeadSeq?.(),
        );
      } catch (err) {
        if (isStaleSeqError(err)) {
          return {
            ok: false,
            code: "STALE_SEQ",
            messageEs: err.message,
          };
        }
        throw err;
      }

      const condText =
        res.conditionsAfter.length > 0
          ? res.conditionsAfter.join(", ")
          : "ninguna";
      return {
        ok: true,
        messageEs: `Estado actualizado para ${res.actorId}: condiciones [${condText}], agotamiento ${res.exhaustionLevelAfter}, concentración ${res.concentratingOnAfter ?? "ninguna"}.`,
        actorId: res.actorId,
        conditionsAfter: res.conditionsAfter,
        exhaustionLevelAfter: res.exhaustionLevelAfter,
        concentratingOnAfter: res.concentratingOnAfter,
        seq: res.event.seq,
      };
    },
  });
}
