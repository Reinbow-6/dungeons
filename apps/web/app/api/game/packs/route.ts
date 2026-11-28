import {
  AdventurePackSchema,
  validateAdventurePackGraph,
} from "@dungeons/rules";
import { z } from "zod";

import { resolveGuestSessionFromRequest } from "@/lib/auth/guest-session";
import { isBuiltinAdventurePack } from "@/lib/game/adventure-packs";
import { getDefaultGameStore } from "@/lib/game/store";
import { serverErrorResponse } from "@/lib/http/errors";
import { hashGuestId } from "@/lib/observability/logger";

export const runtime = "nodejs";

const MAX_PACK_BYTES = 2 * 1024 * 1024; // 2 MB

const DeletePackQuerySchema = z.object({
  slug: z.string().min(1).max(64),
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

export async function GET(req: Request) {
  let guest;
  try {
    guest = resolveGuestSessionFromRequest(req);
  } catch (err) {
    return serverErrorResponse({
      route: "/api/game/packs",
      err,
      publicMessageEs: "Error interno al verificar la sesión.",
      status: 500,
      errorCode: "SESSION_ERROR",
    });
  }

  const guestIdHash = hashGuestId(guest.guestId);
  try {
    const store = getDefaultGameStore();
    const items = await store.listAdventurePacks(guest.guestId);
    return withGuestCookie({ ok: true, items }, 200, guest.setCookieHeader);
  } catch (err) {
    return serverErrorResponse({
      route: "/api/game/packs",
      err,
      publicMessageEs: "Error interno al listar packs de aventura.",
      status: 500,
      errorCode: "STORE_ERROR",
      setCookieHeader: guest.setCookieHeader,
      guestIdHash,
    });
  }
}

export async function POST(req: Request) {
  let guest;
  try {
    guest = resolveGuestSessionFromRequest(req);
  } catch (err) {
    return serverErrorResponse({
      route: "/api/game/packs",
      err,
      publicMessageEs: "Error interno al verificar la sesión.",
      status: 500,
      errorCode: "SESSION_ERROR",
    });
  }

  let rawText: string;
  try {
    rawText = await req.text();
  } catch {
    return withGuestCookie(
      { ok: false, code: "INVALID_BODY", messageEs: "No se pudo leer el archivo." },
      400,
      guest.setCookieHeader,
    );
  }

  if (Buffer.byteLength(rawText, "utf8") > MAX_PACK_BYTES) {
    return withGuestCookie(
      {
        ok: false,
        code: "PACK_TOO_LARGE",
        messageEs: "El pack JSON supera el límite permitido de 2 MB.",
      },
      413,
      guest.setCookieHeader,
    );
  }

  let body: unknown;
  try {
    body = JSON.parse(rawText);
  } catch {
    return withGuestCookie(
      { ok: false, code: "INVALID_JSON", messageEs: "Archivo JSON inválido." },
      400,
      guest.setCookieHeader,
    );
  }

  const candidate =
    body &&
    typeof body === "object" &&
    !Array.isArray(body) &&
    "pack" in body &&
    !("scenes" in body)
      ? (body as { pack: unknown }).pack
      : body;

  const parsed = AdventurePackSchema.safeParse(candidate);
  if (!parsed.success) {
    const errors = parsed.error.issues
      .slice(0, 8)
      .map((issue) => `${issue.path.join(".") || "pack"}: ${issue.message}`);
    return withGuestCookie(
      {
        ok: false,
        code: "INVALID_PACK_SCHEMA",
        messageEs: "El JSON no cumple el esquema AdventurePack v1.",
        errors,
      },
      400,
      guest.setCookieHeader,
    );
  }

  if (isBuiltinAdventurePack(parsed.data.id)) {
    return withGuestCookie(
      {
        ok: false,
        code: "BUILTIN_ID_CONFLICT",
        messageEs: `El slug "${parsed.data.id}" está reservado para una campaña integrada. Usá otro id.`,
        errors: [`ID reservado: "${parsed.data.id}"`],
      },
      400,
      guest.setCookieHeader,
    );
  }

  const graphCheck = validateAdventurePackGraph(parsed.data);
  if (!graphCheck.valid) {
    return withGuestCookie(
      {
        ok: false,
        code: "INVALID_PACK_GRAPH",
        messageEs: "El grafo de escenas o pistas tiene referencias inválidas.",
        errors: graphCheck.errors,
        warnings: graphCheck.warnings,
      },
      400,
      guest.setCookieHeader,
    );
  }

  const guestIdHash = hashGuestId(guest.guestId);
  try {
    const store = getDefaultGameStore();
    const summary = await store.upsertAdventurePack(guest.guestId, parsed.data);
    return withGuestCookie(
      {
        ok: true,
        pack: summary,
        warnings: graphCheck.warnings,
        stats: graphCheck.stats,
      },
      200,
      guest.setCookieHeader,
    );
  } catch (err) {
    return serverErrorResponse({
      route: "/api/game/packs",
      err,
      publicMessageEs: "Error interno al guardar el pack de aventura.",
      status: 500,
      errorCode: "STORE_ERROR",
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
      route: "/api/game/packs",
      err,
      publicMessageEs: "Error interno al verificar la sesión.",
      status: 500,
      errorCode: "SESSION_ERROR",
    });
  }

  const url = new URL(req.url);
  const parsed = DeletePackQuerySchema.safeParse({
    slug: url.searchParams.get("slug") ?? "",
  });
  if (!parsed.success) {
    return withGuestCookie(
      {
        ok: false,
        code: "INVALID_INPUT",
        messageEs: "Indicá ?slug=... del pack a eliminar.",
      },
      400,
      guest.setCookieHeader,
    );
  }

  if (isBuiltinAdventurePack(parsed.data.slug)) {
    return withGuestCookie(
      {
        ok: false,
        code: "CANNOT_DELETE_BUILTIN",
        messageEs: "No se puede borrar una aventura integrada.",
      },
      400,
      guest.setCookieHeader,
    );
  }

  const guestIdHash = hashGuestId(guest.guestId);
  try {
    const store = getDefaultGameStore();
    const deleted = await store.deleteAdventurePack(
      parsed.data.slug,
      guest.guestId,
    );
    if (!deleted) {
      return withGuestCookie(
        {
          ok: false,
          code: "PACK_NOT_FOUND",
          messageEs: "Pack de aventura no encontrado para esta sesión.",
        },
        404,
        guest.setCookieHeader,
      );
    }
    return withGuestCookie(
      { ok: true, deletedSlug: parsed.data.slug },
      200,
      guest.setCookieHeader,
    );
  } catch (err) {
    return serverErrorResponse({
      route: "/api/game/packs",
      err,
      publicMessageEs: "Error interno al eliminar el pack.",
      status: 500,
      errorCode: "STORE_ERROR",
      setCookieHeader: guest.setCookieHeader,
      guestIdHash,
    });
  }
}
