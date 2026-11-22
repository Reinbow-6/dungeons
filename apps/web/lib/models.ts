export type LLMProviderId = "openrouter" | "groq" | "google";

export type ModelAccessTier = "free" | "whitelisted";

export type ReasoningEffort = "none" | "low" | "medium" | "high";

export interface ModelOption {
  id: string;
  name: string;
  provider: LLMProviderId;
  modelId: string;
  accessTier: ModelAccessTier;
  supportsReasoning?: boolean;
}

/** Alias retained for template UI components (ModelSelect, Chat). */
export type GatewayModel = ModelOption;

export const MODELS: ModelOption[] = [
  {
    id: "openrouter:deepseek/deepseek-v4.1-flash-1017",
    name: "DeepSeek V4.1 Flash (Principal)",
    provider: "openrouter",
    modelId: "deepseek/deepseek-v4.1-flash-1017",
    accessTier: "whitelisted",
    supportsReasoning: true,
  },
  {
    id: "openrouter:openrouter/free",
    name: "OpenRouter Free Router (Gratis · Auto)",
    provider: "openrouter",
    modelId: "openrouter/free",
    accessTier: "free",
    supportsReasoning: true,
  },
];

export const DEFAULT_MODEL = MODELS[0]!.id;

export const GUEST_DEFAULT_MODEL = "openrouter:openrouter/free";

export function findModelOption(id: string): ModelOption | undefined {
  return MODELS.find((model) => model.id === id);
}

export function isModelAllowed(id: string): boolean {
  return MODELS.some((model) => model.id === id);
}

export function isModelAllowedForTier(
  id: string,
  tier: "guest" | "whitelisted",
): boolean {
  const option = findModelOption(id);
  if (!option) {
    return false;
  }
  if (tier === "whitelisted") {
    return true;
  }
  return option.accessTier === "free";
}

export function normalizeReasoningEffort(raw: unknown): ReasoningEffort {
  if (typeof raw !== "string") {
    return "none";
  }
  const normalized = raw.trim().toLowerCase();
  if (
    normalized === "none" ||
    normalized === "low" ||
    normalized === "medium" ||
    normalized === "high"
  ) {
    return normalized;
  }
  return "none";
}
