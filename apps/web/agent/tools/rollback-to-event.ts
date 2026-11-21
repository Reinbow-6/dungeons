import { tool } from "ai";
import { z } from "zod";

import type { RollbackToolOutput } from "@/agent/types";
import type { DmToolRuntime } from "./runtime";

export function createRollbackTool(rt: DmToolRuntime) {
  return tool({
    description:
      "Revierte el estado de la campaña hasta una secuencia anterior del event_log (solo si el jugador pide deshacer turnos).",
    inputSchema: z
      .object({
        targetSeq: z.number().int().min(0),
        reason: z.string().min(1),
      })
      .strict(),
    execute: async (input): Promise<RollbackToolOutput> => {
      const res = await rt.commitRollback(input.targetSeq, input.reason);
      if (!res.ok) {
        return { ok: false, code: res.code, messageEs: res.messageEs };
      }

      return {
        ok: true,
        messageEs: `Partida revertida hasta la secuencia ${input.targetSeq} (${input.reason}).`,
        targetSeq: input.targetSeq,
        newSceneId: res.state.sceneId,
        lastSeq: res.state.lastSeq,
      };
    },
  });
}
