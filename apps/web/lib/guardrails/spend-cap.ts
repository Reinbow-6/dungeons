import { and, eq, sql } from "drizzle-orm";

import { getDb, isDbConfigured } from "@/lib/db/client";
import { guestUsage } from "@/lib/db/schema";

export interface SpendCapConfig {
  dailyRequestCapPerGuest: number;
  dailyTokenCapPerGuest: number;
  dailySpendCapUsd: number;
  maxAgentSteps: number;
  maxOutputTokens: number;
  estimatedCostPer1MTokensUsd: number;
}

export interface UsageEntry {
  dayKey: string;
  requests: number;
  tokens: number;
  costUsd: number;
}

export interface SpendCapCheckResult {
  allowed: boolean;
  reasonEs?: string;
  usage: UsageEntry;
}

function parsePositiveInt(raw: string | undefined, fallback: number): number {
  const n = raw ? Number.parseInt(raw, 10) : Number.NaN;
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

function parsePositiveFloat(raw: string | undefined, fallback: number): number {
  const n = raw ? Number.parseFloat(raw) : Number.NaN;
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

export function getSpendCapConfigFromEnv(
  env: Record<string, string | undefined> = process.env,
): SpendCapConfig {
  return {
    dailyRequestCapPerGuest: parsePositiveInt(
      env.DAILY_REQUEST_CAP_PER_GUEST,
      100,
    ),
    dailyTokenCapPerGuest: parsePositiveInt(
      env.DAILY_TOKEN_CAP_PER_GUEST,
      200_000,
    ),
    dailySpendCapUsd: parsePositiveFloat(env.DAILY_SPEND_CAP_USD, 1.0),
    maxAgentSteps: parsePositiveInt(env.MAX_AGENT_STEPS, 5),
    maxOutputTokens: parsePositiveInt(env.MAX_OUTPUT_TOKENS, 2048),
    estimatedCostPer1MTokensUsd: parsePositiveFloat(
      env.ESTIMATED_COST_PER_1M_TOKENS_USD,
      1.0,
    ),
  };
}

function utcDayKey(now: number): string {
  return new Date(now).toISOString().slice(0, 10);
}

function evaluateLimits(
  usage: UsageEntry,
  config: SpendCapConfig,
): SpendCapCheckResult {
  if (usage.requests >= config.dailyRequestCapPerGuest) {
    return {
      allowed: false,
      reasonEs: `Límite diario de ${config.dailyRequestCapPerGuest} consultas alcanzado para esta sesión.`,
      usage: { ...usage },
    };
  }

  if (usage.tokens >= config.dailyTokenCapPerGuest) {
    return {
      allowed: false,
      reasonEs: `Límite diario de ${config.dailyTokenCapPerGuest} tokens alcanzado para esta sesión.`,
      usage: { ...usage },
    };
  }

  if (usage.costUsd >= config.dailySpendCapUsd) {
    return {
      allowed: false,
      reasonEs: `Límite diario de gasto ($${config.dailySpendCapUsd.toFixed(2)} USD) alcanzado.`,
      usage: { ...usage },
    };
  }

  return { allowed: true, usage: { ...usage } };
}

export function createSpendCapGuard(
  config: SpendCapConfig = getSpendCapConfigFromEnv(),
) {
  const usageByGuest = new Map<string, UsageEntry>();

  const getOrInit = (guestId: string, now: number): UsageEntry => {
    const dayKey = utcDayKey(now);
    const current = usageByGuest.get(guestId);
    if (!current || current.dayKey !== dayKey) {
      const fresh: UsageEntry = { dayKey, requests: 0, tokens: 0, costUsd: 0 };
      usageByGuest.set(guestId, fresh);
      return fresh;
    }
    return current;
  };

  const checkLimit = (
    guestId: string,
    now: number = Date.now(),
  ): SpendCapCheckResult => evaluateLimits(getOrInit(guestId, now), config);

  const recordUsage = (
    guestId: string,
    delta: { requests?: number; totalTokens?: number },
    now: number = Date.now(),
  ): UsageEntry => {
    const entry = getOrInit(guestId, now);
    const reqInc = delta.requests ?? 1;
    const tokInc = Math.max(0, delta.totalTokens ?? 0);
    entry.requests += reqInc;
    entry.tokens += tokInc;
    entry.costUsd += (tokInc / 1_000_000) * config.estimatedCostPer1MTokensUsd;
    return { ...entry };
  };

  const reset = () => {
    usageByGuest.clear();
  };

  return { checkLimit, recordUsage, reset, config };
}

export const chatSpendCap = createSpendCapGuard();

/**
 * Checks daily spend cap against Postgres `guest_usage` when DB is configured,
 * falling back to in-memory `chatSpendCap` in test/local-no-DB environments.
 */
export async function checkSpendCapPersistent(
  guestId: string,
  config: SpendCapConfig = chatSpendCap.config,
  now: number = Date.now(),
): Promise<SpendCapCheckResult> {
  if (!isDbConfigured()) {
    return chatSpendCap.checkLimit(guestId, now);
  }

  const dayKey = utcDayKey(now);
  const db = getDb();
  const [row] = await db
    .select()
    .from(guestUsage)
    .where(and(eq(guestUsage.guestId, guestId), eq(guestUsage.dayKey, dayKey)))
    .limit(1);

  const usage: UsageEntry = row
    ? {
        dayKey,
        requests: row.requestCount,
        tokens: row.estimatedTokens,
        costUsd: row.estimatedCostMicros / 1_000_000,
      }
    : { dayKey, requests: 0, tokens: 0, costUsd: 0 };

  return evaluateLimits(usage, config);
}

/**
 * Atomically increments daily usage in `guest_usage` (Postgres) when configured.
 */
export async function recordSpendUsagePersistent(
  guestId: string,
  delta: { requests?: number; totalTokens?: number },
  config: SpendCapConfig = chatSpendCap.config,
  now: number = Date.now(),
): Promise<void> {
  if (!isDbConfigured()) {
    chatSpendCap.recordUsage(guestId, delta, now);
    return;
  }

  const dayKey = utcDayKey(now);
  const reqInc = Math.max(0, delta.requests ?? 0);
  const tokInc = Math.max(0, Math.round(delta.totalTokens ?? 0));
  const costMicrosInc = Math.round(
    tokInc * config.estimatedCostPer1MTokensUsd,
  );

  const db = getDb();
  try {
    await db
      .insert(guestUsage)
      .values({
        guestId,
        dayKey,
        requestCount: reqInc,
        estimatedTokens: tokInc,
        estimatedCostMicros: costMicrosInc,
      })
      .onConflictDoUpdate({
        target: [guestUsage.guestId, guestUsage.dayKey],
        set: {
          requestCount: sql`${guestUsage.requestCount} + ${reqInc}`,
          estimatedTokens: sql`${guestUsage.estimatedTokens} + ${tokInc}`,
          estimatedCostMicros: sql`${guestUsage.estimatedCostMicros} + ${costMicrosInc}`,
          updatedAt: new Date(),
        },
      });
  } catch {
    // Non-fatal usage telemetry write
  }
}
