import type { OpenRouterChatSettings } from "@openrouter/ai-sdk-provider";
import { getTableColumns } from "drizzle-orm";
import { describe, expect, it, vi } from "vitest";

import {
  getModelConfig,
  ProviderConfigError,
  resolveLanguageModel,
} from "@/lib/ai/provider";
import {
  createGuestSessionToken,
  GUEST_COOKIE_NAME,
  resolveGuestSessionFromRequest,
  verifyGuestSessionToken,
} from "@/lib/auth/guest-session";
import { eventLog, memoryFacts, providerHealth, rateLimitBuckets } from "@/lib/db/schema";
import {
  createRateLimiter,
  extractClientIp,
} from "@/lib/guardrails/rate-limit";
import { createSpendCapGuard } from "@/lib/guardrails/spend-cap";
import { serverErrorResponse } from "@/lib/http/errors";
import {
  DEFAULT_MODEL,
  GUEST_DEFAULT_MODEL,
  isModelAllowed,
  isModelAllowedForTier,
  MODELS,
  normalizeReasoningEffort,
} from "@/lib/models";

describe("guest session cookies", () => {
  it("creates, verifies, and rejects tampered guest tokens", () => {
    const env = { SESSION_SECRET: "test-secret-with-enough-entropy-1234" };
    const token = createGuestSessionToken(
      "11111111-1111-4111-8111-111111111111",
      env,
    );

    expect(verifyGuestSessionToken(token, env)).toBe(
      "11111111-1111-4111-8111-111111111111",
    );

    // Tampered signature or UUID must fail
    const tampered = `${token.slice(0, -2)}aa`;
    expect(verifyGuestSessionToken(tampered, env)).toBeNull();
    expect(verifyGuestSessionToken("not-a-uuid.abc", env)).toBeNull();
  });

  it("issues a signed HttpOnly cookie for anonymous requests without a cookie", () => {
    const env = { SESSION_SECRET: "test-secret-with-enough-entropy-1234" };
    const req = new Request("http://localhost:3000/api/chat", { method: "POST" });
    const first = resolveGuestSessionFromRequest(req, env);

    expect(first.isNew).toBe(true);
    expect(first.setCookieHeader).toContain(`${GUEST_COOKIE_NAME}=`);
    expect(first.setCookieHeader).toContain("HttpOnly");

    const reqWithCookie = new Request("http://localhost:3000/api/chat", {
      method: "POST",
      headers: {
        cookie: `${GUEST_COOKIE_NAME}=${encodeURIComponent(first.token)}`,
      },
    });
    const second = resolveGuestSessionFromRequest(reqWithCookie, env);

    expect(second.isNew).toBe(false);
    expect(second.guestId).toBe(first.guestId);
    expect(second.setCookieHeader).toBeNull();
  });
});

describe("rate limiter, IP extraction & daily spend cap guardrails", () => {
  it("extracts trusted proxy IP and avoids spoofed leftmost x-forwarded-for", () => {
    const reqCf = new Request("http://localhost:3000/api/chat", {
      headers: {
        "x-forwarded-for": "1.2.3.4, 5.6.7.8",
        "cf-connecting-ip": "9.9.9.9",
      },
    });
    expect(extractClientIp(reqCf)).toBe("9.9.9.9");

    const reqXff = new Request("http://localhost:3000/api/chat", {
      headers: {
        "x-forwarded-for": "spoofed.1.1.1, 203.0.113.42",
      },
    });
    expect(extractClientIp(reqXff)).toBe("203.0.113.42");
  });

  it("allows requests up to the guest RPM limit and blocks excess with retryAfterSec", () => {
    const limiter = createRateLimiter({
      windowMs: 60_000,
      maxRequestsPerGuest: 2,
      maxRequestsPerIp: 10,
    });

    const t0 = 1_700_000_000_000;
    expect(limiter.check("g1", "127.0.0.1", t0).allowed).toBe(true);
    expect(limiter.check("g1", "127.0.0.1", t0 + 1_000).allowed).toBe(true);

    const blocked = limiter.check("g1", "127.0.0.1", t0 + 2_000);
    expect(blocked.allowed).toBe(false);
    expect(blocked.retryAfterSec).toBeGreaterThan(0);

    // Window slides after 60s
    expect(limiter.check("g1", "127.0.0.1", t0 + 61_000).allowed).toBe(true);
  });

  it("enforces daily request, token, and USD spend caps", () => {
    const reqGuard = createSpendCapGuard({
      dailyRequestCapPerGuest: 2,
      dailyTokenCapPerGuest: 100_000,
      dailySpendCapUsd: 5,
      maxAgentSteps: 5,
      maxOutputTokens: 2048,
      estimatedCostPer1MTokensUsd: 1,
    });

    const now = Date.UTC(2026, 10, 18, 12, 0, 0);
    reqGuard.recordUsage("g1", { requests: 2, totalTokens: 500 }, now);
    expect(reqGuard.checkLimit("g1", now).allowed).toBe(false);

    const tokGuard = createSpendCapGuard({
      dailyRequestCapPerGuest: 100,
      dailyTokenCapPerGuest: 1_000,
      dailySpendCapUsd: 5,
      maxAgentSteps: 5,
      maxOutputTokens: 2048,
      estimatedCostPer1MTokensUsd: 1,
    });
    tokGuard.recordUsage("g2", { requests: 1, totalTokens: 1_000 }, now);
    expect(tokGuard.checkLimit("g2", now).allowed).toBe(false);

    const usdGuard = createSpendCapGuard({
      dailyRequestCapPerGuest: 100,
      dailyTokenCapPerGuest: 10_000_000,
      dailySpendCapUsd: 0.5,
      maxAgentSteps: 5,
      maxOutputTokens: 2048,
      estimatedCostPer1MTokensUsd: 1,
    });
    usdGuard.recordUsage("g3", { requests: 1, totalTokens: 600_000 }, now);
    expect(usdGuard.checkLimit("g3", now).allowed).toBe(false);
  });
});

describe("provider config, error sanitization & Drizzle schema", () => {
  it("defaults to DeepSeek V4.1 Flash and exposes curated OpenRouter-only catalog without Groq chat models", () => {
    expect(DEFAULT_MODEL).toBe("openrouter:deepseek/deepseek-v4.1-flash-1017");
    expect(GUEST_DEFAULT_MODEL).toBe("openrouter:openrouter/free");
    expect(MODELS.map((m) => m.id)).toEqual([
      "openrouter:deepseek/deepseek-v4.1-flash-1017",
      "openrouter:openrouter/free",
    ]);
    expect(MODELS.map((m) => m.name)).toEqual(["Main", "Free"]);
    expect(MODELS.some((m) => m.provider === "groq")).toBe(false);

    const cfg = getModelConfig({});
    expect(cfg.provider).toBe("openrouter");
    expect(cfg.modelId).toBe("deepseek/deepseek-v4.1-flash-1017");
    expect(cfg.selectionId).toBe("openrouter:deepseek/deepseek-v4.1-flash-1017");
    expect(cfg.mechanicsModel).toBe(cfg.modelId);
    expect(cfg.narrativeModel).toBe(cfg.modelId);

    expect(() => getModelConfig({ LLM_PROVIDER: "unknown" })).toThrow(
      ProviderConfigError,
    );
  });

  it("enforces model allowlist by tier and normalizes reasoning effort", () => {
    // Discontinued and Groq chat models must be rejected
    expect(isModelAllowed("openrouter:google/gemini-2.5-flash")).toBe(false);
    expect(isModelAllowed("google:gemini-2.5-flash")).toBe(false);
    expect(isModelAllowed("openrouter:anthropic/claude-sonnet-4.5")).toBe(false);
    expect(isModelAllowed("groq:qwen/qwen3.8-27b")).toBe(false);
    expect(isModelAllowed("groq:openai/gpt-oss-120b")).toBe(false);
    expect(isModelAllowed("groq:llama-3.1-8b-instant")).toBe(false);
    expect(isModelAllowed("groq:llama-3.3-70b-versatile")).toBe(false);

    // Curated OpenRouter models are allowlisted
    expect(
      isModelAllowed("openrouter:deepseek/deepseek-v4.1-flash-1017"),
    ).toBe(true);
    expect(isModelAllowed("openrouter:openrouter/free")).toBe(true);

    // Tier-based model gating
    expect(
      isModelAllowedForTier(
        "openrouter:deepseek/deepseek-v4.1-flash-1017",
        "guest",
      ),
    ).toBe(false);
    expect(
      isModelAllowedForTier(
        "openrouter:deepseek/deepseek-v4.1-flash-1017",
        "whitelisted",
      ),
    ).toBe(true);
    expect(
      isModelAllowedForTier("openrouter:openrouter/free", "guest"),
    ).toBe(true);
    expect(
      isModelAllowedForTier("openrouter:openrouter/free", "whitelisted"),
    ).toBe(true);
    expect(
      isModelAllowedForTier("openrouter:non-existent", "whitelisted"),
    ).toBe(false);

    // Reasoning effort normalization
    expect(normalizeReasoningEffort(undefined)).toBe("none");
    expect(normalizeReasoningEffort(null)).toBe("none");
    expect(normalizeReasoningEffort("invalid")).toBe("none");
    expect(normalizeReasoningEffort("none")).toBe("none");
    expect(normalizeReasoningEffort("low")).toBe("low");
    expect(normalizeReasoningEffort(" MEDIUM ")).toBe("medium");
    expect(normalizeReasoningEffort("HIGH")).toBe("high");
  });

  it("wires OpenRouter models with require_parameters and reasoningEffort settings", () => {
    expect(() =>
      resolveLanguageModel("groq:qwen/qwen3.8-27b", {
        GROQ_API_KEY: "test-key",
      }),
    ).toThrow(ProviderConfigError);

    expect(() =>
      resolveLanguageModel("openrouter:deepseek/deepseek-v4.1-flash-1017", {}),
    ).toThrow(ProviderConfigError);
    expect(() =>
      resolveLanguageModel("openrouter:openrouter/free", {}),
    ).toThrow(ProviderConfigError);

    const env = { OPENROUTER_API_KEY: "test-openrouter-key" };

    // Default DeepSeek V4.1 Flash with reasoning off ("none")
    const deepseekNone = resolveLanguageModel(
      "openrouter:deepseek/deepseek-v4.1-flash-1017",
      env,
    );
    expect(deepseekNone.provider).toBe("openrouter");
    expect(deepseekNone.modelId).toBe("deepseek/deepseek-v4.1-flash-1017");
    expect(deepseekNone.reasoningEffort).toBe("none");
    const deepseekNoneSettings = (
      deepseekNone.model as { settings?: OpenRouterChatSettings }
    ).settings;
    expect(deepseekNoneSettings?.provider).toEqual({
      require_parameters: true,
    });
    expect(deepseekNoneSettings?.reasoning).toEqual({
      enabled: false,
      exclude: true,
      effort: "none",
    });

    // DeepSeek V4.1 Flash with reasoning high
    const deepseekHigh = resolveLanguageModel(
      "openrouter:deepseek/deepseek-v4.1-flash-1017",
      env,
      { reasoningEffort: "high" },
    );
    expect(deepseekHigh.reasoningEffort).toBe("high");
    const deepseekHighSettings = (
      deepseekHigh.model as { settings?: OpenRouterChatSettings }
    ).settings;
    expect(deepseekHighSettings?.provider).toEqual({
      require_parameters: true,
    });
    expect(deepseekHighSettings?.reasoning).toEqual({
      enabled: true,
      effort: "high",
    });

    // OpenRouter Free Router with reasoning none omits reasoning override to avoid 400 on reasoning-only endpoints
    const freeNone = resolveLanguageModel("openrouter:openrouter/free", env, {
      reasoningEffort: "none",
    });
    const freeNoneSettings = (
      freeNone.model as { settings?: OpenRouterChatSettings }
    ).settings;
    expect(freeNoneSettings?.reasoning).toBeUndefined();
    expect(freeNoneSettings?.usage).toEqual({ include: true });

    // OpenRouter Free Router with reasoning medium (no require_parameters)
    const freeMedium = resolveLanguageModel("openrouter:openrouter/free", env, {
      reasoningEffort: "medium",
    });
    expect(freeMedium.provider).toBe("openrouter");
    expect(freeMedium.modelId).toBe("openrouter/free");
    expect(freeMedium.reasoningEffort).toBe("medium");
    const freeMediumSettings = (
      freeMedium.model as { settings?: OpenRouterChatSettings }
    ).settings;
    expect(freeMediumSettings?.provider).toBeUndefined();
    expect(freeMediumSettings?.reasoning).toEqual({
      enabled: true,
      effort: "medium",
    });
  });

  it("never leaks internal err.message to clients via serverErrorResponse (P1.2)", async () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      const res = serverErrorResponse({
        route: "/api/test",
        err: new Error("postgres://user:supersecret@db.internal:5432/prod"),
        publicMessageEs: "Error interno al procesar la solicitud.",
      });
      expect(res.status).toBe(500);
      const body = (await res.json()) as Record<string, unknown>;
      expect(body.error).toBe("Error interno al procesar la solicitud.");
      expect(body.correlationId).toBeTruthy();
      expect(JSON.stringify(body)).not.toContain("supersecret");
      expect(JSON.stringify(body)).not.toContain("postgres://");
    } finally {
      spy.mockRestore();
    }
  });

  it("includes required provenance, rollback, memory_facts, rate_limit_buckets, and provider_health columns", () => {
    const eventCols = getTableColumns(eventLog);
    expect(eventCols).toHaveProperty("source");
    expect(eventCols).toHaveProperty("actor");
    expect(eventCols).toHaveProperty("checkId");
    expect(eventCols).toHaveProperty("declaredTotal");
    expect(eventCols).toHaveProperty("dieResults");
    expect(eventCols).toHaveProperty("stateDelta");
    expect(eventCols).toHaveProperty("revertedByEventId");

    const memCols = getTableColumns(memoryFacts);
    expect(memCols).toHaveProperty("eventSeq");
    expect(memCols).toHaveProperty("revertedBySeq");
    expect(memCols).toHaveProperty("source");

    const rlCols = getTableColumns(rateLimitBuckets);
    expect(rlCols).toHaveProperty("bucketKey");
    expect(rlCols).toHaveProperty("windowStart");
    expect(rlCols).toHaveProperty("requestCount");

    const healthCols = getTableColumns(providerHealth);
    expect(healthCols).toHaveProperty("provider");
    expect(healthCols).toHaveProperty("modelId");
    expect(healthCols).toHaveProperty("dayKey");
    expect(healthCols).toHaveProperty("requestCount");
    expect(healthCols).toHaveProperty("errorCount");
    expect(healthCols).toHaveProperty("totalLatencyMs");
    expect(healthCols).toHaveProperty("lastErrorCode");
  });
});
