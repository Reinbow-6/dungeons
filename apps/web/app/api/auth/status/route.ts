import { NextResponse } from "next/server";

import { resolveRequestAccess } from "@/lib/auth/whitelist";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(req: Request) {
  const access = await resolveRequestAccess(req);

  return NextResponse.json(access, {
    status: 200,
    headers: {
      "Cache-Control": "no-store",
    },
  });
}
