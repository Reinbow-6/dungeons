import type { EmailOtpType } from "@supabase/supabase-js";
import { NextResponse } from "next/server";

import { createSupabaseServerClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const VALID_EMAIL_OTP_TYPES = new Set<string>([
  "signup",
  "invite",
  "magiclink",
  "recovery",
  "email_change",
  "email",
]);

function resolveSafeNextPath(rawNext: string | null, origin: string): string {
  if (!rawNext || !rawNext.startsWith("/") || rawNext.startsWith("//")) {
    return "/";
  }

  try {
    const resolved = new URL(rawNext, origin);
    if (resolved.origin !== origin) {
      return "/";
    }
    return `${resolved.pathname}${resolved.search}${resolved.hash}`;
  } catch {
    return "/";
  }
}

function resolveRedirectOrigin(request: Request, urlOrigin: string): string {
  const configuredSiteUrl = process.env.NEXT_PUBLIC_SITE_URL?.trim();
  if (configuredSiteUrl) {
    try {
      const parsed = new URL(configuredSiteUrl);
      if (parsed.protocol === "http:" || parsed.protocol === "https:") {
        return parsed.origin;
      }
    } catch {
      // Ignore invalid NEXT_PUBLIC_SITE_URL
    }
  }

  if (process.env.NODE_ENV === "development") {
    return urlOrigin;
  }

  const forwardedHost = request.headers
    .get("x-forwarded-host")
    ?.split(",")[0]
    ?.trim();
  if (!forwardedHost) {
    return urlOrigin;
  }

  const forwardedProto =
    request.headers.get("x-forwarded-proto")?.split(",")[0]?.trim() || "https";
  if (forwardedProto !== "http" && forwardedProto !== "https") {
    return urlOrigin;
  }

  try {
    const requestHost = new URL(urlOrigin).host.toLowerCase();
    if (forwardedHost.toLowerCase() !== requestHost) {
      return urlOrigin;
    }
    return new URL(`${forwardedProto}://${forwardedHost}`).origin;
  } catch {
    return urlOrigin;
  }
}

export async function GET(request: Request) {
  const requestUrl = new URL(request.url);
  const code = requestUrl.searchParams.get("code");
  const tokenHash = requestUrl.searchParams.get("token_hash");
  const type = requestUrl.searchParams.get("type");
  const safeNext = resolveSafeNextPath(
    requestUrl.searchParams.get("next"),
    requestUrl.origin,
  );
  const redirectOrigin = resolveRedirectOrigin(request, requestUrl.origin);

  const supabase = await createSupabaseServerClient();
  let authFailed = false;

  if (supabase) {
    if (code) {
      const { error } = await supabase.auth.exchangeCodeForSession(code);
      if (error) {
        authFailed = true;
      }
    } else if (tokenHash && type && VALID_EMAIL_OTP_TYPES.has(type)) {
      const { error } = await supabase.auth.verifyOtp({
        token_hash: tokenHash,
        type: type as EmailOtpType,
      });
      if (error) {
        authFailed = true;
      }
    }
  }

  const targetUrl = authFailed
    ? new URL("/?auth_error=callback", redirectOrigin)
    : new URL(safeNext, redirectOrigin);

  const response = NextResponse.redirect(targetUrl);
  response.headers.set("Cache-Control", "no-store");
  return response;
}
