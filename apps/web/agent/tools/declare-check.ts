import { tool } from "ai";
import { z } from "zod";

import { CheckTargetZod, RollModeZod } from "./runtime";

/**
 * Human-in-the-loop tool for Hybrid Mode ("el papel manda en el personaje").
 * Has NO execute(): the UI collects physical d20 dieResults + declaredTotal via
 * keyboard, verifies them via POST /api/game/declare-check, and returns the
 * verified output via addToolOutput.
 */
export const declareCheckTool = tool({
  description:
    "Solicita al jugador que tire su dado físico real e ingrese el resultado por teclado (Modo Híbrido). Nunca envíes números de dado ni totales.",
  inputSchema: z
    .object({
      sceneId: z.string().min(1),
      actorId: z.string().min(1),
      skill: CheckTargetZod,
      dc: z.number().int().min(1).max(40).optional(),
      dcRef: z.string().min(1).optional(),
      mode: RollModeZod.default("normal"),
      promptEs: z
        .string()
        .min(1)
        .describe(
          "Instrucción breve en español indicando qué tirar en la mesa física.",
        ),
    })
    .strict()
    .refine((d) => d.dc !== undefined || d.dcRef !== undefined, {
      message: "Debés indicar una CD numérica (`dc`) o una referencia de escena (`dcRef`).",
    }),
  outputSchema: z.object({
    ok: z.boolean().optional(),
    code: z.string().optional(),
    checkId: z.string(),
    skill: z.string(),
    dc: z.number().int(),
    dcRef: z.string().optional(),
    declaredTotal: z.number().int(),
    dieResults: z.array(z.number().int()),
    naturalRoll: z.number().int(),
    expectedModifier: z.number().int(),
    success: z.boolean(),
    margin: z.number().int(),
  }),
});
