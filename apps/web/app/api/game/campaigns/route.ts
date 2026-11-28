import { z } from "zod";

import { resolveGuestSessionFromRequest } from "@/lib/auth/guest-session";
import { getFallbackAdventurePack } from "@/lib/game/adventure-packs";
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
          adventureId: loaded.adventureId,
          adventurePack: loaded.adventurePack ?? getFallbackAdventurePack(),
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
          adventureId: null,
          adventurePack: null,
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
        adventureId: latest.adventureId,
        adventurePack: latest.adventurePack ?? getFallbackAdventurePack(),
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

const PresetIdSchema = z.enum([
  "pc_kael",
  "pc_brenna",
  "pc_lira",
  "pc_seraphina",
  "pc_theron",
]);

const CreateCampaignBodySchema = z.object({
  adventureId: z.string().trim().min(1).max(80).optional(),
  presetId: PresetIdSchema.default("pc_kael"),
  party: z
    .array(
      z.object({
        presetId: PresetIdSchema,
        playerName: z.string().trim().max(40).optional(),
      }),
    )
    .min(1)
    .max(4)
    .optional(),
  mode: z.enum(["digital", "hybrid"]).default("digital"),
  ruleset: z.enum(["5e-lite", "5e-full"]).optional(),
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

  if (parsed.data.party) {
    const uniqueIds = new Set(parsed.data.party.map((m) => m.presetId));
    if (uniqueIds.size !== parsed.data.party.length) {
      return withGuestCookie(
        {
          error: "No podés repetir el mismo personaje dentro de la mesa local.",
          code: "INVALID_INPUT",
        },
        400,
        guest.setCookieHeader,
      );
    }
  }

  const guestIdHash = hashGuestId(guest.guestId);
  try {
    const store = getDefaultGameStore();
    if (parsed.data.adventureId) {
      const resolvedPack = await store.getAdventurePack(
        parsed.data.adventureId,
        guest.guestId,
      );
      if (!resolvedPack) {
        return withGuestCookie(
          {
            error: "Módulo de aventura no encontrado.",
            code: "ADVENTURE_PACK_NOT_FOUND",
          },
          404,
          guest.setCookieHeader,
        );
      }
    }

    const created = await store.createCampaign({
      guestId: guest.guestId,
      adventureId: parsed.data.adventureId,
      presetId: parsed.data.presetId,
      party: parsed.data.party,
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
        adventureId: created.adventureId,
        adventurePack: created.adventurePack ?? getFallbackAdventurePack(),
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

const DeleteCampaignBodySchema = z.object({
  campaignId: z.string().trim().optional(),
  all: z.boolean().optional(),
  exceptCampaignId: z.string().trim().nullish(),
});

function invalidDeleteResponse(setCookieHeader: string | null): Response {
  return withGuestCookie(
    {
      ok: false,
      code: "INVALID_DELETE_REQUEST",
      error: "Debés indicar campaignId o all=1 para borrar partidas.",
      messageEs: "Debés indicar campaignId o all=1 para borrar partidas.",
    },
    400,
    setCookieHeader,
  );
}

export async function DELETE(req: Request) {
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

  const url = new URL(req.url);
  const hasQueryCampaignId = url.searchParams.has("campaignId");
  const queryCampaignId = url.searchParams.get("campaignId")?.trim() ?? "";
  if (hasQueryCampaignId && !queryCampaignId) {
    return invalidDeleteResponse(guest.setCookieHeader);
  }

  const queryAllParam = url.searchParams.get("all");
  let queryAll = false;
  if (queryAllParam !== null) {
    if (queryAllParam === "1" || queryAllParam === "true") {
      queryAll = true;
    } else if (queryAllParam === "0" || queryAllParam === "false") {
      queryAll = false;
    } else {
      return invalidDeleteResponse(guest.setCookieHeader);
    }
  }

  let rawBody: unknown = {};
  let bodyText = "";
  try {
    bodyText = await req.text();
  } catch {
    bodyText = "";
  }
  if (bodyText.trim().length > 0) {
    try {
      rawBody = JSON.parse(bodyText);
    } catch {
      return invalidDeleteResponse(guest.setCookieHeader);
    }
  }

  const parsedBody = DeleteCampaignBodySchema.safeParse(rawBody);
  if (!parsedBody.success) {
    return invalidDeleteResponse(guest.setCookieHeader);
  }

  if (
    parsedBody.data.campaignId !== undefined &&
    parsedBody.data.campaignId.length === 0
  ) {
    return invalidDeleteResponse(guest.setCookieHeader);
  }

  const campaignId = queryCampaignId || parsedBody.data.campaignId || undefined;
  const deleteAll = queryAll || parsedBody.data.all === true;

  if ((campaignId && deleteAll) || (!campaignId && !deleteAll)) {
    return invalidDeleteResponse(guest.setCookieHeader);
  }

  const guestIdHash = hashGuestId(guest.guestId);
  try {
    const store = getDefaultGameStore();

    if (campaignId) {
      const deleted = await store.deleteCampaign(campaignId, guest.guestId);
      if (!deleted) {
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
          deletedCount: 1,
          deletedCampaignId: campaignId,
        },
        200,
        guest.setCookieHeader,
      );
    }

    const queryExcept = url.searchParams.get("exceptCampaignId")?.trim() || undefined;
    const bodyExcept = parsedBody.data.exceptCampaignId || undefined;
    const exceptCampaignId = queryExcept ?? bodyExcept;

    const deletedCount = await store.deleteAllCampaignsForGuest(
      guest.guestId,
      exceptCampaignId ? { exceptCampaignId } : undefined,
    );

    return withGuestCookie(
      {
        ok: true,
        deletedCount,
      },
      200,
      guest.setCookieHeader,
    );
  } catch (err) {
    return serverErrorResponse({
      route: "/api/game/campaigns",
      err,
      publicMessageEs: "Error interno al borrar la campaña.",
      status: 500,
      errorCode: "STORE_ERROR",
      setCookieHeader: guest.setCookieHeader,
      guestIdHash,
    });
  }
}
