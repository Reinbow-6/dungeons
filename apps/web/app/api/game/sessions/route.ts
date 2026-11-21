import { z } from "zod";

import { buildDeterministicSessionSummary } from "@/agent/subagents/memory/agent";
import { resolveGuestSessionFromRequest } from "@/lib/auth/guest-session";
import { getDefaultGameStore } from "@/lib/game/store";
import { serverErrorResponse } from "@/lib/http/errors";
import { hashGuestId } from "@/lib/observability/logger";

export const runtime = "nodejs";

const SessionPostSchema = z.object({
  campaignId: z.string().min(1),
  closingSummary: z.string().min(1).max(1200).optional(),
  worldSummary: z.string().min(1).max(600).optional(),
});

export async function POST(req: Request) {
  let guest;
  try {
    guest = resolveGuestSessionFromRequest(req);
  } catch (err) {
    return serverErrorResponse({
      route: "/api/game/sessions",
      err,
      publicMessageEs: "Error interno al verificar la sesión.",
      status: 500,
      errorCode: "SESSION_ERROR",
    });
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return Response.json(
      { ok: false, code: "INVALID_JSON", messageEs: "JSON inválido." },
      { status: 400 },
    );
  }

  const parsed = SessionPostSchema.safeParse(body);
  if (!parsed.success) {
    return Response.json(
      {
        ok: false,
        code: "INVALID_INPUT",
        messageEs: "Parámetros inválidos para cerrar sesión.",
      },
      { status: 400 },
    );
  }

  const guestIdHash = hashGuestId(guest.guestId);
  try {
    const store = getDefaultGameStore();
    const loaded = await store.loadCampaign(
      parsed.data.campaignId,
      guest.guestId,
    );
    if (!loaded) {
      return Response.json(
        {
          ok: false,
          code: "CAMPAIGN_NOT_FOUND",
          messageEs: "No se encontró la campaña para esta sesión.",
        },
        { status: 404 },
      );
    }

    const closingSummary =
      parsed.data.closingSummary ??
      buildDeterministicSessionSummary({
        sessionNumber: loaded.sessionNumber,
        state: loaded.state,
        events: loaded.events,
        memoryFacts: loaded.memoryFacts,
      });

    const updated = await store.startNewSession(
      loaded.campaignId,
      guest.guestId,
      {
        closingSummary,
        worldSummary: parsed.data.worldSummary,
      },
    );

    if (!updated) {
      return Response.json(
        {
          ok: false,
          code: "CAMPAIGN_NOT_FOUND",
          messageEs: "No se pudo actualizar la sesión de la campaña.",
        },
        { status: 404 },
      );
    }

    const headers = new Headers();
    if (guest.setCookieHeader) {
      headers.set("Set-Cookie", guest.setCookieHeader);
    }

    return Response.json(
      {
        ok: true,
        campaignId: updated.campaignId,
        sessionId: updated.sessionId,
        sessionNumber: updated.sessionNumber,
        worldSummary: updated.worldSummary,
        sessionSummaries: updated.sessionSummaries,
        memoryFacts: updated.memoryFacts,
        state: updated.state,
        events: updated.events,
        messages: updated.messages,
      },
      { status: 200, headers },
    );
  } catch (err) {
    return serverErrorResponse({
      route: "/api/game/sessions",
      err,
      publicMessageEs: "Error interno al iniciar nueva sesión.",
      status: 500,
      errorCode: "SESSION_ROTATE_ERROR",
      setCookieHeader: guest.setCookieHeader,
      guestIdHash,
    });
  }
}
