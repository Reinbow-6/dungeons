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
    "Solicita al jugador que tire su dado físico real e ingrese el resultado por teclado (Modo Híbrido). Nunca envíes números de dado ni totales. Usá purpose: 'investigate' cuando el jugador inspecciona o escudriña una escena en busca de pistas. IMPORTANTE: bonificadores de dados/números como Guía (+1d4) o Bendición (+1d4) los suma el motor automáticamente y NO dan ventaja (dejá mode: 'normal').",
  inputSchema: z
    .object({
      sceneId: z.string().min(1),
      actorId: z.string().min(1),
      skill: CheckTargetZod,
      purpose: z
        .enum(["check", "investigate"])
        .optional()
        .describe(
          "Usá 'investigate' cuando el jugador inspecciona la escena buscando pistas en Modo Híbrido.",
        ),
      dc: z.number().int().min(1).max(40).optional(),
      dcRef: z
        .string()
        .min(1)
        .optional()
        .describe(
          "Opcional. SOLO usar con un ID exacto de pista de la escena actual (p. ej. pista_camp_12). Nunca pongas descripciones ni texto libre; para pruebas generales usá solo dc.",
        ),
      mode: RollModeZod.default("normal"),
      promptEs: z
        .string()
        .min(1)
        .describe(
          "Instrucción breve en español indicando qué d20 tirar en la mesa física (no digas 'sumá +X' ni 'con ventaja' por Guía/Bendición, el motor suma los modificadores y +1d4 automáticamente).",
        ),
    })
    .strict()
    .refine(
      (d) =>
        d.purpose === "investigate" ||
        d.dc !== undefined ||
        d.dcRef !== undefined,
      {
        message:
          "Debés indicar una CD numérica (`dc`), una referencia de escena (`dcRef`) o `purpose: \"investigate\"`.",
      },
    ),
  outputSchema: z.object({
    ok: z.boolean().optional(),
    code: z.string().optional(),
    purpose: z.enum(["check", "investigate"]).optional(),
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
    unlockedClues: z
      .array(
        z.object({
          id: z.string(),
          dc: z.number().int(),
          titleEs: z.string(),
          descriptionEs: z.string(),
          tacticalEffectEs: z.string(),
        }),
      )
      .optional(),
  }),
});
