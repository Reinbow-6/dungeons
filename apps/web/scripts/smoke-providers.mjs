import { config } from "dotenv";
import { createGroq } from "@ai-sdk/groq";
import { createOpenRouter } from "@openrouter/ai-sdk-provider";
import { generateText, isStepCount, tool } from "ai";
import { z } from "zod";

config({ path: ".env.local" });
config();

const testTool = tool({
  description:
    "Resuelve una prueba de habilidad 5e determinista. Nunca inventes números de dado.",
  inputSchema: z
    .object({
      sceneId: z.string().min(1),
      actorId: z.string().min(1),
      skill: z.enum(["perception", "investigation", "stealth"]),
      dc: z.number().int().min(1).max(30),
    })
    .strict(),
  execute: async (input) => ({
    ok: true,
    skill: input.skill,
    dc: input.dc,
    naturalRoll: 14,
    modifier: 4,
    total: 18,
    success: true,
    messageEs: "Éxito en perception (18 vs CD 12).",
  }),
});

const targets = [
  {
    id: "openrouter:openrouter/free",
    provider: "openrouter",
    modelId: "openrouter/free",
    buildModel: () => {
      const apiKey = process.env.OPENROUTER_API_KEY?.trim();
      if (!apiKey) return null;
      return { model: createOpenRouter({ apiKey }).chat("openrouter/free") };
    },
  },
  {
    id: "groq:qwen/qwen3.8-27b",
    provider: "groq",
    modelId: "qwen/qwen3.8-27b",
    buildModel: () => {
      const apiKey = process.env.GROQ_API_KEY?.trim();
      if (!apiKey) return null;
      return {
        model: createGroq({ apiKey })("qwen/qwen3.8-27b"),
        providerOptions: { groq: { reasoningFormat: "parsed" } },
      };
    },
  },
  {
    id: "groq:openai/gpt-oss-120b",
    provider: "groq",
    modelId: "openai/gpt-oss-120b",
    buildModel: () => {
      const apiKey = process.env.GROQ_API_KEY?.trim();
      if (!apiKey) return null;
      return { model: createGroq({ apiKey })("openai/gpt-oss-120b") };
    },
  },
];

let anyFailed = false;

for (const target of targets) {
  const built = target.buildModel();
  if (!built) {
    console.log(`[SKIP] ${target.id} — falta API key del proveedor.`);
    continue;
  }

  const startedAt = Date.now();
  try {
    const res = await generateText({
      model: built.model,
      ...(built.providerOptions
        ? { providerOptions: built.providerOptions }
        : {}),
      system:
        "Sos un Dungeon Master de D&D 5e en español. Debés invocar la herramienta resolve_check antes de narrar el resultado. Respondé en máximo 2 oraciones.",
      prompt:
        "Soy Kael (actorId: pc_kael) en escena_01_orilla. Quiero inspeccionar la niebla con Percepción (skill: perception, dc: 12).",
      tools: { resolve_check: testTool },
      stopWhen: isStepCount(3),
      maxOutputTokens: 256,
    });

    const latencyMs = Date.now() - startedAt;
    const toolCalls = res.steps.flatMap((s) =>
      s.toolCalls.map((tc) => tc.toolName),
    );
    const hasLeak =
      /<think>|<\/think>|<function=|tool_call/i.test(res.text ?? "");
    const calledTool = toolCalls.includes("resolve_check");
    const status = calledTool && !hasLeak ? "PASS" : "WARN";
    if (!calledTool || hasLeak) {
      anyFailed = true;
    }

    console.log(
      JSON.stringify({
        status,
        target: target.id,
        latencyMs,
        toolCalls,
        hasLeak,
        inputTokens: res.totalUsage?.inputTokens ?? 0,
        outputTokens: res.totalUsage?.outputTokens ?? 0,
        textPreview: (res.text ?? "").replace(/\s+/g, " ").slice(0, 120),
      }),
    );
  } catch (err) {
    anyFailed = true;
    const latencyMs = Date.now() - startedAt;
    console.error(
      JSON.stringify({
        status: "FAIL",
        target: target.id,
        latencyMs,
        errorName: err instanceof Error ? err.name : "Error",
        errorMessage: err instanceof Error ? err.message : String(err),
      }),
    );
  }
}

if (anyFailed) {
  process.exitCode = 1;
}
