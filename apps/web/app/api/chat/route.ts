import { randomUUID } from "node:crypto";
import { createRng } from "@dungeons/rules";
import {
  convertToModelMessages,
  createUIMessageStreamResponse,
  isStepCount,
  streamText,
  toUIMessageStream,
  validateUIMessages,
} from "ai";

import {
  buildDmSystemPrompt,
  createDmTools,
  type DmChatUIMessage,
  type DmToolRuntime,
} from "@/agent/agent";
import { extractDeterministicFactsFromEvent } from "@/agent/subagents/memory/agent";
import { compactConversationContext } from "@/lib/ai/context-window";
import {
  detectPromptInjectionSignals,
  wrapUserMessagesForModel,
} from "@/lib/ai/prompt-safety";
import {
  ProviderConfigError,
  resolveLanguageModel,
} from "@/lib/ai/provider";
import { pruneHistoricalToolOutputs } from "@/lib/ai/prune-tool-history";
import { resolveGuestSessionFromRequest } from "@/lib/auth/guest-session";
import { resolveRequestAccess } from "@/lib/auth/whitelist";
import { commitEventWithRetry, performRollback } from "@/lib/game/operations";
import { getDefaultGameStore } from "@/lib/game/store";
import {
  checkRateLimitPersistent,
  extractClientIp,
} from "@/lib/guardrails/rate-limit";
import {
  chatSpendCap,
  checkSpendCapPersistent,
  recordSpendUsagePersistent,
} from "@/lib/guardrails/spend-cap";
import { createCorrelationId, serverErrorResponse } from "@/lib/http/errors";
import {
  DEFAULT_MODEL,
  GUEST_DEFAULT_MODEL,
  isModelAllowed,
  isModelAllowedForTier,
  normalizeReasoningEffort,
} from "@/lib/models";
import {
  hashGuestId,
  logServerEvent,
  recordModelUsage,
  recordProviderHealth,
} from "@/lib/observability/logger";
import {
  extractTurnUsageTelemetry,
  extractUsageTelemetry,
} from "@/lib/observability/usage";

export const runtime = "nodejs";
export const maxDuration = 60;

function jsonWithGuestCookie(
  body: Record<string, unknown>,
  status: number,
  setCookieHeader: string | null,
  extraHeaders?: Record<string, string>,
): Response {
  const headers = new Headers(extraHeaders);
  if (setCookieHeader) {
    headers.set("Set-Cookie", setCookieHeader);
  }
  return Response.json(body, { status, headers });
}

export async function POST(req: Request) {
  const requestId = createCorrelationId();
  const startedAt = Date.now();

  let guest;
  try {
    guest = resolveGuestSessionFromRequest(req);
  } catch (err) {
    return serverErrorResponse({
      route: "/api/chat",
      err,
      publicMessageEs: "Error interno al verificar la sesión.",
      status: 500,
      errorCode: "SESSION_ERROR",
      correlationId: requestId,
    });
  }

  const guestIdHash = hashGuestId(guest.guestId);
  const clientIp = extractClientIp(req);

  let access;
  try {
    access = await resolveRequestAccess(req);
  } catch (err) {
    return serverErrorResponse({
      route: "/api/chat",
      err,
      publicMessageEs: "Error interno al verificar permisos de acceso.",
      status: 500,
      errorCode: "ACCESS_CHECK_ERROR",
      setCookieHeader: guest.setCookieHeader,
      correlationId: requestId,
      guestIdHash,
    });
  }

  let rateCheck;
  try {
    rateCheck = await checkRateLimitPersistent(guest.guestId, clientIp);
  } catch (err) {
    return serverErrorResponse({
      route: "/api/chat",
      err,
      publicMessageEs: "Error interno al verificar límite de frecuencia.",
      status: 500,
      errorCode: "RATE_LIMIT_ERROR",
      setCookieHeader: guest.setCookieHeader,
      correlationId: requestId,
      guestIdHash,
    });
  }
  if (!rateCheck.allowed) {
    logServerEvent({
      level: "warn",
      requestId,
      route: "/api/chat",
      event: "rate_limited",
      status: 429,
      errorCode: "RATE_LIMITED",
      guestIdHash,
    });
    return jsonWithGuestCookie(
      {
        error: `Demasiadas solicitudes. Esperá ${rateCheck.retryAfterSec} segundos antes de volver a intentar.`,
        code: "RATE_LIMITED",
      },
      429,
      guest.setCookieHeader,
      { "Retry-After": String(rateCheck.retryAfterSec) },
    );
  }

  // El límite diario de invitado aplica únicamente a visitantes sin whitelist.
  if (access.tier !== "whitelisted") {
    let capCheck;
    try {
      capCheck = await checkSpendCapPersistent(guest.guestId);
    } catch (err) {
      return serverErrorResponse({
        route: "/api/chat",
        err,
        publicMessageEs: "Error interno al validar el cupo de uso.",
        status: 500,
        errorCode: "USAGE_CHECK_ERROR",
        setCookieHeader: guest.setCookieHeader,
        correlationId: requestId,
        guestIdHash,
      });
    }

    if (!capCheck.allowed) {
      logServerEvent({
        level: "warn",
        requestId,
        route: "/api/chat",
        event: "spend_cap_reached",
        status: 429,
        errorCode: "SPEND_CAP_REACHED",
        guestIdHash,
      });
      return jsonWithGuestCookie(
        {
          error:
            capCheck.reasonEs ??
            "Alcanzaste el límite diario de uso para esta sesión.",
          code: "SPEND_CAP_REACHED",
        },
        429,
        guest.setCookieHeader,
      );
    }
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return jsonWithGuestCookie(
      { error: "Cuerpo JSON inválido.", code: "INVALID_JSON" },
      400,
      guest.setCookieHeader,
    );
  }

  const bodyRecord =
    body && typeof body === "object" && !Array.isArray(body)
      ? (body as Record<string, unknown>)
      : {};
  const rawModel = bodyRecord.model;
  const rawReasoningEffort = bodyRecord.reasoningEffort;
  const reasoningEffort = normalizeReasoningEffort(rawReasoningEffort);
  const defaultModel =
    access.tier === "whitelisted" ? DEFAULT_MODEL : GUEST_DEFAULT_MODEL;
  const requestedModelId =
    typeof rawModel === "string" && rawModel.trim().length > 0
      ? rawModel.trim()
      : defaultModel;

  if (!isModelAllowed(requestedModelId)) {
    return jsonWithGuestCookie(
      {
        error: `El modelo "${requestedModelId}" no está disponible.`,
        code: "MODEL_NOT_ALLOWED",
      },
      400,
      guest.setCookieHeader,
    );
  }

  if (!isModelAllowedForTier(requestedModelId, access.tier)) {
    logServerEvent({
      level: "warn",
      requestId,
      route: "/api/chat",
      event: "model_whitelist_required",
      modelId: requestedModelId,
      status: 403,
      errorCode: "AUTH_WHITELIST_REQUIRED",
      guestIdHash,
    });
    return jsonWithGuestCookie(
      {
        error:
          "Iniciá sesión con una cuenta autorizada (whitelist) para usar el modelo Main.",
        code: "AUTH_WHITELIST_REQUIRED",
      },
      403,
      guest.setCookieHeader,
    );
  }

  let resolved;
  try {
    resolved = resolveLanguageModel(requestedModelId, process.env, {
      reasoningEffort,
    });
  } catch (err) {
    if (err instanceof ProviderConfigError) {
      const status =
        err.code === "MISSING_API_KEY" || err.code === "PROVIDER_UNAVAILABLE"
          ? 503
          : 400;
      const [providerPart = "unknown", modelPart = requestedModelId] =
        requestedModelId.split(":");
      logServerEvent({
        level: "warn",
        requestId,
        route: "/api/chat",
        event: "provider_config_error",
        provider: providerPart,
        modelId: modelPart,
        status,
        errorCode: err.code,
        latencyMs: Date.now() - startedAt,
        guestIdHash,
      });
      void recordProviderHealth({
        provider: providerPart,
        modelId: modelPart,
        ok: false,
        latencyMs: Date.now() - startedAt,
        errorCode: err.code,
      });
      return jsonWithGuestCookie(
        { error: err.message, code: err.code },
        status,
        guest.setCookieHeader,
      );
    }
    return serverErrorResponse({
      route: "/api/chat",
      err,
      publicMessageEs: "Error interno al preparar el proveedor de IA.",
      status: 500,
      errorCode: "PROVIDER_INIT_ERROR",
      setCookieHeader: guest.setCookieHeader,
      correlationId: requestId,
      guestIdHash,
    });
  }

  let store;
  let loaded;
  try {
    store = getDefaultGameStore();
    const requestedCampaignId = (body as { campaignId?: unknown })?.campaignId;
    loaded =
      typeof requestedCampaignId === "string"
        ? await store.loadCampaign(requestedCampaignId, guest.guestId)
        : await store.getLatestCampaignForGuest(guest.guestId);

    if (!loaded) {
      loaded = await store.createCampaign({
        guestId: guest.guestId,
        presetId: "pc_kael",
        mode: "digital",
        ruleset: "5e-full",
      });
    }
  } catch (err) {
    return serverErrorResponse({
      route: "/api/chat",
      err,
      publicMessageEs: "Error interno al cargar el estado de la campaña.",
      status: 500,
      errorCode: "STORE_ERROR",
      setCookieHeader: guest.setCookieHeader,
      correlationId: requestId,
      guestIdHash,
    });
  }

  let currentState = loaded.state;
  let currentEvents = loaded.events;
  let currentLogHeadSeq = loaded.logHeadSeq;
  let currentMemoryFacts = loaded.memoryFacts;
  const campaignId = loaded.campaignId;
  const sessionId = loaded.sessionId;

  const toolRuntime: DmToolRuntime = {
    campaignId,
    sessionId,
    guestId: guest.guestId,
    getState: () => currentState,
    getInitialState: () => loaded.initialState,
    getEvents: () => currentEvents,
    getLogHeadSeq: () => currentLogHeadSeq,
    commitEvent: async (event, nextState, expectedSeq) => {
      const outcome = await commitEventWithRetry({
        store,
        campaignId,
        sessionId,
        guestId: guest.guestId,
        event,
        nextState,
        expectedSeq: expectedSeq ?? currentLogHeadSeq,
      });
      if (outcome.reloaded) {
        currentState = outcome.state;
        currentEvents = outcome.events;
        currentLogHeadSeq = outcome.logHeadSeq;
      } else {
        currentState = nextState;
        currentEvents = [...currentEvents, event];
        currentLogHeadSeq = outcome.logHeadSeq;
      }

      const derived = extractDeterministicFactsFromEvent(event, currentState);
      if (derived.length > 0) {
        try {
          const saved = await store.saveMemoryFacts(
            campaignId,
            sessionId,
            derived,
          );
          if (saved.length > 0) {
            currentMemoryFacts = [...saved, ...currentMemoryFacts];
          }
        } catch {
          // Non-fatal memory extraction
        }
      }
    },
    commitRollback: async (targetSeq, reason) => {
      const rb = await performRollback({
        campaignId,
        guestId: guest.guestId,
        targetSeq,
        reason,
        store,
      });
      if (rb.ok) {
        currentState = rb.state;
        currentEvents = rb.events;
        currentLogHeadSeq = rb.logHeadSeq;
        currentMemoryFacts = rb.memoryFacts;
      }
      return rb;
    },
    saveMemoryFact: async (fact) => {
      try {
        const saved = await store.saveMemoryFacts(campaignId, sessionId, [
          { ...fact, source: "dm-memory" },
        ]);
        if (saved.length > 0) {
          currentMemoryFacts = [...saved, ...currentMemoryFacts];
        }
      } catch {
        // Non-fatal memory write
      }
    },
    rng: createRng(randomUUID()),
    createId: () => randomUUID(),
    now: () => new Date().toISOString(),
  };

  const tools = createDmTools(toolRuntime);

  let messages: DmChatUIMessage[];
  try {
    messages = await validateUIMessages<DmChatUIMessage>({
      messages: (body as { messages?: unknown })?.messages,
      tools: tools as Parameters<typeof validateUIMessages>[0]["tools"],
    });
  } catch {
    return jsonWithGuestCookie(
      { error: "Formato de mensajes inválido.", code: "INVALID_MESSAGES" },
      400,
      guest.setCookieHeader,
    );
  }

  const lastIncoming = messages.at(-1);
  if (lastIncoming?.role === "user") {
    const rawUserText = lastIncoming.parts
      .filter(
        (p): p is Extract<typeof p, { type: "text" }> => p.type === "text",
      )
      .map((p) => p.text)
      .join("\n");
    const injectionCheck = detectPromptInjectionSignals(rawUserText);
    if (injectionCheck.flagged) {
      logServerEvent({
        level: "warn",
        requestId,
        route: "/api/chat",
        event: "prompt_injection_signal",
        guestIdHash,
        detail: injectionCheck.matchedPatterns.join(","),
      });
    }

    try {
      await store.saveMessages(
        campaignId,
        sessionId,
        [{ role: "user", parts: lastIncoming.parts }],
        currentState.lastSeq,
      );
    } catch {
      // Do not fail turn if message history logging hiccups
    }
  }

  if (access.tier !== "whitelisted") {
    try {
      await recordSpendUsagePersistent(guest.guestId, {
        requests: 1,
        totalTokens: 0,
      });
    } catch {
      // Non-fatal usage counter hiccup; do not abort turn
    }
  }

  const compacted = compactConversationContext({ messages });
  const systemPrompt = buildDmSystemPrompt(currentState, currentEvents, {
    sessionNumber: loaded.sessionNumber,
    worldSummary: loaded.worldSummary,
    sessionSummaries: loaded.sessionSummaries,
    memoryFacts: currentMemoryFacts,
    olderTurnsDigest: compacted.olderTurnsDigest,
  });
  const prunedRecentMessages = pruneHistoricalToolOutputs(
    compacted.recentMessages,
  );
  const modelMessages = wrapUserMessagesForModel(
    await convertToModelMessages(prunedRecentMessages),
  );

  const result = streamText({
    model: resolved.model,
    system: systemPrompt,
    messages: modelMessages,
    tools,
    ...(resolved.providerOptions
      ? { providerOptions: resolved.providerOptions }
      : {}),
    stopWhen: [
      isStepCount(chatSpendCap.config.maxAgentSteps),
      ({ steps }) => {
        const last = steps.at(-1);
        return Boolean(
          last &&
            last.text.trim().length > 0 &&
            last.toolCalls.some((tc) => tc.toolName === "suggest_actions"),
        );
      },
    ],
    maxOutputTokens: chatSpendCap.config.maxOutputTokens,
    abortSignal: req.signal,
    onFinish: ({ totalUsage, steps }) => {
      const usageStats = extractTurnUsageTelemetry(
        totalUsage,
        steps.map((step) => step.usage),
      );
      const {
        promptTokens,
        completionTokens,
        cachedTokens,
        totalTokens,
        cacheHitRate,
      } = usageStats;
      const toolCalls = steps.flatMap((step) =>
        step.toolCalls.map((tc) => tc.toolName),
      );
      const latencyMs = Date.now() - startedAt;

      if (access.tier !== "whitelisted") {
        void recordSpendUsagePersistent(guest.guestId, {
          requests: 0,
          totalTokens,
        });
      }
      void recordModelUsage({
        guestId: guest.guestId,
        userId: access.userId,
        accessTier: access.tier,
        provider: resolved.provider,
        modelId: resolved.modelId,
        promptTokens,
        completionTokens,
        cachedTokens,
      });
      void recordProviderHealth({
        provider: resolved.provider,
        modelId: resolved.modelId,
        ok: true,
        latencyMs,
        promptTokens,
        completionTokens,
        cachedTokens,
      });
      logServerEvent({
        level: "info",
        requestId,
        route: "/api/chat",
        event: "chat_completed",
        provider: resolved.provider,
        modelId: resolved.modelId,
        accessTier: access.tier,
        status: 200,
        promptTokens,
        completionTokens,
        cachedTokens,
        cacheHitRate,
        toolCalls,
        lastSeq: currentState.lastSeq,
        latencyMs,
        guestIdHash,
      });
    },
  });

  const lastMessage = messages.at(-1);
  let reasoningCount =
    lastMessage?.role === "assistant"
      ? lastMessage.parts.filter((part) => part.type === "reasoning").length
      : 0;
  const reasoningStarts = new Map<string, { index: number; time: number }>();
  let lastStepInputTokens = 0;
  let stepCachedTokens = 0;
  const systemPromptTokensEst = Math.ceil(systemPrompt.length / 4);
  const fallbackContextTokensEst = Math.ceil(
    (systemPrompt.length + compacted.estimatedRecentChars) / 4,
  );

  const headers = new Headers();
  if (guest.setCookieHeader) {
    headers.set("Set-Cookie", guest.setCookieHeader);
  }

  return createUIMessageStreamResponse({
    headers,
    stream: toUIMessageStream({
      stream: result.stream,
      originalMessages: messages,
      sendSources: true,
      messageMetadata: ({ part }) => {
        if (part.type === "reasoning-start") {
          reasoningStarts.set(part.id, {
            index: reasoningCount++,
            time: Date.now(),
          });
        }

        if (part.type === "reasoning-end") {
          const start = reasoningStarts.get(part.id);
          if (start) {
            return {
              reasoningDurations: { [start.index]: Date.now() - start.time },
            };
          }
          return undefined;
        }

        if (part.type === "finish-step") {
          const stepStats = extractUsageTelemetry(part.usage);
          if (stepStats.promptTokens > 0) {
            lastStepInputTokens = stepStats.promptTokens;
          }
          if (stepStats.cachedTokens > 0) {
            stepCachedTokens += stepStats.cachedTokens;
          }
          return undefined;
        }

        if (part.type === "finish") {
          const finishUsage = extractUsageTelemetry(part.totalUsage);
          const totalInput = finishUsage.promptTokens;
          const outputTokens = finishUsage.completionTokens;
          const cachedTokens =
            finishUsage.cachedTokens > 0
              ? finishUsage.cachedTokens
              : totalInput > 0
                ? Math.min(stepCachedTokens, totalInput)
                : stepCachedTokens;
          const cacheHitRate =
            totalInput > 0
              ? Math.round((cachedTokens / totalInput) * 1000) / 1000
              : 0;
          const reportedContext =
            lastStepInputTokens > 0 ? lastStepInputTokens : totalInput;
          const isExact = reportedContext > 0;
          const contextTokens = isExact
            ? reportedContext
            : fallbackContextTokensEst;
          const totalTurnTokens =
            finishUsage.totalTokens > 0
              ? finishUsage.totalTokens
              : contextTokens + outputTokens;

          return {
            contextUsage: {
              contextTokens,
              outputTokens,
              totalTurnTokens,
              cachedTokens,
              cacheHitRate,
              windowMessages: compacted.recentMessages.length,
              maxWindowMessages: compacted.maxRecentMessages,
              trimmedMessages: compacted.trimmedCount,
              systemPromptTokensEst,
              isExact,
            },
          };
        }

        return undefined;
      },
      onFinish: async ({ messages: finalMessages, isAborted }) => {
        if (isAborted) return;
        const assistantMsg = finalMessages.at(-1);
        if (assistantMsg && assistantMsg.role === "assistant") {
          try {
            await store.saveMessages(
              campaignId,
              sessionId,
              [{ role: "assistant", parts: assistantMsg.parts }],
              currentState.lastSeq,
            );
          } catch {
            // Non-fatal
          }
        }
      },
      onError: (err) => {
        const latencyMs = Date.now() - startedAt;
        const detail =
          err instanceof Error ? `${err.name}: ${err.message}` : String(err);
        logServerEvent({
          level: "error",
          requestId,
          route: "/api/chat",
          event: "chat_stream_error",
          provider: resolved.provider,
          modelId: resolved.modelId,
          errorCode: "PROVIDER_UNAVAILABLE",
          lastSeq: currentState.lastSeq,
          latencyMs,
          guestIdHash,
          detail,
        });
        void recordProviderHealth({
          provider: resolved.provider,
          modelId: resolved.modelId,
          ok: false,
          latencyMs,
          errorCode: "PROVIDER_UNAVAILABLE",
        });
        return "El proveedor de IA no pudo completar la respuesta. Intentá de nuevo o cambiá de modelo.";
      },
    }),
  });
}
