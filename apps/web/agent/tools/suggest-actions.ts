import { tool } from "ai";
import { z } from "zod";

import type { SuggestActionsToolOutput } from "@/agent/types";

export const SuggestedActionToneZod = z.enum([
  "blue",
  "crimson",
  "violet",
  "emerald",
  "amber",
]);

export function createSuggestActionsTool() {
  return tool({
    description:
      "Publica 3 acciones sugeridas clicables al pie de tu narración (estilo botones [1] [2] [3]) con etiqueta de habilidad/enfoque. Llamala al final de cada turno narrativo cuando no esperes una tirada física de declare_check ni ask_user.",
    inputSchema: z
      .object({
        sceneLabel: z
          .string()
          .min(1)
          .max(64)
          .optional()
          .describe(
            "Opcional: micro-etiqueta atmosférica de escena en mayúsculas, p. ej. 'AGUAS QUIETAS · ORILLA DEL RÍO'.",
          ),
        actions: z
          .array(
            z
              .object({
                skill: z
                  .string()
                  .min(1)
                  .max(32)
                  .describe(
                    "Etiqueta corta de habilidad o enfoque, p. ej. Investigación, Intimidación, Sigilo, Combate, Conjuro, Curación, Descanso, Persuasión.",
                  ),
                tone: SuggestedActionToneZod.optional().describe(
                  "Color semántico: blue (Investigación/Percepción), crimson (Intimidación/Combate), violet (Sigilo/Arcano/Conjuro), emerald (Curación/Supervivencia/Descanso), amber (Persuasión/Social).",
                ),
                label: z
                  .string()
                  .min(4)
                  .max(160)
                  .describe(
                    "Acción concreta y directa en primera persona o infinitivo que se enviará al DM si el jugador hace clic.",
                  ),
              })
              .strict(),
          )
          .min(2)
          .max(4),
      })
      .strict(),
    execute: async (input): Promise<SuggestActionsToolOutput> => {
      return {
        ok: true,
        sceneLabel: input.sceneLabel,
        actions: input.actions,
      };
    },
  });
}
