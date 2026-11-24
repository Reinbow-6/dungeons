import { randomUUID } from "node:crypto";
import {
  addPartyMember,
  createRng,
  removePartyMember,
} from "@dungeons/rules";
import { z } from "zod";

import { extractDeterministicFactsFromEvent } from "@/agent/subagents/memory/agent";
import { resolveGuestSessionFromRequest } from "@/lib/auth/guest-session";
import { commitEventWithRetry } from "@/lib/game/operations";
import { createPresetCharacter } from "@/lib/game/presets";
import { getDefaultGameStore, isStaleSeqError } from "@/lib/game/store";
import { serverErrorResponse } from "@/lib/http/errors";
import { hashGuestId } from "@/lib/observability/logger";

export const runtime = "nodejs";

const AddMemberBodySchema = z.object({
  campaignId: z.string().min(1),
  presetId: z.enum([
    "pc_kael",
    "pc_brenna",
    "pc_lira",
    "pc_seraphina",
    "pc_theron",
  ]),
  playerName: z.string().trim().max(40).optional(),
});

const RemoveMemberBodySchema = z.object({
  campaignId: z.string().min(1),
  actorId: z.string().min(1),
  reason: z.string().trim().max(160).optional(),
});

export async function POST(req: Request) {
  let guest;
  try {
    guest = resolveGuestSessionFromRequest(req);
  } catch (err) {
    return serverErrorResponse({
      route: "/api/game/party",
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

  const parsed = AddMemberBodySchema.safeParse(body);
  if (!parsed.success) {
    return Response.json(
      {
        ok: false,
        code: "INVALID_INPUT",
        messageEs: "Datos inválidos para sumar personaje a la mesa.",
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
          messageEs: "Campaña no encontrada para esta sesión.",
        },
        { status: 404 },
      );
    }

    const firstChar = Object.values(loaded.state.characters)[0];
    const tableMode =
      firstChar?.rollAuthority === "player-declared" ? "hybrid" : "digital";
    const character = createPresetCharacter(parsed.data.presetId, tableMode, {
      playerName: parsed.data.playerName,
    });

    const result = addPartyMember(
      loaded.state,
      { character },
      {
        rng: createRng(randomUUID()),
        createId: () => randomUUID(),
        now: () => new Date().toISOString(),
      },
    );

    if (!result.ok) {
      return Response.json(
        { ok: false, code: result.code, messageEs: result.messageEs },
        { status: 422 },
      );
    }

    let authoritativeState = result.nextState;
    try {
      const outcome = await commitEventWithRetry({
        store,
        campaignId: loaded.campaignId,
        sessionId: loaded.sessionId,
        guestId: guest.guestId,
        event: result.event,
        nextState: result.nextState,
        expectedSeq: loaded.logHeadSeq,
      });
      if (outcome.reloaded) {
        authoritativeState = outcome.state;
      }
    } catch (err) {
      if (isStaleSeqError(err)) {
        return Response.json(
          {
            ok: false,
            code: "STALE_SEQ",
            messageEs:
              "La campaña cambió en paralelo. Recargá el estado e intentá nuevamente.",
          },
          { status: 409 },
        );
      }
      throw err;
    }

    const derived = extractDeterministicFactsFromEvent(
      result.event,
      authoritativeState,
    );
    if (derived.length > 0) {
      try {
        await store.saveMemoryFacts(
          loaded.campaignId,
          loaded.sessionId,
          derived,
        );
      } catch {
        // Non-fatal memory write
      }
    }

    const headers = new Headers();
    if (guest.setCookieHeader) {
      headers.set("Set-Cookie", guest.setCookieHeader);
    }

    return Response.json(
      { ok: true, state: authoritativeState, event: result.event },
      { status: 200, headers },
    );
  } catch (err) {
    return serverErrorResponse({
      route: "/api/game/party",
      err,
      publicMessageEs: "Error interno al sumar personaje al grupo.",
      status: 500,
      errorCode: "PARTY_ADD_ERROR",
      setCookieHeader: guest.setCookieHeader,
      guestIdHash,
    });
  }
}

export async function DELETE(req: Request) {
  let guest;
  try {
    guest = resolveGuestSessionFromRequest(req);
  } catch (err) {
    return serverErrorResponse({
      route: "/api/game/party",
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

  const parsed = RemoveMemberBodySchema.safeParse(body);
  if (!parsed.success) {
    return Response.json(
      {
        ok: false,
        code: "INVALID_INPUT",
        messageEs: "Datos inválidos para retirar personaje de la mesa.",
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
          messageEs: "Campaña no encontrada para esta sesión.",
        },
        { status: 404 },
      );
    }

    const result = removePartyMember(
      loaded.state,
      {
        actorId: parsed.data.actorId,
        ...(parsed.data.reason ? { reason: parsed.data.reason } : {}),
      },
      {
        rng: createRng(randomUUID()),
        createId: () => randomUUID(),
        now: () => new Date().toISOString(),
      },
    );

    if (!result.ok) {
      return Response.json(
        { ok: false, code: result.code, messageEs: result.messageEs },
        { status: 422 },
      );
    }

    let authoritativeState = result.nextState;
    try {
      const outcome = await commitEventWithRetry({
        store,
        campaignId: loaded.campaignId,
        sessionId: loaded.sessionId,
        guestId: guest.guestId,
        event: result.event,
        nextState: result.nextState,
        expectedSeq: loaded.logHeadSeq,
      });
      if (outcome.reloaded) {
        authoritativeState = outcome.state;
      }
    } catch (err) {
      if (isStaleSeqError(err)) {
        return Response.json(
          {
            ok: false,
            code: "STALE_SEQ",
            messageEs:
              "La campaña cambió en paralelo. Recargá el estado e intentá nuevamente.",
          },
          { status: 409 },
        );
      }
      throw err;
    }

    const derived = extractDeterministicFactsFromEvent(
      result.event,
      authoritativeState,
    );
    if (derived.length > 0) {
      try {
        await store.saveMemoryFacts(
          loaded.campaignId,
          loaded.sessionId,
          derived,
        );
      } catch {
        // Non-fatal memory write
      }
    }

    const headers = new Headers();
    if (guest.setCookieHeader) {
      headers.set("Set-Cookie", guest.setCookieHeader);
    }

    return Response.json(
      { ok: true, state: authoritativeState, event: result.event },
      { status: 200, headers },
    );
  } catch (err) {
    return serverErrorResponse({
      route: "/api/game/party",
      err,
      publicMessageEs: "Error interno al retirar personaje del grupo.",
      status: 500,
      errorCode: "PARTY_REMOVE_ERROR",
      setCookieHeader: guest.setCookieHeader,
      guestIdHash,
    });
  }
}
