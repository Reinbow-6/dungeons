import { lookupRules } from "@dungeons/srd";
import { tool } from "ai";
import { z } from "zod";

import type { LookupRulesToolOutput } from "@/agent/types";

export function createLookupRulesTool() {
  return tool({
    description:
      "Consulta reglas vigentes SRD 5.2.1 en español o inglés (condiciones, habilidades, equipo, conjuros y bestiario de Aguas Quietas).",
    inputSchema: z
      .object({
        query: z.string().min(1),
        category: z
          .enum(["condition", "skill", "equipment", "spell", "monster"])
          .optional(),
        limit: z.number().int().min(1).max(15).optional(),
      })
      .strict(),
    execute: async (input): Promise<LookupRulesToolOutput> => {
      const results = lookupRules({
        query: input.query,
        category: input.category,
        limit: input.limit ?? 5,
      });

      return {
        ok: true,
        results,
      };
    },
  });
}
