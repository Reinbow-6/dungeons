import { resolveGuestSessionFromRequest } from "@/lib/auth/guest-session";
import { resolveRequestAccess } from "@/lib/auth/whitelist";
import { serverErrorResponse } from "@/lib/http/errors";
import { getDailyModelUsageForGuest } from "@/lib/observability/logger";

export const runtime = "nodejs";

/**
 * Returns today's per-model token and prompt-cache telemetry for the active
 * session (covering both guest and whitelisted accounts).
 */
export async function GET(req: Request) {
  let guest;
  try {
    guest = resolveGuestSessionFromRequest(req);
  } catch (err) {
    return serverErrorResponse({
      route: "/api/usage",
      err,
      publicMessageEs: "Error interno al verificar la sesión.",
      status: 500,
      errorCode: "SESSION_ERROR",
    });
  }

  const access = await resolveRequestAccess(req);
  const summary = await getDailyModelUsageForGuest(guest.guestId);

  const headers = new Headers({ "Cache-Control": "no-store" });
  if (guest.setCookieHeader) {
    headers.set("Set-Cookie", guest.setCookieHeader);
  }

  return Response.json(
    {
      ok: true,
      tier: access.tier,
      ...summary,
    },
    { status: 200, headers },
  );
}
