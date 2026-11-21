import { randomUUID } from "node:crypto";
import { declareCheck } from "@dungeons/rules";
import { z } from "zod";

import { resolveGuestSessionFromRequest } from "@/lib/auth/guest-session";
import { commitEventWithRetry } from "@/lib/game/operations";
import { getDefaultGameStore, isStaleSeqError } from "@/lib/game/store";
import { serverErrorResponse } from "@/lib/http/errors";
import { hashGuestId } from "@/lib/observability/logger";

export const runtime = "nodejs";

const DeclareCheckHttpSchema = z.object({
  campaignId: z.string().min(1),
  sceneId: z.string().min(1),
  actorId: z.string().min(1),
  skill: z.string().min(1),
  dc: z.number().int().min(1).max(40).optional(),
  dcRef: z.string().min(1).optional(),
  declaredTotal: z.number().int().optional(),
  dieResults: z.array(z.number()),
  mode: z.enum(["normal", "advantage", "disadvantage"]).optional(),
  checkId: z.string().min(1).optional(),
});

export async function POST(req: Request) {
  let guest;
  try {
    guest = resolveGuestSessionFromRequest(req);
  } catch (err) {
    return serverErrorResponse({
      route: "/api/game/declare-check",
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

  const parsed = DeclareCheckHttpSchema.safeParse(body);
  if (!parsed.success) {
    return Response.json(
      {
        ok: false,
        code: "INVALID_INPUT",
        messageEs: "Faltan datos válidos para validar la tirada física.",
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

    const actor = loaded.state.characters[parsed.data.actorId];
    if (actor?.rollAuthority === "engine-rolled") {
      return Response.json(
        {
          ok: false,
          code: "WRONG_MODE",
          messageEs:
            "Este personaje usa tiradas del motor: usá resolve_check en lugar de declare_check.",
        },
        { status: 422 },
      );
    }

    const {
      sceneId,
      actorId,
      skill,
      dc,
      dcRef,
      declaredTotal,
      dieResults,
      mode,
      checkId,
    } = parsed.data;
    const checkInput = {
      sceneId,
      actorId,
      skill,
      dc,
      dcRef,
      declaredTotal,
      dieResults,
      mode,
      checkId,
    };

    const result = declareCheck(loaded.state, checkInput, {
      rng: {
        next: () => 0.5,
        nextInt: (min) => min,
      },
      createId: () => randomUUID(),
      now: () => new Date().toISOString(),
    });

    if (!result.ok) {
      return Response.json(
        {
          ok: false,
          code: result.code,
          messageEs: result.messageEs,
          expectedRange: result.expectedRange,
        },
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

    const headers = new Headers();
    if (guest.setCookieHeader) {
      headers.set("Set-Cookie", guest.setCookieHeader);
    }

    return Response.json(
      {
        ok: true,
        result: {
          ok: true,
          code: "OK",
          checkId: result.checkId,
          skill: checkInput.skill,
          dc: result.dc,
          dcRef: checkInput.dcRef,
          declaredTotal: result.event.declaredTotal ?? result.total,
          dieResults: checkInput.dieResults,
          naturalRoll: result.naturalRoll,
          expectedModifier: result.expectedModifier,
          success: result.success,
          margin: result.margin,
        },
        state: authoritativeState,
        event: result.event,
      },
      { status: 200, headers },
    );
  } catch (err) {
    return serverErrorResponse({
      route: "/api/game/declare-check",
      err,
      publicMessageEs: "Error interno al validar la tirada física.",
      status: 500,
      errorCode: "DECLARE_CHECK_ERROR",
      setCookieHeader: guest.setCookieHeader,
      guestIdHash,
    });
  }
}
