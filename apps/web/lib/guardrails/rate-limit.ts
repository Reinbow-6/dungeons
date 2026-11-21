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
