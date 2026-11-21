export type LLMProviderId = "openrouter" | "groq" | "google";

export interface ModelOption {
  id: string;
  name: string;
  provider: LLMProviderId;
  modelId: string;
}

/** Alias retained for template UI components (ModelSelect, Chat). */
export type GatewayModel = ModelOption;

export const MODELS: ModelOption[] = [
  // OpenRouter — Default gratuito con auto-enrutado y filtro de tool calling
  {
    id: "openrouter:openrouter/free",
    name: "OpenRouter Free Router (Gratis · Auto)",
    provider: "openrouter",
    modelId: "openrouter/free",
  },
  // Groq — Qwen 3.8 27B + respaldo gratuito activo GPT-OSS 120B (verificado live)
  {
    id: "groq:qwen/qwen3.8-27b",
    name: "Qwen 3.8 27B (Groq)",
    provider: "groq",
    modelId: "qwen/qwen3.8-27b",
  },
  {
    id: "groq:openai/gpt-oss-120b",
    name: "GPT-OSS 120B (Groq · Respaldo)",
    provider: "groq",
    modelId: "openai/gpt-oss-120b",
  },
];

export const DEFAULT_MODEL = MODELS[0]!.id;

export function findModelOption(id: string): ModelOption | undefined {
  return MODELS.find((model) => model.id === id);
}

export function isModelAllowed(id: string): boolean {
  return MODELS.some((model) => model.id === id);
}
