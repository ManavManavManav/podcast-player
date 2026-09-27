import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

/** Liveness, for uptime checks: the server is running. No sign-in, no details. */
export async function GET() {
  return NextResponse.json({ ok: true }, { headers: { "Cache-Control": "no-store" } });
}
