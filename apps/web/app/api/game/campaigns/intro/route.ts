import { z } from "zod";

import { resolveGuestSessionFromRequest } from "@/lib/auth/guest-session";
import { getDefaultGameStore } from "@/lib/game/store";
import { serverErrorResponse } from "@/lib/http/errors";
import { hashGuestId } from "@/lib/observability/logger";

export const runtime = "nodejs";

const SeedIntroBodySchema = z.object({
  campaignId: z.string().min(1),
});

function withGuestCookie(
  body: Record<string, unknown>,
  status: number,
  setCookieHeader: string | null,
): Response {
  const headers = new Headers({ "Cache-Control": "no-store" });
  if (setCookieHeader) {
    headers.set("Set-Cookie", setCookieHeader);
  }
  return Response.json(body, { status, headers });
}

/**
 * Seeds the deterministic opening narrative + 3 suggested actions for a newly
 * created campaign at 0 LLM tokens when the user clicks "Comenzar campaña".
 */
export async function POST(req: Request) {
  let guest;
  try {
    guest = resolveGuestSessionFromRequest(req);
  } catch (err) {
    return serverErrorResponse({
      route: "/api/game/campaigns/intro",
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
    return withGuestCookie(
      { ok: false, code: "INVALID_JSON", messageEs: "Cuerpo JSON inválido." },
      400,
      guest.setCookieHeader,
    );
  }

  const parsed = SeedIntroBodySchema.safeParse(body);
  if (!parsed.success) {
    return withGuestCookie(
      {
        ok: false,
        code: "INVALID_INPUT",
        messageEs: "Falta campaignId para iniciar la campaña.",
      },
      400,
      guest.setCookieHeader,
    );
  }

  const guestIdHash = hashGuestId(guest.guestId);
  try {
    const store = getDefaultGameStore();
    const seeded = await store.seedOpeningIntro(
      parsed.data.campaignId,
      guest.guestId,
    );
    if (!seeded) {
      return withGuestCookie(
        {
          ok: false,
          code: "CAMPAIGN_NOT_FOUND",
          messageEs: "Campaña no encontrada para esta sesión.",
        },
        404,
        guest.setCookieHeader,
      );
    }

    return withGuestCookie(
      {
        ok: true,
        campaignId: seeded.campaignId,
        sessionId: seeded.sessionId,
        state: seeded.state,
        events: seeded.events,
        messages: seeded.messages,
      },
      200,
      guest.setCookieHeader,
    );
  } catch (err) {
    return serverErrorResponse({
      route: "/api/game/campaigns/intro",
      err,
      publicMessageEs: "Error interno al iniciar la introducción.",
      status: 500,
      errorCode: "STORE_ERROR",
      setCookieHeader: guest.setCookieHeader,
      guestIdHash,
    });
  }
}
