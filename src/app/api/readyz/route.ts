import { NextResponse } from "next/server";
import { getDb } from "@/lib/server/db";
import { log } from "@/lib/server/log";

export const dynamic = "force-dynamic";

const TIMEOUT_MS = 3_000;

/**
 * Readiness, for uptime checks and deploys: the database answers. No
 * sign-in; failures say only which part is down (the reason goes to the log).
 */
export async function GET() {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    await Promise.race([
      getDb().then((db) => db.execute("SELECT 1")),
      new Promise((_, reject) => {
        timer = setTimeout(() => reject(new Error(`No answer within ${TIMEOUT_MS} ms`)), TIMEOUT_MS);
      }),
    ]);
    return NextResponse.json({ ok: true, database: "ok" }, { headers: { "Cache-Control": "no-store" } });
  } catch (err) {
    log.error("readyz.database", { err });
    return NextResponse.json({ ok: false, database: "unavailable" }, { status: 503, headers: { "Cache-Control": "no-store" } });
  } finally {
    clearTimeout(timer);
  }
}
