import fs from "node:fs";
import path from "node:path";
import { createClient, type Client } from "@libsql/client";
import { ensureAppSchema } from "@/lib/server/migrations";

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


/**
 * One client per server process, surviving dev-mode module reloads. Created
 * on first use rather than on import, so `next build` never connects. The
 * app's tables are brought up to date first (a single read when they are).
 */
const globalForDb = globalThis as unknown as { __podblockDb?: Promise<Client> };
export function getDb(): Promise<Client> {
  if (!globalForDb.__podblockDb) {
    globalForDb.__podblockDb = (async () => {
      const client = createClient(databaseConfig());
      await ensureAppSchema(client);
      return client;
    })().catch((err) => {
      globalForDb.__podblockDb = undefined;
      throw err;
    });
  }
  return globalForDb.__podblockDb;
}
