import { z } from "zod";

import { synthesizeSpeechWithOpenRouter, TtsError } from "@/lib/ai/tts";
import { resolveGuestSessionFromRequest } from "@/lib/auth/guest-session";
import { resolveRequestAccess } from "@/lib/auth/whitelist";
import {
  checkRateLimitPersistent,
  extractClientIp,
} from "@/lib/guardrails/rate-limit";
import { createCorrelationId, serverErrorResponse } from "@/lib/http/errors";
import {
  hashGuestId,
  logServerEvent,
  recordProviderHealth,
} from "@/lib/observability/logger";
import { DEFAULT_TTS_MODEL, isTtsModelAllowed } from "@/lib/tts-models";

export const runtime = "nodejs";
export const maxDuration = 30;

const TtsRequestSchema = z.object({
  text: z
    .string()
    .trim()
    .min(1, "El texto para narrar no puede estar vacío.")
    .max(20_000, "El texto supera el máximo permitido."),
  model: z.string().trim().optional(),
  modelId: z.string().trim().optional(),
  voice: z.string().trim().max(120).optional(),
  speed: z.number().finite().min(0.5).max(2.0).optional(),
});

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

function mapTtsErrorStatus(code: TtsError["code"]): number {
  switch (code) {
    case "MISSING_API_KEY":
    case "PROVIDER_UNAVAILABLE":
      return 503;
    case "RATE_LIMITED":
      return 429;
    default:
      return 400;
  }
}

export async function POST(req: Request) {
  const requestId = createCorrelationId();
  const startedAt = Date.now();

  let guest;
  try {
    guest = resolveGuestSessionFromRequest(req);
  } catch (err) {
    return serverErrorResponse({
      route: "/api/tts",
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
      route: "/api/tts",
      err,
      publicMessageEs: "Error interno al verificar permisos de acceso.",
      status: 500,
      errorCode: "ACCESS_CHECK_ERROR",
      setCookieHeader: guest.setCookieHeader,
      correlationId: requestId,
      guestIdHash,
    });
  }

  if (access.tier !== "whitelisted") {
    logServerEvent({
      level: "warn",
      requestId,
      route: "/api/tts",
      event: "tts_whitelist_required",
      status: 403,
      errorCode: "AUTH_WHITELIST_REQUIRED",
      guestIdHash,
    });
    return jsonWithGuestCookie(
      {
        ok: false,
        code: "AUTH_WHITELIST_REQUIRED",
        error:
          "Iniciá sesión con una cuenta autorizada (whitelist) para usar síntesis de voz (TTS).",
      },
      403,
      guest.setCookieHeader,
    );
  }

  let rateCheck;
  try {
    rateCheck = await checkRateLimitPersistent(guest.guestId, clientIp);
  } catch (err) {
    return serverErrorResponse({
      route: "/api/tts",
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
      route: "/api/tts",
      event: "rate_limited",
      status: 429,
      errorCode: "RATE_LIMITED",
      guestIdHash,
    });
    return jsonWithGuestCookie(
      {
        ok: false,
        code: "RATE_LIMITED",
        error: `Demasiadas solicitudes de voz. Esperá ${rateCheck.retryAfterSec} segundos.`,
      },
      429,
      guest.setCookieHeader,
      { "Retry-After": String(rateCheck.retryAfterSec) },
    );
  }

  let rawBody: unknown;
  try {
    rawBody = await req.json();
  } catch {
    return jsonWithGuestCookie(
      {
        ok: false,
        code: "INVALID_JSON",
        error: "Cuerpo JSON inválido.",
      },
      400,
      guest.setCookieHeader,
    );
  }

  const parsed = TtsRequestSchema.safeParse(rawBody);
  if (!parsed.success) {
    return jsonWithGuestCookie(
      {
        ok: false,
        code: "INVALID_TEXT",
        error:
          parsed.error.issues[0]?.message ??
          "Parámetros inválidos para síntesis de voz.",
      },
      400,
      guest.setCookieHeader,
    );
  }

  const requestedModelRaw =
    parsed.data.model && parsed.data.model.length > 0
      ? parsed.data.model
      : parsed.data.modelId && parsed.data.modelId.length > 0
        ? parsed.data.modelId
        : DEFAULT_TTS_MODEL;

  if (!isTtsModelAllowed(requestedModelRaw)) {
    return jsonWithGuestCookie(
      {
        ok: false,
        code: "INVALID_MODEL",
        error: `El modelo TTS "${requestedModelRaw}" no está habilitado.`,
      },
      400,
      guest.setCookieHeader,
    );
  }

  try {
    const result = await synthesizeSpeechWithOpenRouter({
      text: parsed.data.text,
      modelId: requestedModelRaw,
      voice: parsed.data.voice,
      speed: parsed.data.speed,
      fallbackOnRateLimit: true,
      signal: req.signal,
    });

    const latencyMs = Date.now() - startedAt;
    logServerEvent({
      level: "info",
      requestId,
      route: "/api/tts",
      event: "tts_completed",
      provider: "openrouter",
      modelId: result.modelUsed,
      status: 200,
      latencyMs,
      guestIdHash,
      ...(result.fallbackUsed ? { detail: "fallback_used" } : {}),
    });
    void recordProviderHealth({
      provider: "openrouter",
      modelId: result.modelUsed,
      ok: true,
      latencyMs,
    });

    const headers = new Headers({
      "Content-Type": result.contentType,
      "Content-Length": String(result.audioBytes.byteLength),
      "Cache-Control": "no-store",
      "X-TTS-Model-Used": result.modelUsed,
    });
    if (result.fallbackUsed) {
      headers.set("X-TTS-Fallback", "1");
    }
    if (guest.setCookieHeader) {
      headers.set("Set-Cookie", guest.setCookieHeader);
    }

    const bodyBuffer = new ArrayBuffer(result.audioBytes.byteLength);
    new Uint8Array(bodyBuffer).set(result.audioBytes);

    return new Response(bodyBuffer, {
      status: 200,
      headers,
    });
  } catch (err) {
    const latencyMs = Date.now() - startedAt;

    if (err instanceof TtsError) {
      const status = mapTtsErrorStatus(err.code);
      const isProviderErr =
        err.code === "MISSING_API_KEY" ||
        err.code === "PROVIDER_UNAVAILABLE" ||
        err.code === "RATE_LIMITED";

      logServerEvent({
        level: isProviderErr ? "error" : "warn",
        requestId,
        route: "/api/tts",
        event: "tts_rejected",
        provider: "openrouter",
        modelId: requestedModelRaw,
        status,
        errorCode: err.code,
        latencyMs,
        guestIdHash,
      });

      if (isProviderErr) {
        void recordProviderHealth({
          provider: "openrouter",
          modelId: requestedModelRaw,
          ok: false,
          latencyMs,
          errorCode: err.code,
        });
      }

      return jsonWithGuestCookie(
        {
          ok: false,
          code: err.code,
          error: err.message,
        },
        status,
        guest.setCookieHeader,
      );
    }

    void recordProviderHealth({
      provider: "openrouter",
      modelId: requestedModelRaw,
      ok: false,
      latencyMs,
      errorCode: "TTS_INTERNAL_ERROR",
    });

    return serverErrorResponse({
      route: "/api/tts",
      err,
      publicMessageEs: "Error interno al sintetizar el audio.",
      status: 500,
      errorCode: "TTS_INTERNAL_ERROR",
      setCookieHeader: guest.setCookieHeader,
      correlationId: requestId,
      guestIdHash,
    });
  }
}
