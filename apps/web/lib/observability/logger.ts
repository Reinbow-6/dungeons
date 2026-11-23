import { createHash } from "node:crypto";
import { and, eq, sql } from "drizzle-orm";

import type { AccessTier } from "@/lib/auth/whitelist";
import { getDb, isDbConfigured } from "@/lib/db/client";
import { modelUsage, providerHealth } from "@/lib/db/schema";

export function hashGuestId(guestId: string): string {
  return createHash("sha256").update(guestId).digest("hex").slice(0, 12);
}

export interface ServerLogEntry {
  level?: "info" | "warn" | "error";
  requestId: string;
  route: string;
  event: string;
  provider?: string;
  modelId?: string;
  accessTier?: AccessTier;
  status?: number;
  errorCode?: string;
  promptTokens?: number;
  completionTokens?: number;
  cachedTokens?: number;
  cacheHitRate?: number;
  toolCalls?: string[];
  lastSeq?: number;
  latencyMs?: number;
  guestIdHash?: string;
  detail?: string;
}

/**
 * Structured server-only JSON log. Never include raw secrets, API keys, or raw guest tokens.
 */
export function logServerEvent(entry: ServerLogEntry): void {
  const payload = {
    ts: new Date().toISOString(),
    level: entry.level ?? "info",
    ...entry,
  };
  const line = JSON.stringify(payload);
  if (payload.level === "error") {
    console.error(line);
  } else if (payload.level === "warn") {
    console.warn(line);
  } else {
    console.info(line);
  }
}

export function utcDayKey(now = Date.now()): string {
  return new Date(now).toISOString().slice(0, 10);
}

function toSafeTokenInt(value: number | undefined): number {
  return typeof value === "number" && Number.isFinite(value) && value > 0
    ? Math.round(value)
    : 0;
}

/**
 * Best-effort atomic telemetry recording in `provider_health`.
 * Never throws into request flow if telemetry write fails.
 */
export async function recordProviderHealth(params: {
  provider: string;
  modelId: string;
  ok: boolean;
  latencyMs: number;
  errorCode?: string;
  promptTokens?: number;
  completionTokens?: number;
  cachedTokens?: number;
}): Promise<void> {
  if (!isDbConfigured()) return;

  const dayKey = utcDayKey();
  const safeLatency = Math.max(0, Math.round(params.latencyMs));
  const errInc = params.ok ? 0 : 1;
  const promptInc = toSafeTokenInt(params.promptTokens);
  const completionInc = toSafeTokenInt(params.completionTokens);
  const cachedInc = toSafeTokenInt(params.cachedTokens);

  try {
    const db = getDb();
    await db
      .insert(providerHealth)
      .values({
        provider: params.provider,
        modelId: params.modelId,
        dayKey,
        requestCount: 1,
        errorCount: errInc,
        totalLatencyMs: safeLatency,
        promptTokens: promptInc,
        completionTokens: completionInc,
        cachedTokens: cachedInc,
        lastErrorCode: params.ok ? null : (params.errorCode ?? "UNKNOWN"),
      })
      .onConflictDoUpdate({
        target: [
          providerHealth.provider,
          providerHealth.modelId,
          providerHealth.dayKey,
        ],
        set: {
          requestCount: sql`${providerHealth.requestCount} + 1`,
          errorCount: sql`${providerHealth.errorCount} + ${errInc}`,
          totalLatencyMs: sql`${providerHealth.totalLatencyMs} + ${safeLatency}`,
          promptTokens: sql`${providerHealth.promptTokens} + ${promptInc}`,
          completionTokens: sql`${providerHealth.completionTokens} + ${completionInc}`,
          cachedTokens: sql`${providerHealth.cachedTokens} + ${cachedInc}`,
          lastErrorCode: params.ok
            ? providerHealth.lastErrorCode
            : (params.errorCode ?? "UNKNOWN"),
          updatedAt: new Date(),
        },
      });
  } catch {
    // Non-fatal telemetry write
  }
}

export interface ModelUsageEntry {
  provider: string;
  modelId: string;
  accessTier: AccessTier;
  dayKey: string;
  requestCount: number;
  promptTokens: number;
  completionTokens: number;
  cachedTokens: number;
  cacheHitRate: number;
}

export interface DailyModelUsageSummary {
  dayKey: string;
  totalRequests: number;
  totalPromptTokens: number;
  totalCompletionTokens: number;
  totalCachedTokens: number;
  cacheHitRate: number;
  byModel: ModelUsageEntry[];
}

// In-memory fallback used in test / no-DB local runs
const memoryModelUsage = new Map<string, ModelUsageEntry & { guestId: string; userId: string | null }>();

export function resetMemoryModelUsage(): void {
  memoryModelUsage.clear();
}

/**
 * Records per-session & per-model real token telemetry (including whitelisted
 * accounts and cached input tokens) in `model_usage`. Best-effort, never throws.
 */
export async function recordModelUsage(params: {
  guestId: string;
  userId?: string | null;
  accessTier: AccessTier;
  provider: string;
  modelId: string;
  promptTokens: number;
  completionTokens: number;
  cachedTokens: number;
  now?: number;
}): Promise<void> {
  const dayKey = utcDayKey(params.now);
  const promptInc = toSafeTokenInt(params.promptTokens);
  const completionInc = toSafeTokenInt(params.completionTokens);
  const cachedInc = toSafeTokenInt(params.cachedTokens);

  if (!isDbConfigured()) {
    const key = `${params.guestId}|${params.provider}|${params.modelId}|${dayKey}`;
    const existing = memoryModelUsage.get(key);
    if (existing) {
      existing.requestCount += 1;
      existing.promptTokens += promptInc;
      existing.completionTokens += completionInc;
      existing.cachedTokens += cachedInc;
      existing.accessTier = params.accessTier;
      existing.userId = params.userId ?? existing.userId;
      existing.cacheHitRate =
        existing.promptTokens > 0
          ? Math.round((existing.cachedTokens / existing.promptTokens) * 1000) /
            1000
          : 0;
    } else {
      memoryModelUsage.set(key, {
        guestId: params.guestId,
        userId: params.userId ?? null,
        accessTier: params.accessTier,
        provider: params.provider,
        modelId: params.modelId,
        dayKey,
        requestCount: 1,
        promptTokens: promptInc,
        completionTokens: completionInc,
        cachedTokens: cachedInc,
        cacheHitRate:
          promptInc > 0
            ? Math.round((cachedInc / promptInc) * 1000) / 1000
            : 0,
      });
    }
    return;
  }

  try {
    const db = getDb();
    await db
      .insert(modelUsage)
      .values({
        guestId: params.guestId,
        userId: params.userId ?? null,
        accessTier: params.accessTier,
        provider: params.provider,
        modelId: params.modelId,
        dayKey,
        requestCount: 1,
        promptTokens: promptInc,
        completionTokens: completionInc,
        cachedTokens: cachedInc,
      })
      .onConflictDoUpdate({
        target: [
          modelUsage.guestId,
          modelUsage.provider,
          modelUsage.modelId,
          modelUsage.dayKey,
        ],
        set: {
          userId: params.userId ?? modelUsage.userId,
          accessTier: params.accessTier,
          requestCount: sql`${modelUsage.requestCount} + 1`,
          promptTokens: sql`${modelUsage.promptTokens} + ${promptInc}`,
          completionTokens: sql`${modelUsage.completionTokens} + ${completionInc}`,
          cachedTokens: sql`${modelUsage.cachedTokens} + ${cachedInc}`,
          updatedAt: new Date(),
        },
      });
  } catch {
    // Non-fatal telemetry write
  }
}

export async function getDailyModelUsageForGuest(
  guestId: string,
  dayKey: string = utcDayKey(),
): Promise<DailyModelUsageSummary> {
  let rows: ModelUsageEntry[] = [];

  if (!isDbConfigured()) {
    rows = Array.from(memoryModelUsage.values())
      .filter((entry) => entry.guestId === guestId && entry.dayKey === dayKey)
      .map((entry) => ({
        provider: entry.provider,
        modelId: entry.modelId,
        accessTier: entry.accessTier,
        dayKey: entry.dayKey,
        requestCount: entry.requestCount,
        promptTokens: entry.promptTokens,
        completionTokens: entry.completionTokens,
        cachedTokens: entry.cachedTokens,
        cacheHitRate: entry.cacheHitRate,
      }));
  } else {
    try {
      const db = getDb();
      const dbRows = await db
        .select()
        .from(modelUsage)
        .where(
          and(eq(modelUsage.guestId, guestId), eq(modelUsage.dayKey, dayKey)),
        );
      rows = dbRows.map((row) => {
        const promptTokens = Number(row.promptTokens) || 0;
        const cachedTokens = Number(row.cachedTokens) || 0;
        return {
          provider: row.provider,
          modelId: row.modelId,
          accessTier: row.accessTier === "whitelisted" ? "whitelisted" : "guest",
          dayKey: row.dayKey,
          requestCount: row.requestCount,
          promptTokens,
          completionTokens: Number(row.completionTokens) || 0,
          cachedTokens,
          cacheHitRate:
            promptTokens > 0
              ? Math.round((cachedTokens / promptTokens) * 1000) / 1000
              : 0,
        };
      });
    } catch {
      rows = [];
    }
  }

  const totalRequests = rows.reduce((sum, r) => sum + r.requestCount, 0);
  const totalPromptTokens = rows.reduce((sum, r) => sum + r.promptTokens, 0);
  const totalCompletionTokens = rows.reduce(
    (sum, r) => sum + r.completionTokens,
    0,
  );
  const totalCachedTokens = rows.reduce((sum, r) => sum + r.cachedTokens, 0);
  const cacheHitRate =
    totalPromptTokens > 0
      ? Math.round((totalCachedTokens / totalPromptTokens) * 1000) / 1000
      : 0;

  return {
    dayKey,
    totalRequests,
    totalPromptTokens,
    totalCompletionTokens,
    totalCachedTokens,
    cacheHitRate,
    byModel: rows,
  };
}
