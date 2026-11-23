import type { LanguageModelUsage } from "ai";

export interface ExtractedUsageTelemetry {
  promptTokens: number;
  completionTokens: number;
  cachedTokens: number;
  totalTokens: number;
  cacheHitRate: number;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function readPositiveInt(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) && value > 0
    ? Math.round(value)
    : 0;
}

/**
 * Extracts prompt, completion, and cached input tokens from AI SDK v7
 * `LanguageModelUsage` (supporting both standard `inputTokenDetails.cacheReadTokens`
 * and OpenRouter/OpenAI raw `prompt_tokens_details.cached_tokens` payloads).
 */
export function extractUsageTelemetry(
  usage?: Partial<LanguageModelUsage> | null,
): ExtractedUsageTelemetry {
  if (!usage) {
    return {
      promptTokens: 0,
      completionTokens: 0,
      cachedTokens: 0,
      totalTokens: 0,
      cacheHitRate: 0,
    };
  }

  const promptTokens = readPositiveInt(usage.inputTokens);
  const completionTokens = readPositiveInt(usage.outputTokens);

  let cachedTokens = readPositiveInt(usage.inputTokenDetails?.cacheReadTokens);

  if (cachedTokens === 0) {
    const raw = asRecord(usage.raw);
    const promptDetails = asRecord(raw?.prompt_tokens_details);
    const inputDetails = asRecord(raw?.input_tokens_details);
    cachedTokens =
      readPositiveInt(promptDetails?.cached_tokens) ||
      readPositiveInt(inputDetails?.cached_tokens) ||
      readPositiveInt(raw?.cached_tokens) ||
      readPositiveInt(
        (usage as Record<string, unknown>).cachedInputTokens,
      );
  }

  // Guard against providers reporting cachedTokens slightly above inputTokens
  if (promptTokens > 0 && cachedTokens > promptTokens) {
    cachedTokens = promptTokens;
  }

  const totalTokens =
    readPositiveInt(usage.totalTokens) || promptTokens + completionTokens;
  const cacheHitRate =
    promptTokens > 0
      ? Math.round((cachedTokens / promptTokens) * 1000) / 1000
      : 0;

  return {
    promptTokens,
    completionTokens,
    cachedTokens,
    totalTokens,
    cacheHitRate,
  };
}

/**
 * Extracts turn-level telemetry across multi-step tool turns, falling back to
 * summing per-step cached tokens if the provider only surfaces cache details in
 * each step's `raw` payload.
 */
export function extractTurnUsageTelemetry(
  totalUsage?: Partial<LanguageModelUsage> | null,
  stepUsages?: readonly (Partial<LanguageModelUsage> | undefined)[],
): ExtractedUsageTelemetry {
  const base = extractUsageTelemetry(totalUsage);
  if (base.cachedTokens > 0 || !stepUsages || stepUsages.length === 0) {
    return base;
  }

  let summedCached = 0;
  for (const stepUsage of stepUsages) {
    summedCached += extractUsageTelemetry(stepUsage).cachedTokens;
  }
  if (summedCached === 0) {
    return base;
  }

  const cachedTokens =
    base.promptTokens > 0
      ? Math.min(summedCached, base.promptTokens)
      : summedCached;
  const cacheHitRate =
    base.promptTokens > 0
      ? Math.round((cachedTokens / base.promptTokens) * 1000) / 1000
      : 0;

  return {
    ...base,
    cachedTokens,
    cacheHitRate,
  };
}
