import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createClient } from "@libsql/client";
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";

/** Every SQL statement sent through any libSQL client, to see what a cold start runs. */
const sql = vi.hoisted(() => ({ statements: [] as string[] }));
vi.mock("@libsql/client", async (importOriginal) => {
  const original = await importOriginal<typeof import("@libsql/client")>();
  const text = (s: unknown) => (typeof s === "string" ? s : String((s as { sql: string }).sql));
  return {
    ...original,
    createClient: (config: Parameters<typeof original.createClient>[0]) => {
      const client = original.createClient(config);
      const execute = client.execute.bind(client);
      const batch = client.batch.bind(client);
      const executeMultiple = client.executeMultiple.bind(client);
      const transaction = client.transaction.bind(client);
      return Object.assign(client, {
        execute: (s: never, ...rest: never[]) => (sql.statements.push(text(s)), execute(s, ...rest)),
        batch: (list: never[], ...rest: never[]) => (sql.statements.push(...list.map(text)), batch(list, ...rest)),
        executeMultiple: (s: string) => (sql.statements.push(s), executeMultiple(s)),
        transaction: async (...args: never[]) => {
          const tx = await transaction(...args);
          const txExecute = tx.execute.bind(tx);
          return Object.assign(tx, { execute: (s: never) => (sql.statements.push(text(s)), txExecute(s)) });
        },
      });
    },
  };
});

const dir = fs.mkdtempSync(path.join(os.tmpdir(), "podblock-migrations-"));
const dbFile = path.join(dir, "test.db");
vi.stubEnv("DATABASE_URL", `file:${dbFile}`);
vi.stubEnv("BETTER_AUTH_SECRET", "test-secret-test-secret-test-secret-test-secret");
vi.stubEnv("PODBLOCK_ADMIN_EMAIL", "owner@example.com");

const { getDb } = await import("@/lib/server/db");
const { getAuth } = await import("@/lib/server/auth");

/** Forgets the server's clients, as a new serverless instance would start without them. */
function coldStart() {
  const g = globalThis as { __podblockDb?: unknown; __podblockAuth?: unknown };
  g.__podblockDb = undefined;
  g.__podblockAuth = undefined;
}

async function tables(file = dbFile) {
  const client = createClient({ url: `file:${file}` });
  const { rows } = await client.execute("SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name");
  client.close();
  return rows.map((r) => String(r.name));
}

const SCHEMA_CHANGES = /^\s*(CREATE|ALTER|DROP)\b|PRAGMA/i;

beforeEach(() => {
  sql.statements = [];
});

afterAll(() => {
  vi.unstubAllEnvs();
  fs.rmSync(dir, { recursive: true, force: true });
});

describe("schema", () => {
  it("is created on a fresh database, on first use", async () => {
    await getAuth();
    expect(await tables()).toEqual(
      expect.arrayContaining(["account", "analysis_verdict", "analysis_window", "rateLimit", "schema_version", "session", "usage", "user", "verification"]),
    );
  });

  it("isn't touched on a cold start once it's up to date", async () => {
    coldStart();
    await getDb();
    await getAuth();
    expect(sql.statements.filter((s) => SCHEMA_CHANGES.test(s))).toEqual([]);
    // Checking the version, and making sure the owner is the admin.
    expect(sql.statements.length).toBeLessThanOrEqual(3);
  });

  it("brings a database from before versioning up to date, keeping its data", async () => {
    const oldFile = path.join(dir, "old.db");
    const old = createClient({ url: `file:${oldFile}` });
    await old.batch(
      [
        "CREATE TABLE usage (user_id TEXT NOT NULL, month TEXT NOT NULL, audio_seconds REAL NOT NULL DEFAULT 0, detect_calls INTEGER NOT NULL DEFAULT 0, input_tokens INTEGER NOT NULL DEFAULT 0, output_tokens INTEGER NOT NULL DEFAULT 0, PRIMARY KEY (user_id, month))",
        "INSERT INTO usage (user_id, month, audio_seconds) VALUES ('u1', '2026-09', 600)",
        // Left behind by the per-user API keys version.
        "CREATE TABLE user_settings (user_id TEXT PRIMARY KEY, settings TEXT)",
      ],
      "write",
    );
    old.close();

    vi.stubEnv("DATABASE_URL", `file:${oldFile}`);
    coldStart();
    await getAuth();
    const now = await tables(oldFile);
    expect(now).not.toContain("user_settings");
    expect(now).toEqual(expect.arrayContaining(["analysis_window", "user", "schema_version"]));
    const check = createClient({ url: `file:${oldFile}` });
    expect((await check.execute("SELECT audio_seconds FROM usage WHERE user_id = 'u1'")).rows[0].audio_seconds).toBe(600);
    check.close();
    vi.stubEnv("DATABASE_URL", `file:${dbFile}`);
  });
});

describe("npm run migrate", () => {
  it("migrates, and does nothing the second time", () => {
    const file = path.join(dir, "cli.db");
    const env: NodeJS.ProcessEnv = { ...process.env, DATABASE_URL: `file:${file}`, BETTER_AUTH_SECRET: "x".repeat(40), NODE_ENV: "production" };
    const first = spawnSync("npm", ["run", "-s", "migrate"], { env, encoding: "utf-8" });
    expect(first.status, first.stderr).toBe(0);
    expect(first.stdout).toMatch(/migrated/i);
    const second = spawnSync("npm", ["run", "-s", "migrate"], { env, encoding: "utf-8" });
    expect(second.status, second.stderr).toBe(0);
    expect(second.stdout).toMatch(/up to date/i);
  }, 60_000);
});

describe("Better Auth's part", () => {
  it("is re-checked whenever its expected tables change", async () => {
    const { getAuthOptions } = await import("@/lib/server/auth");
    const { authSchemaFingerprint } = await import("@/lib/server/migrations");
    const db = await getDb();
    const options = getAuthOptions(db);
    expect(authSchemaFingerprint(options)).toBe(authSchemaFingerprint(getAuthOptions(db)));
    // e.g. moving rate-limit counts out of the database drops a table.
    expect(authSchemaFingerprint({ ...options, rateLimit: { storage: "memory" } })).not.toBe(authSchemaFingerprint(options));
  });
});
