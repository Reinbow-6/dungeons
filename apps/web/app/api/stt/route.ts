import {
  STT_MAX_AUDIO_BYTES,
  STT_MIN_AUDIO_BYTES,
  STT_MODEL_ID,
  STT_PROVIDER,
  SttError,
  transcribeAudioWithGroq,
} from "@/lib/ai/stt";
import { resolveGuestSessionFromRequest } from "@/lib/auth/guest-session";
import { resolveRequestAccess } from "@/lib/auth/whitelist";
import {
  checkRateLimitPersistent,
  extractClientIp,
} from "@/lib/guardrails/rate-limit";
import {
  checkSpendCapPersistent,
  recordSpendUsagePersistent,
} from "@/lib/guardrails/spend-cap";
import { createCorrelationId, serverErrorResponse } from "@/lib/http/errors";
import {
  hashGuestId,
  logServerEvent,
  recordProviderHealth,
} from "@/lib/observability/logger";

export const runtime = "nodejs";
export const maxDuration = 30;

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

function mapSttErrorStatus(code: SttError["code"]): number {
  switch (code) {
    case "AUDIO_TOO_LARGE":
      return 413;
    case "MISSING_API_KEY":
    case "PROVIDER_UNAVAILABLE":
      return 503;
    case "EMPTY_TRANSCRIPT":
      return 200;
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
      route: "/api/stt",
      err,
      publicMessageEs: "Error interno al verificar la sesión.",
      status: 500,
      errorCode: "SESSION_ERROR",
      correlationId: requestId,
    });
  }

  const guestIdHash = hashGuestId(guest.guestId);
  const clientIp = extractClientIp(req);
  const access = await resolveRequestAccess();

  let rateCheck;
  try {
    rateCheck = await checkRateLimitPersistent(guest.guestId, clientIp);
  } catch (err) {
    return serverErrorResponse({
      route: "/api/stt",
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
      route: "/api/stt",
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

  if (access.tier !== "whitelisted") {
    let capCheck;
    try {
      capCheck = await checkSpendCapPersistent(guest.guestId);
    } catch (err) {
      return serverErrorResponse({
        route: "/api/stt",
        err,
        publicMessageEs: "Error interno al verificar el cupo de uso.",
        status: 500,
        errorCode: "USAGE_CHECK_ERROR",
        setCookieHeader: guest.setCookieHeader,
        correlationId: requestId,
        guestIdHash,
      });
    }
    if (!capCheck.allowed) {
      return jsonWithGuestCookie(
        {
          ok: false,
          code: "SPEND_CAP_REACHED",
          error:
            capCheck.reasonEs ??
            "Alcanzaste el límite diario de uso para esta sesión.",
        },
        429,
        guest.setCookieHeader,
      );
    }
  }

  let formData: FormData;
  try {
    formData = await req.formData();
  } catch {
    return jsonWithGuestCookie(
      {
        ok: false,
        code: "INVALID_AUDIO",
        error: "Se esperaba multipart/form-data con un campo de audio.",
      },
      400,
      guest.setCookieHeader,
    );
  }

  const rawAudio = formData.get("audio") ?? formData.get("file");
  if (!(rawAudio instanceof Blob)) {
    return jsonWithGuestCookie(
      {
        ok: false,
        code: "INVALID_AUDIO",
        error: "Falta el archivo de audio para transcribir.",
      },
      400,
      guest.setCookieHeader,
    );
  }

  if (rawAudio.size > STT_MAX_AUDIO_BYTES) {
    return jsonWithGuestCookie(
      {
        ok: false,
        code: "AUDIO_TOO_LARGE",
        error: "El archivo de audio supera el límite máximo de 10 MB.",
      },
      413,
      guest.setCookieHeader,
    );
  }
  if (rawAudio.size < STT_MIN_AUDIO_BYTES) {
    return jsonWithGuestCookie(
      {
        ok: false,
        code: "AUDIO_TOO_SHORT",
        error: "La grabación es demasiado corta para transcribir.",
      },
      400,
      guest.setCookieHeader,
    );
  }

  const rawLang = formData.get("language");
  const language =
    typeof rawLang === "string" && /^[a-z]{2}$/i.test(rawLang.trim())
      ? rawLang.trim().toLowerCase()
      : undefined;

  const fileName = rawAudio instanceof File ? rawAudio.name : undefined;

  try {
    const buffer = await rawAudio.arrayBuffer();
    const audioBytes = new Uint8Array(buffer);

    const result = await transcribeAudioWithGroq({
      audioBytes,
      mimeType: rawAudio.type,
      fileName,
      language,
      signal: req.signal,
    });

    const latencyMs = Date.now() - startedAt;
    logServerEvent({
      level: "info",
      requestId,
      route: "/api/stt",
      event: "stt_completed",
      provider: STT_PROVIDER,
      modelId: STT_MODEL_ID,
      status: 200,
      latencyMs,
      guestIdHash,
    });
    void recordProviderHealth({
      provider: STT_PROVIDER,
      modelId: STT_MODEL_ID,
      ok: true,
      latencyMs,
    });
    if (access.tier !== "whitelisted") {
      void recordSpendUsagePersistent(guest.guestId, { requests: 1 });
    }

    return jsonWithGuestCookie(
      {
        ok: true,
        text: result.text,
        empty: false,
        modelId: result.modelId,
        language: result.language,
        latencyMs,
      },
      200,
      guest.setCookieHeader,
    );
  } catch (err) {
    const latencyMs = Date.now() - startedAt;

    if (err instanceof SttError) {
      if (err.code === "EMPTY_TRANSCRIPT") {
        logServerEvent({
          level: "info",
          requestId,
          route: "/api/stt",
          event: "stt_empty_transcript",
          provider: STT_PROVIDER,
          modelId: STT_MODEL_ID,
          status: 200,
          latencyMs,
          guestIdHash,
        });
        void recordProviderHealth({
          provider: STT_PROVIDER,
          modelId: STT_MODEL_ID,
          ok: true,
          latencyMs,
        });
        return jsonWithGuestCookie(
          {
            ok: true,
            text: "",
            empty: true,
            modelId: STT_MODEL_ID,
            latencyMs,
          },
          200,
          guest.setCookieHeader,
        );
      }

      const status = mapSttErrorStatus(err.code);
      const isProviderErr =
        err.code === "MISSING_API_KEY" || err.code === "PROVIDER_UNAVAILABLE";

      logServerEvent({
        level: isProviderErr ? "error" : "warn",
        requestId,
        route: "/api/stt",
        event: "stt_rejected",
        provider: STT_PROVIDER,
        modelId: STT_MODEL_ID,
        status,
        errorCode: err.code,
        latencyMs,
        guestIdHash,
      });

      if (isProviderErr) {
        void recordProviderHealth({
          provider: STT_PROVIDER,
          modelId: STT_MODEL_ID,
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
      provider: STT_PROVIDER,
      modelId: STT_MODEL_ID,
      ok: false,
      latencyMs,
      errorCode: "STT_INTERNAL_ERROR",
    });

    return serverErrorResponse({
      route: "/api/stt",
      err,
      publicMessageEs: "Error interno al transcribir el audio.",
      status: 500,
      errorCode: "STT_INTERNAL_ERROR",
      setCookieHeader: guest.setCookieHeader,
      correlationId: requestId,
      guestIdHash,
    });
  }
}
