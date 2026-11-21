import { z } from "zod";

import { resolveGuestSessionFromRequest } from "@/lib/auth/guest-session";
import { performRollback } from "@/lib/game/operations";
import { serverErrorResponse } from "@/lib/http/errors";
import { hashGuestId } from "@/lib/observability/logger";

export const runtime = "nodejs";

const RollbackBodySchema = z.object({
  campaignId: z.string().min(1),
  targetSeq: z.number().int().min(0),
  reason: z.string().min(1).optional(),
});

export async function POST(req: Request) {
  let guest;
  try {
    guest = resolveGuestSessionFromRequest(req);
  } catch (err) {
    return serverErrorResponse({
      route: "/api/game/rollback",
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

  const parsed = RollbackBodySchema.safeParse(body);
  if (!parsed.success) {
    return Response.json(
      {
        ok: false,
        code: "INVALID_INPUT",
        messageEs: "Parámetros de rollback inválidos.",
      },
      { status: 400 },
    );
  }

  const guestIdHash = hashGuestId(guest.guestId);
  try {
    const rb = await performRollback({
      campaignId: parsed.data.campaignId,
      guestId: guest.guestId,
      targetSeq: parsed.data.targetSeq,
      reason: parsed.data.reason,
    });

    const headers = new Headers();
    if (guest.setCookieHeader) {
      headers.set("Set-Cookie", guest.setCookieHeader);
    }

    if (!rb.ok) {
      return Response.json(
        { ok: false, code: rb.code, messageEs: rb.messageEs },
        { status: 400, headers },
      );
    }

    return Response.json(
      {
        ok: true,
        rollbackEvent: rb.rollbackEvent,
        state: rb.state,
        events: rb.events,
        messages: rb.messages,
        logHeadSeq: rb.logHeadSeq,
      },
      { status: 200, headers },
    );
  } catch (err) {
    return serverErrorResponse({
      route: "/api/game/rollback",
      err,
      publicMessageEs: "Error interno al revertir el estado de la campaña.",
      status: 500,
      errorCode: "ROLLBACK_ERROR",
      setCookieHeader: guest.setCookieHeader,
      guestIdHash,
    });
  }
}
