import { resolveSave } from "@dungeons/rules";
import { tool } from "ai";
import { z } from "zod";

import type { ResolveSaveToolOutput } from "@/agent/types";
import { isStaleSeqError } from "@/lib/game/store";
import { AbilityZod, RollModeZod, type DmToolRuntime } from "./runtime";

export function createResolveSaveTool(rt: DmToolRuntime) {
  return tool({
    description:
      "Resuelve una tirada de salvación 5e contra una CD usando el motor determinista.",
    inputSchema: z
      .object({
        sceneId: z.string().min(1),
        actorId: z.string().min(1),
        ability: AbilityZod,
        dc: z.number().int().min(1).max(40).optional(),
        dcRef: z
          .string()
          .min(1)
          .optional()
          .describe(
            "Opcional. SOLO usar con un ID exacto de pista de la escena actual (p. ej. pista_camp_12). Nunca pongas descripciones ni texto libre; para pruebas generales usá solo dc.",
          ),
        mode: RollModeZod.optional(),
      })
      .strict(),
    execute: async (input): Promise<ResolveSaveToolOutput> => {
      const state = rt.getState();
      const res = resolveSave(state, input, {
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
          ? `Fallo automático en salvación de ${input.ability.toUpperCase()} por condición activa.`
          : res.success
            ? `Salvación de ${input.ability.toUpperCase()} superada (${res.total} vs CD ${res.dc}).`
            : `Salvación de ${input.ability.toUpperCase()} fallida (${res.total} vs CD ${res.dc}).`,
        checkId: res.checkId,
        ability: input.ability,
        dc: res.dc,
        dcRef: input.dcRef,
        ...(res.autoFailed ? { autoFailed: true } : {}),
        rolls: res.rolls,
        naturalRoll: res.naturalRoll,
        modifier: res.modifier,
        ...(res.breakdown ? { breakdown: res.breakdown } : {}),
        total: res.total,
        success: res.success,
        margin: res.margin,
        seq: res.event.seq,
      };
    },
  });
}
