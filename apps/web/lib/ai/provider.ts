import { createGoogleGenerativeAI } from "@ai-sdk/google";
import { createGroq } from "@ai-sdk/groq";
import {
  createOpenRouter,
  type OpenRouterChatSettings,
} from "@openrouter/ai-sdk-provider";
import type { LanguageModel } from "ai";

import {
  DEFAULT_MODEL,
  findModelOption,
  MODELS,
  normalizeReasoningEffort,
  type LLMProviderId,
  type ReasoningEffort,
} from "@/lib/models";

export type ProviderErrorCode =
  | "MISSING_API_KEY"
  | "INVALID_PROVIDER"
  | "MODEL_NOT_ALLOWED"
  | "PROVIDER_UNAVAILABLE";

export class ProviderConfigError extends Error {
  readonly code: ProviderErrorCode;

  constructor(code: ProviderErrorCode, message: string) {
    super(message);
    this.name = "ProviderConfigError";
    this.code = code;
  }
}

export interface ModelConfig {
  provider: LLMProviderId;
  modelId: string;
  selectionId: string;
  mechanicsModel: string;
  narrativeModel: string;
}

function parseProviderEnv(raw?: string): LLMProviderId {
  if (!raw || raw.trim() === "") {
    return "openrouter";
  }
  const normalized = raw.trim().toLowerCase();
  if (
    normalized === "openrouter" ||
    normalized === "groq" ||
    normalized === "google"
  ) {
    return normalized;
  }
  throw new ProviderConfigError(
    "INVALID_PROVIDER",
    `Proveedor LLM inválido "${raw}". Usá "openrouter", "groq" o "google".`,
  );
}

function getDefaultModelIdForProvider(provider: LLMProviderId): string {
  switch (provider) {
    case "openrouter":
      return "deepseek/deepseek-v4.1-flash-1017";
    case "groq":
      return "qwen/qwen3.8-27b";
    case "google":
      return "gemini-3.5-flash-lite";
  }
}

/**
 * Reads runtime LLM settings. Uses a single model by default and keeps
 * MECHANICS_MODEL / NARRATIVE_MODEL reserved for optional split routing later.
 */
export function getModelConfig(
  env: Record<string, string | undefined> = process.env,
): ModelConfig {
  const provider = parseProviderEnv(env.LLM_PROVIDER);
  const defaultModelId = getDefaultModelIdForProvider(provider);
  const modelId = env.LLM_MODEL?.trim() || defaultModelId;
  const selectionId = `${provider}:${modelId}`;

  return {
    provider,
    modelId,
    selectionId,
    mechanicsModel: env.MECHANICS_MODEL?.trim() || modelId,
    narrativeModel: env.NARRATIVE_MODEL?.trim() || modelId,
  };
}

export interface ResolvedLanguageModel {
  model: LanguageModel;
  provider: LLMProviderId;
  modelId: string;
  selectionId: string;
  reasoningEffort: ReasoningEffort;
  providerOptions?: Record<string, Record<string, string | number | boolean>>;
}

export interface ResolveLanguageModelOptions {
  reasoningEffort?: ReasoningEffort;
}

/**
 * Resolves a concrete AI SDK LanguageModel at request time.
 * Never throws at module import or `next build` time when API keys are unset.
 */
export function resolveLanguageModel(
  requestedSelectionId?: string,
  env: Record<string, string | undefined> = process.env,
  options?: ResolveLanguageModelOptions,
): ResolvedLanguageModel {
  const reasoningEffort = normalizeReasoningEffort(options?.reasoningEffort);
  const config = getModelConfig(env);
  const effectiveSelection =
    requestedSelectionId && requestedSelectionId.trim().length > 0
      ? requestedSelectionId
      : findModelOption(config.selectionId)?.id ??
        MODELS.find((m) => m.provider === config.provider)?.id ??
        DEFAULT_MODEL;

  const option = findModelOption(effectiveSelection);
  if (!option) {
    throw new ProviderConfigError(
      "MODEL_NOT_ALLOWED",
      `El modelo "${effectiveSelection}" no está habilitado.`,
    );
  }

  const useEnvModelId =
    !requestedSelectionId &&
    option.provider === config.provider &&
    findModelOption(`${config.provider}:${config.modelId}`)?.modelId;
  const modelId = useEnvModelId || option.modelId;

  if (option.provider === "openrouter") {
    const apiKey = env.OPENROUTER_API_KEY?.trim();
    if (!apiKey) {
      throw new ProviderConfigError(
        "MISSING_API_KEY",
        "Falta OPENROUTER_API_KEY en el entorno para usar OpenRouter.",
      );
    }
    const openrouter = createOpenRouter({ apiKey });
    const settings: OpenRouterChatSettings = {
      reasoning:
        reasoningEffort === "none"
          ? { enabled: false, exclude: true, effort: "none" }
          : { enabled: true, effort: reasoningEffort },
      ...(modelId === "deepseek/deepseek-v4.1-flash-1017"
        ? { provider: { require_parameters: true } }
        : {}),
    };
    return {
      model: openrouter.chat(modelId, settings),
      provider: "openrouter",
      modelId,
      selectionId: option.id,
      reasoningEffort,
    };
  }

  if (option.provider === "groq") {
    const apiKey = env.GROQ_API_KEY?.trim();
    if (!apiKey) {
      throw new ProviderConfigError(
        "MISSING_API_KEY",
        "Falta GROQ_API_KEY en el entorno para usar Groq.",
      );
    }
    const groq = createGroq({ apiKey });
    // Separate Qwen reasoning tokens from narrative content & tool_calls
    const providerOptions = modelId.startsWith("qwen/")
      ? { groq: { reasoningFormat: "parsed" } }
      : undefined;
    return {
      model: groq(modelId),
      provider: "groq",
      modelId,
      selectionId: option.id,
      reasoningEffort,
      ...(providerOptions ? { providerOptions } : {}),
    };
  }

  const googleKey = env.GOOGLE_GENERATIVE_AI_API_KEY?.trim();
  if (!googleKey) {
    throw new ProviderConfigError(
      "MISSING_API_KEY",
      "Falta GOOGLE_GENERATIVE_AI_API_KEY en el entorno para usar Google directo.",
    );
  }
  const google = createGoogleGenerativeAI({ apiKey: googleKey });
  return {
    model: google(modelId),
    provider: "google",
    modelId,
    selectionId: option.id,
    reasoningEffort,
  };
}
