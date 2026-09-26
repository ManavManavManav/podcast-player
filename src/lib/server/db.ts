import fs from "node:fs";
import path from "node:path";
import { createClient, type Client } from "@libsql/client";

/**
 * The app's database (accounts, sessions, analysis cache, usage), via libSQL:
 * a local SQLite file in development, a hosted Turso database in production
 * (Vercel's filesystem doesn't persist between requests).
 */
export const DATA_DIR = process.env.PODBLOCK_DATA_DIR || path.join(process.cwd(), ".data");

export function databaseConfig(): { url: string; authToken?: string } {
  const url = process.env.DATABASE_URL;
  if (url) return { url, authToken: process.env.DATABASE_AUTH_TOKEN || undefined };
  if (process.env.VERCEL) {
    throw new Error("DATABASE_URL is not set. On Vercel, point it at a hosted database such as Turso.");
  }
  fs.mkdirSync(DATA_DIR, { recursive: true });
  return { url: `file:${path.join(DATA_DIR, "podblock.db")}` };
}

const SCHEMA = [
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
];

/**
 * One client per server process, surviving dev-mode module reloads. Created
 * on first use rather than on import, so `next build` never connects.
 */
const globalForDb = globalThis as unknown as { __podblockDb?: Promise<Client> };
export function getDb(): Promise<Client> {
  if (!globalForDb.__podblockDb) {
    globalForDb.__podblockDb = (async () => {
      const client = createClient(databaseConfig());
      await client.batch(SCHEMA, "write");
      return client;
    })().catch((err) => {
      globalForDb.__podblockDb = undefined;
      throw err;
    });
  }
  return globalForDb.__podblockDb;
}
