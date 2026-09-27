import { createHash } from "node:crypto";
import type { Client } from "@libsql/client";
import type { BetterAuthOptions } from "better-auth";
import { getSchema } from "better-auth/db";
import { getMigrations } from "better-auth/db/migration";
import { log } from "@/lib/server/log";

/**
 * The database schema, versioned. A new server instance checks one row per
 * part (the app's tables, Better Auth's tables) and changes nothing unless
 * it's behind; `npm run migrate` does the same thing explicitly, e.g. before
 * a deploy.
 */

/** The app's own tables. Append a step to change them; never edit a past one. */
export const APP_MIGRATIONS: ReadonlyArray<readonly string[]> = [
  [
    // One transcribed window of an episode (episode time, seconds).
    `CREATE TABLE IF NOT EXISTS analysis_window (
      url_key TEXT NOT NULL,
      start INTEGER NOT NULL,
      url TEXT NOT NULL,
      segments TEXT NOT NULL,
      created_at INTEGER NOT NULL,
      PRIMARY KEY (url_key, start)
    )`,
    // A detector's ads for one window. Keyed by model and prompt version, so
    // changing either redoes the work instead of reusing stale verdicts.
    `CREATE TABLE IF NOT EXISTS analysis_verdict (
      url_key TEXT NOT NULL,
      start INTEGER NOT NULL,
      detector TEXT NOT NULL,
      ads TEXT NOT NULL,
      created_at INTEGER NOT NULL,
      PRIMARY KEY (url_key, start, detector)
    )`,
    // Paid API work, per user per month, for the admin page.
    `CREATE TABLE IF NOT EXISTS usage (
      user_id TEXT NOT NULL,
      month TEXT NOT NULL,
      audio_seconds REAL NOT NULL DEFAULT 0,
      detect_calls INTEGER NOT NULL DEFAULT 0,
      input_tokens INTEGER NOT NULL DEFAULT 0,
      output_tokens INTEGER NOT NULL DEFAULT 0,
      PRIMARY KEY (user_id, month)
    )`,
  ],
  // Left behind by the version that stored users' own API keys.
  [`DROP TABLE IF EXISTS user_settings`],
];

const VERSION_TABLE = `CREATE TABLE IF NOT EXISTS schema_version (
  part TEXT PRIMARY KEY,
  version TEXT NOT NULL,
  migrated_at INTEGER NOT NULL
)`;

async function storedVersion(db: Client, part: "app" | "auth"): Promise<string | null> {
  try {
    const { rows } = await db.execute({ sql: "SELECT version FROM schema_version WHERE part = ?", args: [part] });
    return rows.length ? String(rows[0].version) : null;
  } catch {
    return null; // No version table yet: a new database, or one from before versioning.
  }
}

async function recordVersion(db: Client, part: "app" | "auth", version: string) {
  await db.batch(
    [
      VERSION_TABLE,
      {
        sql: `INSERT INTO schema_version (part, version, migrated_at) VALUES (?, ?, ?)
              ON CONFLICT(part) DO UPDATE SET version = excluded.version, migrated_at = excluded.migrated_at`,
        args: [part, version, Date.now()],
      },
    ],
    "write",
  );
}

/** Brings the app's tables up to date. Returns whether anything ran. */
export async function ensureAppSchema(db: Client): Promise<boolean> {
  const current = Number((await storedVersion(db, "app")) ?? 0);
  if (current >= APP_MIGRATIONS.length) return false;
  // Every step is idempotent, so two instances starting at once is harmless.
  for (let step = current; step < APP_MIGRATIONS.length; step++) {
    await db.batch([...APP_MIGRATIONS[step]], "write");
  }
  await recordVersion(db, "app", String(APP_MIGRATIONS.length));
  log.info("schema.migrated", { part: "app", from: current, to: APP_MIGRATIONS.length });
  return true;
}

/** Identifies Better Auth's expected tables for these options (plugins and settings add tables and columns). */
export function authSchemaFingerprint(options: BetterAuthOptions): string {
  return createHash("sha256").update(JSON.stringify(getSchema(options))).digest("hex").slice(0, 16);
}

/** Brings Better Auth's tables up to date when its expected schema has changed. Returns whether anything ran. */
export async function ensureAuthSchema(db: Client, options: BetterAuthOptions): Promise<boolean> {
  const fingerprint = authSchemaFingerprint(options);
  if ((await storedVersion(db, "auth")) === fingerprint) return false;
  const { runMigrations } = await getMigrations(options);
  await runMigrations();
  await recordVersion(db, "auth", fingerprint);
  log.info("schema.migrated", { part: "auth", fingerprint });
  return true;
}
