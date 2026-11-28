import { createHmac, randomUUID, timingSafeEqual } from "node:crypto";

export const GUEST_COOKIE_NAME = "dungeons_guest_session";
const DEV_FALLBACK_SECRET = "dungeons-dev-only-guest-secret-change-me";
const UUID_REGEX =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function resolveSessionSecret(
  env: Record<string, string | undefined> = process.env,
): string {
  const secret = env.SESSION_SECRET?.trim();
  if (secret && secret.length >= 16) {
    return secret;
  }
  if (env.NODE_ENV === "production") {
    throw new Error(
      "SESSION_SECRET (mínimo 16 caracteres) es obligatorio en producción.",
    );
  }
  return DEV_FALLBACK_SECRET;
}

function signGuestId(guestId: string, secret: string): string {
  return createHmac("sha256", secret).update(guestId).digest("hex");
}

export function createGuestSessionToken(
  guestId: string = randomUUID(),
  env: Record<string, string | undefined> = process.env,
): string {
  const secret = resolveSessionSecret(env);
  const sig = signGuestId(guestId, secret);
  return `${guestId}.${sig}`;
}

export function verifyGuestSessionToken(
  token: string | undefined | null,
  env: Record<string, string | undefined> = process.env,
): string | null {
  if (!token || typeof token !== "string") {
    return null;
  }
  const dotIdx = token.indexOf(".");
  if (dotIdx <= 0) {
    return null;
  }
  const guestId = token.slice(0, dotIdx);
  const providedSig = token.slice(dotIdx + 1);
  if (!UUID_REGEX.test(guestId) || !/^[0-9a-f]{64}$/i.test(providedSig)) {
    return null;
  }

  const secret = resolveSessionSecret(env);
  const expectedSig = signGuestId(guestId, secret);
  const providedBuf = Buffer.from(providedSig, "hex");
  const expectedBuf = Buffer.from(expectedSig, "hex");
  if (providedBuf.length !== expectedBuf.length) {
    return null;
  }
  if (!timingSafeEqual(providedBuf, expectedBuf)) {
    return null;
  }
  return guestId;
}

function parseCookieValue(cookieHeader: string | null, name: string): string | null {
  if (!cookieHeader) {
    return null;
  }
  for (const part of cookieHeader.split(";")) {
    const trimmed = part.trim();
    if (trimmed.startsWith(`${name}=`)) {
      try {
        return decodeURIComponent(trimmed.slice(name.length + 1));
      } catch {
        return null;
      }
    }
  }
  return null;
}

export interface GuestSessionResolution {
  guestId: string;
  token: string;
  isNew: boolean;
  setCookieHeader: string | null;
}

export function resolveGuestSessionFromRequest(
  req: Request,
  env: Record<string, string | undefined> = process.env,
): GuestSessionResolution {
  const rawCookie = parseCookieValue(req.headers.get("cookie"), GUEST_COOKIE_NAME);
  const verifiedGuestId = verifyGuestSessionToken(rawCookie, env);

  if (verifiedGuestId && rawCookie) {
    return {
      guestId: verifiedGuestId,
      token: rawCookie,
      isNew: false,
      setCookieHeader: null,
    };
  }

  const guestId = randomUUID();
  const token = createGuestSessionToken(guestId, env);
  const secureFlag = env.NODE_ENV === "production" ? "; Secure" : "";
  const setCookieHeader = `${GUEST_COOKIE_NAME}=${encodeURIComponent(token)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${60 * 60 * 24 * 30}${secureFlag}`;

  return {
    guestId,
    token,
    isNew: true,
    setCookieHeader,
  };
}
