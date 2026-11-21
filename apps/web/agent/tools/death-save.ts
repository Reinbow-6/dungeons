import { resolveDeathSave } from "@dungeons/rules";
import { tool } from "ai";
import { z } from "zod";

import type { DeathSaveToolOutput } from "@/agent/types";
import { isStaleSeqError } from "@/lib/game/store";
import { RollModeZod, type DmToolRuntime } from "./runtime";

export function createDeathSaveTool(rt: DmToolRuntime) {
  return tool({
    description:
      "Resuelve una tirada de salvación contra la muerte (d20) para un PJ en 0 PG: nat 20 vuelve con 1 PG, nat 1 suma 2 fallos, 10+ suma 1 éxito (3 = estable), <10 suma 1 fallo (3 = muerte).",
    inputSchema: z
      .object({
        sceneId: z.string().min(1),
        actorId: z.string().min(1),
        mode: RollModeZod.optional(),
      })
      .strict(),
    execute: async (input): Promise<DeathSaveToolOutput> => {
      const state = rt.getState();
      const res = resolveDeathSave(state, input, {
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

      const outcomeText: Record<typeof res.outcome, string> = {
        critical_recovery: "¡20 natural! Recupera 1 PG y vuelve en sí",
        stabilized: "3 éxitos — el personaje queda estable en 0 PG",
        success: `Éxito (${res.deathSavesAfter.successes}/3 éxitos, ${res.deathSavesAfter.failures}/3 fallos)`,
        failure: `Fallo (${res.deathSavesAfter.successes}/3 éxitos, ${res.deathSavesAfter.failures}/3 fallos)`,
        critical_failure: `¡1 natural! +2 fallos (${res.deathSavesAfter.failures}/3 fallos)`,
        dead: "3 fallos acumulados — el personaje ha muerto",
      };

      return {
        ok: true,
        messageEs: `Salvación de muerte de ${res.actorName} (d20=${res.naturalRoll}): ${outcomeText[res.outcome]}.`,
        actorId: res.actorId,
        naturalRoll: res.naturalRoll,
        total: res.total,
        outcome: res.outcome,
        deathSavesAfter: res.deathSavesAfter,
        hpAfter: res.hpAfter,
        seq: res.event.seq,
      };
    },
  });
}
