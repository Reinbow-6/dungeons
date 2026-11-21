import { resolveHeal } from "@dungeons/rules";
import { tool } from "ai";
import { z } from "zod";

import type { HealToolOutput } from "@/agent/types";
import { isStaleSeqError } from "@/lib/game/store";
import type { DmToolRuntime } from "./runtime";

export function createHealTool(rt: DmToolRuntime) {
  return tool({
    description:
      "Aplica curación determinista o estabilización a un PJ: poción de curación del inventario (`potion`), prueba de Medicina CD 10 para estabilizar a 0 PG (`medicine_stabilize`) o rasgo de clase como Tomar aliento (`feature`).",
    inputSchema: z
      .object({
        sceneId: z.string().min(1),
        actorId: z.string().min(1),
        targetId: z.string().min(1),
        source: z.enum(["potion", "medicine_stabilize", "feature"]),
        itemId: z.string().min(1).optional(),
        diceExpression: z.string().min(1).optional(),
        reason: z.string().min(1),
      })
      .strict(),
    execute: async (input): Promise<HealToolOutput> => {
      const state = rt.getState();
      const res = resolveHeal(state, input, {
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
          return { ok: false, code: "STALE_SEQ", messageEs: err.message };
        }
        throw err;
      }

      const msg = res.medicineCheck
        ? res.stabilized
          ? `Medicina (${res.medicineCheck.total} vs CD 10): ${res.targetName} queda estable en 0 PG.`
          : `Medicina (${res.medicineCheck.total} vs CD 10): no logra estabilizar a ${res.targetName}.`
        : `${res.targetName} recupera +${res.hpHealed} PG (${res.hpBefore} → ${res.hpAfter})${res.itemConsumed ? ` usando ${res.itemConsumed}` : ""}.`;

      return {
        ok: true,
        messageEs: msg,
        targetId: res.targetId,
        targetName: res.targetName,
        source: res.source,
        hpBefore: res.hpBefore,
        hpAfter: res.hpAfter,
        hpHealed: res.hpHealed,
        stabilized: res.stabilized,
        itemConsumed: res.itemConsumed,
        seq: res.event.seq,
      };
    },
  });
}
