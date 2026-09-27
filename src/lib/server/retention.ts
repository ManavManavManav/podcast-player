import { getDb } from "@/lib/server/db";
import { log } from "@/lib/server/log";

/** How long transcripts and ad verdicts are kept (a replay after that pays again). */
export const RETENTION_DAYS = 30;
/** Rate-limit counters only matter for seconds; a day is plenty. */
const RATE_LIMIT_KEEP_MS = 86_400_000;

/**
 * Deletes analysis older than RETENTION_DAYS, verdicts and envelopes left
 * without their transcript, and expired sessions, verifications and rate-limit counters.
 * Run daily (Vercel Cron → /api/cron/cleanup); safe to run any time.
 */
export async function cleanupOldData(now = Date.now()) {
  const db = await getDb();
  const cutoff = now - RETENTION_DAYS * 86_400_000;
  // Better Auth stores dates as ISO-8601 text, which compares correctly as strings.
  const nowIso = new Date(now).toISOString();
  const [windows, verdicts, orphans, , , sessions, verifications, rateLimits] = await db.batch(
    [
      { sql: "DELETE FROM analysis_window WHERE created_at < ?", args: [cutoff] },
      { sql: "DELETE FROM analysis_verdict WHERE created_at < ?", args: [cutoff] },
      `DELETE FROM analysis_verdict WHERE NOT EXISTS (
         SELECT 1 FROM analysis_window w WHERE w.url_key = analysis_verdict.url_key AND w.start = analysis_verdict.start)`,
      // Envelopes go with their window's transcript.
      { sql: "DELETE FROM analysis_envelope WHERE created_at < ?", args: [cutoff] },
      `DELETE FROM analysis_envelope WHERE NOT EXISTS (
         SELECT 1 FROM analysis_window w WHERE w.url_key = analysis_envelope.url_key AND w.start = analysis_envelope.start)`,
      { sql: `DELETE FROM session WHERE "expiresAt" < ?`, args: [nowIso] },
      { sql: `DELETE FROM verification WHERE "expiresAt" < ?`, args: [nowIso] },
      { sql: `DELETE FROM "rateLimit" WHERE "lastRequest" < ?`, args: [now - RATE_LIMIT_KEEP_MS] },
    ],
    "write",
  );
  const removed = {
    windows: windows.rowsAffected,
    verdicts: verdicts.rowsAffected + orphans.rowsAffected,
    sessions: sessions.rowsAffected,
    verifications: verifications.rowsAffected,
    rateLimits: rateLimits.rowsAffected,
  };
  log.info("retention.cleanup", { retentionDays: RETENTION_DAYS, ...removed });
  return removed;
}
