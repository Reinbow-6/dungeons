import { lt, sql } from "drizzle-orm";

import { getDb, isDbConfigured } from "@/lib/db/client";
import { rateLimitBuckets } from "@/lib/db/schema";

export interface RateLimitConfig {
  windowMs: number;
  maxRequestsPerGuest: number;
  maxRequestsPerIp: number;
}

export interface RateLimitCheckResult {
  allowed: boolean;
  retryAfterSec: number;
  remainingGuest: number;
  remainingIp: number;
}

function parsePositiveInt(raw: string | undefined, fallback: number): number {
  const n = raw ? Number.parseInt(raw, 10) : Number.NaN;
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

export function getRateLimitConfigFromEnv(
  env: Record<string, string | undefined> = process.env,
): RateLimitConfig {
  const rpm = parsePositiveInt(env.RATE_LIMIT_RPM, 20);
  return {
    windowMs: 60_000,
    maxRequestsPerGuest: rpm,
    maxRequestsPerIp: rpm * 2,
  };
}

/**
 * Extracts client IP preferring platform-injected headers that clients cannot
 * trivially spoof, falling back to the rightmost proxy hop if needed.
 */
export function extractClientIp(req: Request): string {
  const platformHeaders = [
    "x-vercel-forwarded-for",
    "cf-connecting-ip",
    "fly-client-ip",
    "x-real-ip",
  ];
  for (const headerName of platformHeaders) {
    const val = req.headers.get(headerName)?.trim();
    if (val) {
      return val.split(",")[0]?.trim() || val;
    }
  }
  const forwarded = req.headers.get("x-forwarded-for");
  if (forwarded) {
    const parts = forwarded
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean);
    const rightmost = parts.at(-1);
    if (rightmost) return rightmost;
  }
  return "local";
}

export function createRateLimiter(
  config: RateLimitConfig = getRateLimitConfigFromEnv(),
) {
  const buckets = new Map<string, number[]>();

  const prune = (key: string, now: number): number[] => {
    const cutoff = now - config.windowMs;
    const existing = buckets.get(key) ?? [];
    const active = existing.filter((ts) => ts > cutoff);
    if (active.length === 0) {
      buckets.delete(key);
    } else {
      buckets.set(key, active);
    }
    return active;
  };

  const check = (
    guestId: string,
    ip: string,
    now: number = Date.now(),
  ): RateLimitCheckResult => {
    const guestKey = `guest:${guestId}`;
    const ipKey = `ip:${ip}`;

    const guestHits = prune(guestKey, now);
    const ipHits = prune(ipKey, now);

    const guestRemaining = config.maxRequestsPerGuest - guestHits.length;
    const ipRemaining = config.maxRequestsPerIp - ipHits.length;

    if (guestRemaining <= 0 || ipRemaining <= 0) {
      const oldestGuest = guestHits[0] ?? now;
      const oldestIp = ipHits[0] ?? now;
      const blockedSince =
        guestRemaining <= 0 && ipRemaining <= 0
          ? Math.max(oldestGuest, oldestIp)
          : guestRemaining <= 0
            ? oldestGuest
            : oldestIp;
      const retryAfterMs = Math.max(1_000, blockedSince + config.windowMs - now);
      return {
        allowed: false,
        retryAfterSec: Math.ceil(retryAfterMs / 1000),
        remainingGuest: Math.max(0, guestRemaining),
        remainingIp: Math.max(0, ipRemaining),
      };
    }

    guestHits.push(now);
    ipHits.push(now);
    buckets.set(guestKey, guestHits);
    buckets.set(ipKey, ipHits);

    return {
      allowed: true,
      retryAfterSec: 0,
      remainingGuest: guestRemaining - 1,
      remainingIp: ipRemaining - 1,
    };
  };

  const reset = () => {
    buckets.clear();
  };

  return { check, reset, config };
}

export const chatRateLimiter = createRateLimiter();

async function incrementBucket(
  bucketKey: string,
  windowStart: number,
): Promise<number> {
  const db = getDb();
  const [row] = await db
    .insert(rateLimitBuckets)
    .values({
      bucketKey,
      windowStart,
      requestCount: 1,
    })
    .onConflictDoUpdate({
      target: [rateLimitBuckets.bucketKey, rateLimitBuckets.windowStart],
      set: {
        requestCount: sql`${rateLimitBuckets.requestCount} + 1`,
        updatedAt: new Date(),
      },
    })
    .returning({ requestCount: rateLimitBuckets.requestCount });

  return Number(row?.requestCount ?? 1);
}

/**
 * Checks per-guest & per-IP rate limit using atomic Postgres bucket upserts
 * when DB is configured, falling back to `chatRateLimiter` in unit tests/no-DB dev.
 */
export async function checkRateLimitPersistent(
  guestId: string,
  ip: string,
  config: RateLimitConfig = chatRateLimiter.config,
  now: number = Date.now(),
): Promise<RateLimitCheckResult> {
  if (!isDbConfigured()) {
    return chatRateLimiter.check(guestId, ip, now);
  }

  const windowStart = Math.floor(now / config.windowMs);
  if (Math.random() < 0.02) {
    void getDb()
      .delete(rateLimitBuckets)
      .where(lt(rateLimitBuckets.windowStart, windowStart - 5))
      .catch(() => {});
  }
  const [guestCount, ipCount] = await Promise.all([
    incrementBucket(`guest:${guestId}`, windowStart),
    incrementBucket(`ip:${ip}`, windowStart),
  ]);

  const remainingGuest = config.maxRequestsPerGuest - guestCount;
  const remainingIp = config.maxRequestsPerIp - ipCount;

  if (remainingGuest < 0 || remainingIp < 0) {
    const retryAfterMs = Math.max(
      1_000,
      (windowStart + 1) * config.windowMs - now,
    );
    return {
      allowed: false,
      retryAfterSec: Math.ceil(retryAfterMs / 1000),
      remainingGuest: Math.max(0, remainingGuest),
      remainingIp: Math.max(0, remainingIp),
    };
  }

  return {
    allowed: true,
    retryAfterSec: 0,
    remainingGuest: Math.max(0, remainingGuest),
    remainingIp: Math.max(0, remainingIp),
  };
}
