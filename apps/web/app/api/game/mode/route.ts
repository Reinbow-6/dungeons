import { z } from "zod";

import { resolveGuestSessionFromRequest } from "@/lib/auth/guest-session";
import { getDefaultGameStore } from "@/lib/game/store";
import { serverErrorResponse } from "@/lib/http/errors";
import { hashGuestId } from "@/lib/observability/logger";

export const runtime = "nodejs";

const ModePatchSchema = z.object({
  campaignId: z.string().min(1),
  mode: z.enum(["digital", "hybrid"]),
});

export async function PATCH(req: Request) {
  let guest;
  try {
    guest = resolveGuestSessionFromRequest(req);
  } catch (err) {
    return serverErrorResponse({
      route: "/api/game/mode",
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

  const parsed = ModePatchSchema.safeParse(body);
  if (!parsed.success) {
    return Response.json(
      {
        ok: false,
        code: "INVALID_INPUT",
        messageEs: "Modo de juego inválido.",
      },
      { status: 400 },
    );
  }

  const guestIdHash = hashGuestId(guest.guestId);
  try {
    const store = getDefaultGameStore();
    const updated = await store.updateTableMode(
      parsed.data.campaignId,
      guest.guestId,
      parsed.data.mode,
    );

    const headers = new Headers();
    if (guest.setCookieHeader) {
      headers.set("Set-Cookie", guest.setCookieHeader);
    }

    if (!updated) {
      return Response.json(
        {
          ok: false,
          code: "NOT_FOUND",
          messageEs: "Campaña o personaje no encontrado.",
        },
        { status: 404, headers },
      );
    }

    return Response.json(
      { ok: true, state: updated.state },
      { status: 200, headers },
    );
  } catch (err) {
    return serverErrorResponse({
      route: "/api/game/mode",
      err,
      publicMessageEs: "Error interno al actualizar el modo del personaje.",
      status: 500,
      errorCode: "MODE_UPDATE_ERROR",
      setCookieHeader: guest.setCookieHeader,
      guestIdHash,
    });
  }
}
