import { createHash, timingSafeEqual } from "node:crypto";
import { NextResponse } from "next/server";
import { log } from "@/lib/server/log";
import { cleanupOldData } from "@/lib/server/retention";

export const dynamic = "force-dynamic";

const digest = (value: string) => createHash("sha256").update(value).digest();

/** Daily cleanup, called by Vercel Cron (vercel.json), which sends `Authorization: Bearer $CRON_SECRET`. */
export async function GET(req: Request) {
  const secret = process.env.CRON_SECRET ?? "";
  if (!secret) {
    log.warn("retention.not_configured", { message: "CRON_SECRET isn't set, so the daily cleanup can't run." });
    return NextResponse.json({ error: "Not configured" }, { status: 503 });
  }
  const given = req.headers.get("authorization") ?? "";
  if (!timingSafeEqual(digest(given), digest(`Bearer ${secret}`))) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  return NextResponse.json({ ok: true, removed: await cleanupOldData() });
}
