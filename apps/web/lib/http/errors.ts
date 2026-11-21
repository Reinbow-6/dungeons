import { randomUUID } from "node:crypto";

import { logServerEvent } from "@/lib/observability/logger";

export function createCorrelationId(): string {
  return randomUUID().slice(0, 12);
}

/**
 * Logs full error details server-side with `correlationId` and returns a safe
 * generic Spanish message to the client (never leaking raw `err.message`).
 */
export function serverErrorResponse(params: {
  route: string;
  err: unknown;
  publicMessageEs: string;
  status?: number;
  errorCode?: string;
  setCookieHeader?: string | null;
  correlationId?: string;
  guestIdHash?: string;
}): Response {
  const correlationId = params.correlationId ?? createCorrelationId();
  const status = params.status ?? 500;
  const detail =
    params.err instanceof Error
      ? `${params.err.name}: ${params.err.message}`
      : String(params.err);

  logServerEvent({
    level: "error",
    requestId: correlationId,
    route: params.route,
    event: "request_error",
    status,
    errorCode: params.errorCode ?? "INTERNAL_ERROR",
    guestIdHash: params.guestIdHash,
    detail,
  });

  const headers = new Headers();
  if (params.setCookieHeader) {
    headers.set("Set-Cookie", params.setCookieHeader);
  }

  return Response.json(
    {
      ok: false,
      error: params.publicMessageEs,
      messageEs: params.publicMessageEs,
      code: params.errorCode ?? "INTERNAL_ERROR",
      correlationId,
    },
    { status, headers },
  );
}
