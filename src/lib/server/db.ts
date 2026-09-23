import fs from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";

/**
 * The app's SQLite database (accounts, sessions, per-user settings), using
 * Node's built-in driver so there's nothing native to compile.
 */
export const DATA_DIR = process.env.PODBLOCK_DATA_DIR || path.join(process.cwd(), ".data");

function open() {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  // Wait instead of failing if another connection holds a write lock.
  const db = new DatabaseSync(path.join(DATA_DIR, "podblock.db"), { timeout: 5000 });
  db.exec("PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON;");
  db.exec(`
    CREATE TABLE IF NOT EXISTS user_settings (
      user_id TEXT PRIMARY KEY,
      detector TEXT NOT NULL DEFAULT 'heuristic',
      glm_model TEXT,
      claude_model TEXT,
      zai_key TEXT,
      anthropic_key TEXT,
      updated_at INTEGER NOT NULL
    )
  `);
  return db;
}

/**
 * One connection per server process, surviving dev-mode module reloads.
 * Opened on first use rather than on import, so `next build` (which imports
 * routes in parallel workers) never touches the database.
 */
const globalForDb = globalThis as unknown as { __podblockDb?: DatabaseSync };
export function getDb(): DatabaseSync {
  return (globalForDb.__podblockDb ??= open());
}
