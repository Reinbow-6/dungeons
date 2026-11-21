import { resolveTakeRest } from "@dungeons/rules";
import { tool } from "ai";
import { z } from "zod";

import type { TakeRestToolOutput } from "@/agent/types";
import { isStaleSeqError } from "@/lib/game/store";
import type { DmToolRuntime } from "./runtime";

export function createTakeRestTool(rt: DmToolRuntime) {
  return tool({
    description:
      "Resuelve un descanso corto (gasta Dados de Golpe para recuperar PG) o descanso largo (recupera PG al máximo, todos los spellSlots, Dados de Golpe y reduce 1 nivel de agotamiento). Solo usable fuera de combate.",
    inputSchema: z
      .object({
        sceneId: z.string().min(1),
        actorId: z.string().min(1),
        restType: z.enum(["short", "long"]),
        hitDiceToSpend: z.number().int().min(0).max(20).optional(),
      })
      .strict(),
    execute: async (input): Promise<TakeRestToolOutput> => {
      const state = rt.getState();
      const res = resolveTakeRest(state, input, {
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

      const label = res.restType === "long" ? "Descanso largo" : "Descanso corto";
      const extras: string[] = [`PG ${res.hpBefore} → ${res.hpAfter}`];
      if (res.hitDiceSpent > 0) {
        extras.push(`Dados de Golpe gastados: ${res.hitDiceSpent}`);
      }
      if (res.slotsRestored) {
        extras.push("espacios de conjuro restaurados");
      }
      if (res.exhaustionAfter < res.exhaustionBefore) {
        extras.push(
          `agotamiento ${res.exhaustionBefore} → ${res.exhaustionAfter}`,
        );
      }

      return {
        ok: true,
        messageEs: `${label} de ${res.actorName}: ${extras.join(" · ")}.`,
        actorId: res.actorId,
        restType: res.restType,
        hpBefore: res.hpBefore,
        hpAfter: res.hpAfter,
        hpHealed: res.hpHealed,
        hitDiceSpent: res.hitDiceSpent,
        hitDiceAfter: res.hitDiceAfter,
        slotsRestored: res.slotsRestored,
        exhaustionAfter: res.exhaustionAfter,
        seq: res.event.seq,
      };
    },
  });
}
