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
import { eventLog, providerHealth } from "@/lib/db/schema";
import {
  createRateLimiter,
  extractClientIp,
} from "@/lib/guardrails/rate-limit";
import { createSpendCapGuard } from "@/lib/guardrails/spend-cap";
import { serverErrorResponse } from "@/lib/http/errors";
import { DEFAULT_MODEL, isModelAllowed, MODELS } from "@/lib/models";

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
  it("defaults to OpenRouter free router and trims allowlist to the 3 curated free models", () => {
    expect(DEFAULT_MODEL).toBe("openrouter:openrouter/free");
    expect(MODELS.map((m) => m.id)).toEqual([
      "openrouter:openrouter/free",
      "groq:qwen/qwen3.8-27b",
      "groq:openai/gpt-oss-120b",
    ]);

    const cfg = getModelConfig({});
    expect(cfg.provider).toBe("openrouter");
    expect(cfg.modelId).toBe("openrouter/free");
    expect(cfg.selectionId).toBe("openrouter:openrouter/free");
    expect(cfg.mechanicsModel).toBe(cfg.modelId);
    expect(cfg.narrativeModel).toBe(cfg.modelId);

    const groqDefaultCfg = getModelConfig({ LLM_PROVIDER: "groq" });
    expect(groqDefaultCfg.provider).toBe("groq");
    expect(groqDefaultCfg.modelId).toBe("qwen/qwen3.8-27b");
    expect(groqDefaultCfg.selectionId).toBe("groq:qwen/qwen3.8-27b");

    const groqBackupCfg = getModelConfig({
      LLM_PROVIDER: "groq",
      LLM_MODEL: "openai/gpt-oss-120b",
    });
    expect(groqBackupCfg.modelId).toBe("openai/gpt-oss-120b");

    expect(() => getModelConfig({ LLM_PROVIDER: "unknown" })).toThrow(
      ProviderConfigError,
    );
  });

  it("wires curated OpenRouter & Groq models safely and configures parsed reasoning for Qwen", () => {
    // Discontinued and uncurated models must be rejected
    expect(isModelAllowed("openrouter:google/gemini-2.5-flash")).toBe(false);
    expect(isModelAllowed("google:gemini-2.5-flash")).toBe(false);
    expect(isModelAllowed("openrouter:anthropic/claude-sonnet-4.5")).toBe(false);
    expect(isModelAllowed("groq:llama-3.1-8b-instant")).toBe(false);
    expect(isModelAllowed("groq:llama-3.3-70b-versatile")).toBe(false);
    expect(() =>
      resolveLanguageModel("google:gemini-2.5-flash", {
        GOOGLE_GENERATIVE_AI_API_KEY: "test-key",
      }),
    ).toThrow(ProviderConfigError);

    // Curated free/tool-calling models are allowlisted
    expect(isModelAllowed("openrouter:openrouter/free")).toBe(true);
    expect(isModelAllowed("groq:qwen/qwen3.8-27b")).toBe(true);
    expect(isModelAllowed("groq:openai/gpt-oss-120b")).toBe(true);

    // Missing API keys throw ProviderConfigError at request time (not import time)
    expect(() =>
      resolveLanguageModel("openrouter:openrouter/free", {}),
    ).toThrow(ProviderConfigError);
    expect(() =>
      resolveLanguageModel("groq:qwen/qwen3.8-27b", {}),
    ).toThrow(ProviderConfigError);
    expect(() =>
      resolveLanguageModel("groq:openai/gpt-oss-120b", {}),
    ).toThrow(ProviderConfigError);

    // With API keys present, resolves concrete LanguageModel instances + providerOptions
    const openrouterResolved = resolveLanguageModel(
      "openrouter:openrouter/free",
      { OPENROUTER_API_KEY: "test-openrouter-key" },
    );
    expect(openrouterResolved.provider).toBe("openrouter");
    expect(openrouterResolved.modelId).toBe("openrouter/free");
    expect(openrouterResolved.model).toBeDefined();

    const qwenResolved = resolveLanguageModel("groq:qwen/qwen3.8-27b", {
      GROQ_API_KEY: "test-groq-key",
    });
    expect(qwenResolved.provider).toBe("groq");
    expect(qwenResolved.modelId).toBe("qwen/qwen3.8-27b");
    expect(qwenResolved.providerOptions).toEqual({
      groq: { reasoningFormat: "parsed" },
    });

    const gptOssResolved = resolveLanguageModel("groq:openai/gpt-oss-120b", {
      GROQ_API_KEY: "test-groq-key",
    });
    expect(gptOssResolved.provider).toBe("groq");
    expect(gptOssResolved.modelId).toBe("openai/gpt-oss-120b");
    expect(gptOssResolved.providerOptions).toBeUndefined();
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

  it("includes required provenance, rollback, and provider_health columns", () => {
    const eventCols = getTableColumns(eventLog);
    expect(eventCols).toHaveProperty("source");
    expect(eventCols).toHaveProperty("actor");
    expect(eventCols).toHaveProperty("checkId");
    expect(eventCols).toHaveProperty("declaredTotal");
    expect(eventCols).toHaveProperty("dieResults");
    expect(eventCols).toHaveProperty("stateDelta");
    expect(eventCols).toHaveProperty("revertedByEventId");

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
