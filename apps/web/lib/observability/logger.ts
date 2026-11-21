import { createHash } from "node:crypto";
import { sql } from "drizzle-orm";

import { getDb, isDbConfigured } from "@/lib/db/client";
import { providerHealth } from "@/lib/db/schema";

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
  status?: number;
  errorCode?: string;
  promptTokens?: number;
  completionTokens?: number;
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

function utcDayKey(now = Date.now()): string {
  return new Date(now).toISOString().slice(0, 10);
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
}): Promise<void> {
  if (!isDbConfigured()) return;

  const dayKey = utcDayKey();
  const safeLatency = Math.max(0, Math.round(params.latencyMs));
  const errInc = params.ok ? 0 : 1;

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
