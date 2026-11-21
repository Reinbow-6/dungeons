import { z } from "zod";

import { resolveGuestSessionFromRequest } from "@/lib/auth/guest-session";
import { CHARACTER_PRESETS } from "@/lib/game/presets";
import { getDefaultGameStore } from "@/lib/game/store";
import { serverErrorResponse } from "@/lib/http/errors";
import { hashGuestId } from "@/lib/observability/logger";

export const runtime = "nodejs";

function withGuestCookie(
  body: Record<string, unknown>,
  status: number,
  setCookieHeader: string | null,
): Response {
  const headers = new Headers();
  if (setCookieHeader) {
    headers.set("Set-Cookie", setCookieHeader);
  }
  return Response.json(body, { status, headers });
}

export async function GET(req: Request) {
  let guest;
  try {
    guest = resolveGuestSessionFromRequest(req);
  } catch (err) {
    return serverErrorResponse({
      route: "/api/game/campaigns",
      err,
      publicMessageEs: "Error interno al verificar la sesión.",
      status: 500,
      errorCode: "SESSION_ERROR",
    });
  }

  const guestIdHash = hashGuestId(guest.guestId);
  try {
    const store = getDefaultGameStore();
    const url = new URL(req.url);
    const requestedId = url.searchParams.get("campaignId");

    const listParam = url.searchParams.get("list");
    if (listParam === "1" || listParam === "true") {
      const rawLimit = Number.parseInt(
        url.searchParams.get("limit") ?? "20",
        10,
      );
      const rawOffset = Number.parseInt(
        url.searchParams.get("offset") ?? "0",
        10,
      );
      const page = await store.listCampaignsForGuest(guest.guestId, {
        limit: Number.isFinite(rawLimit) ? rawLimit : 20,
        offset: Number.isFinite(rawOffset) ? rawOffset : 0,
      });
      return withGuestCookie(
        {
          ...page,
          presets: CHARACTER_PRESETS,
        },
        200,
        guest.setCookieHeader,
      );
    }

    if (requestedId) {
      const loaded = await store.loadCampaign(requestedId, guest.guestId);
      if (!loaded) {
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
          campaignId: loaded.campaignId,
          sessionId: loaded.sessionId,
          sessionNumber: loaded.sessionNumber,
          title: loaded.title,
          ruleset: loaded.ruleset,
          worldSummary: loaded.worldSummary,
          state: loaded.state,
          logHeadSeq: loaded.logHeadSeq,
          events: loaded.events,
          messages: loaded.messages,
          sessionSummaries: loaded.sessionSummaries,
          memoryFacts: loaded.memoryFacts,
          presets: CHARACTER_PRESETS,
        },
        200,
        guest.setCookieHeader,
      );
    }

    const latest = await store.getLatestCampaignForGuest(guest.guestId);
    if (!latest) {
      // GET es estrictamente de solo lectura: si no hay campaña previa, el cliente decide crearla vía POST.
      return withGuestCookie(
        {
          campaignId: null,
          sessionId: null,
          sessionNumber: 1,
          title: null,
          ruleset: "5e-lite",
          worldSummary: "",
          state: null,
          logHeadSeq: 0,
          events: [],
          messages: [],
          sessionSummaries: [],
          memoryFacts: [],
          presets: CHARACTER_PRESETS,
        },
        200,
        guest.setCookieHeader,
      );
    }

    return withGuestCookie(
      {
        campaignId: latest.campaignId,
        sessionId: latest.sessionId,
        sessionNumber: latest.sessionNumber,
        title: latest.title,
        ruleset: latest.ruleset,
        worldSummary: latest.worldSummary,
        state: latest.state,
        logHeadSeq: latest.logHeadSeq,
        events: latest.events,
        messages: latest.messages,
        sessionSummaries: latest.sessionSummaries,
        memoryFacts: latest.memoryFacts,
        presets: CHARACTER_PRESETS,
      },
      200,
      guest.setCookieHeader,
    );
  } catch (err) {
    return serverErrorResponse({
      route: "/api/game/campaigns",
      err,
      publicMessageEs: "Error interno al consultar la campaña.",
      status: 500,
      errorCode: "STORE_ERROR",
      setCookieHeader: guest.setCookieHeader,
      guestIdHash,
    });
  }
}

const CreateCampaignBodySchema = z.object({
  presetId: z.enum(["pc_kael", "pc_brenna", "pc_lira"]).default("pc_kael"),
  mode: z.enum(["digital", "hybrid"]).default("digital"),
  ruleset: z.enum(["5e-lite", "5e-full"]).default("5e-lite"),
  title: z.string().min(1).max(80).optional(),
});

export async function POST(req: Request) {
  let guest;
  try {
    guest = resolveGuestSessionFromRequest(req);
  } catch (err) {
    return serverErrorResponse({
      route: "/api/game/campaigns",
      err,
      publicMessageEs: "Error interno al verificar la sesión.",
      status: 500,
      errorCode: "SESSION_ERROR",
    });
  }

  let body: unknown = {};
  try {
    body = await req.json();
  } catch {
    // Allow empty body with defaults
  }

  const parsed = CreateCampaignBodySchema.safeParse(body);
  if (!parsed.success) {
    return withGuestCookie(
      {
        error: "Parámetros inválidos al crear campaña.",
        code: "INVALID_INPUT",
      },
      400,
      guest.setCookieHeader,
    );
  }

  const guestIdHash = hashGuestId(guest.guestId);
  try {
    const store = getDefaultGameStore();
    const created = await store.createCampaign({
      guestId: guest.guestId,
      presetId: parsed.data.presetId,
      mode: parsed.data.mode,
      ruleset: parsed.data.ruleset,
      title: parsed.data.title,
    });

    return withGuestCookie(
      {
        campaignId: created.campaignId,
        sessionId: created.sessionId,
        sessionNumber: created.sessionNumber,
        title: created.title,
        ruleset: created.ruleset,
        worldSummary: created.worldSummary,
        state: created.state,
        logHeadSeq: created.logHeadSeq,
        events: created.events,
        messages: created.messages,
        sessionSummaries: created.sessionSummaries,
        memoryFacts: created.memoryFacts,
        presets: CHARACTER_PRESETS,
      },
      201,
      guest.setCookieHeader,
    );
  } catch (err) {
    return serverErrorResponse({
      route: "/api/game/campaigns",
      err,
      publicMessageEs: "Error interno al crear la campaña.",
      status: 500,
      errorCode: "STORE_ERROR",
      setCookieHeader: guest.setCookieHeader,
      guestIdHash,
    });
  }
}
