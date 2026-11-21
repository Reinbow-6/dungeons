import { tool } from "ai";
import { z } from "zod";

import type { RememberFactToolOutput } from "@/agent/types";
import { sanitizeUntrustedText } from "@/lib/ai/prompt-safety";
import type { DmToolRuntime } from "./runtime";

export function createRememberFactTool(rt: DmToolRuntime) {
  return tool({
    description:
      "Guarda un hecho narrativo importante de la campaña (promesas de NPCs, agravios, alianzas, secretos revelados o hitos) en memoria persistente vinculado a la secuencia actual.",
    inputSchema: z
      .object({
        category: z.enum(["npc", "promise", "milestone", "scene", "item"]),
        content: z.string().min(3).max(280),
        importance: z.number().int().min(1).max(10).default(7),
      })
      .strict(),
    execute: async (input): Promise<RememberFactToolOutput> => {
      const safeContent = sanitizeUntrustedText(input.content, 280);
      if (safeContent.length < 3) {
        return {
          ok: false,
          messageEs: "El contenido del hecho de memoria es demasiado corto.",
        };
      }

      const currentSeq = rt.getState().lastSeq;
      if (rt.saveMemoryFact) {
        await rt.saveMemoryFact({
          category: input.category,
          content: safeContent,
          importance: input.importance,
          eventSeq: currentSeq,
        });
      }

      return {
        ok: true,
        messageEs: `Hecho guardado en memoria de campaña [${input.category}, seq ${currentSeq}]: ${safeContent}`,
        category: input.category,
        content: safeContent,
        importance: input.importance,
        eventSeq: currentSeq,
      };
    },
  });
}
