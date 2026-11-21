import { resolveCheck } from "@dungeons/rules";
import { tool } from "ai";
import { z } from "zod";

import type { ResolveCheckToolOutput } from "@/agent/types";
import { isStaleSeqError } from "@/lib/game/store";
import { CheckTargetZod, RollModeZod, type DmToolRuntime } from "./runtime";

export function createResolveCheckTool(rt: DmToolRuntime) {
  return tool({
    description:
      "Resuelve una prueba de habilidad o característica usando el motor determinista 5e (solo modo digital). Prohibido enviar totales o dados inventados.",
    inputSchema: z
      .object({
        sceneId: z.string().min(1),
        actorId: z.string().min(1),
        skill: CheckTargetZod,
        dc: z.number().int().min(1).max(40).optional(),
        dcRef: z.string().min(1).optional(),
        mode: RollModeZod.optional(),
        requiresSight: z.boolean().optional(),
      })
      .strict(),
    execute: async (input): Promise<ResolveCheckToolOutput> => {
      const state = rt.getState();
      const res = resolveCheck(state, input, {
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
      return {
        ok: true,
        messageEs: res.autoFailed
          ? `Fallo automático en ${input.skill} por condición activa (p. ej. cegado).`
          : res.success
            ? `Éxito en ${input.skill} (${res.total} vs CD ${res.dc}).`
            : `Fallo en ${input.skill} (${res.total} vs CD ${res.dc}).`,
        checkId: res.checkId,
        skill: input.skill,
        dc: res.dc,
        dcRef: input.dcRef,
        ...(res.autoFailed ? { autoFailed: true } : {}),
        rolls: res.rolls,
        naturalRoll: res.naturalRoll,
        modifier: res.modifier,
        total: res.total,
        success: res.success,
        margin: res.margin,
        seq: res.event.seq,
      };
    },
  });
}
