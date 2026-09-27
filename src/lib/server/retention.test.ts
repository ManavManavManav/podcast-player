import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, describe, expect, it, vi } from "vitest";

const dir = fs.mkdtempSync(path.join(os.tmpdir(), "podblock-retention-"));
vi.stubEnv("DATABASE_URL", `file:${path.join(dir, "test.db")}`);
vi.stubEnv("BETTER_AUTH_SECRET", "test-secret-test-secret-test-secret-test-secret");

const { getDb } = await import("@/lib/server/db");
const { getAuth } = await import("@/lib/server/auth");
const { cleanupOldData, RETENTION_DAYS } = await import("@/lib/server/retention");

afterAll(() => {
  vi.unstubAllEnvs();
  fs.rmSync(dir, { recursive: true, force: true });
});

const NOW = Date.parse("2026-09-26T12:00:00Z");
const DAY = 86_400_000;
const count = async (sql: string) => Number((await (await getDb()).execute(sql)).rows[0].n);

describe("cleanupOldData", () => {
  it(`keeps a month (${RETENTION_DAYS} days) of analysis and drops what's expired`, async () => {
    await getAuth(); // creates Better Auth's tables
    const db = await getDb();
    const old = NOW - 35 * DAY;
    const recent = NOW - 5 * DAY;
    await db.batch(
      [
        { sql: "INSERT INTO analysis_window VALUES ('old', 0, 'u', '[]', ?)", args: [old] },
        { sql: "INSERT INTO analysis_verdict VALUES ('old', 0, 'd', '[]', ?)", args: [old] },
        { sql: "INSERT INTO analysis_window VALUES ('new', 0, 'u', '[]', ?)", args: [recent] },
        { sql: "INSERT INTO analysis_verdict VALUES ('new', 0, 'd', '[]', ?)", args: [recent] },
        // Recent verdict whose (old) transcript is going: it goes too.
        { sql: "INSERT INTO analysis_window VALUES ('mixed', 0, 'u', '[]', ?)", args: [old] },
        { sql: "INSERT INTO analysis_verdict VALUES ('mixed', 0, 'd2', '[]', ?)", args: [recent] },
        `INSERT INTO "user" (id, name, email, "emailVerified", approved, "createdAt", "updatedAt") VALUES ('u1', 'U', 'u@example.com', 0, 0, '2026-01-01T00:00:00.000Z', '2026-01-01T00:00:00.000Z')`,
        `INSERT INTO session (id, "expiresAt", token, "createdAt", "updatedAt", "userId") VALUES ('s-old', '${new Date(NOW - DAY).toISOString()}', 't1', '2026-01-01T00:00:00.000Z', '2026-01-01T00:00:00.000Z', 'u1')`,
        `INSERT INTO session (id, "expiresAt", token, "createdAt", "updatedAt", "userId") VALUES ('s-live', '${new Date(NOW + DAY).toISOString()}', 't2', '2026-01-01T00:00:00.000Z', '2026-01-01T00:00:00.000Z', 'u1')`,
        `INSERT INTO verification (id, identifier, value, "expiresAt", "createdAt", "updatedAt") VALUES ('v-old', 'x', 'y', '${new Date(NOW - DAY).toISOString()}', '2026-01-01T00:00:00.000Z', '2026-01-01T00:00:00.000Z')`,
        { sql: `INSERT INTO "rateLimit" (id, key, count, "lastRequest") VALUES ('r-old', 'k1', 3, ?)`, args: [NOW - 2 * DAY] },
        { sql: `INSERT INTO "rateLimit" (id, key, count, "lastRequest") VALUES ('r-new', 'k2', 1, ?)`, args: [NOW - 60_000] },
      ],
      "write",
    );

    const removed = await cleanupOldData(NOW);
    expect(removed).toEqual({ windows: 2, verdicts: 2, sessions: 1, verifications: 1, rateLimits: 1 });
    expect(await count("SELECT COUNT(*) n FROM analysis_window WHERE url_key = 'new'")).toBe(1);
    expect(await count("SELECT COUNT(*) n FROM analysis_verdict WHERE url_key = 'new'")).toBe(1);
    expect(await count("SELECT COUNT(*) n FROM session WHERE id = 's-live'")).toBe(1);
    expect(await count(`SELECT COUNT(*) n FROM "rateLimit" WHERE id = 'r-new'`)).toBe(1);

    // Running again finds nothing more.
    expect(await cleanupOldData(NOW)).toEqual({ windows: 0, verdicts: 0, sessions: 0, verifications: 0, rateLimits: 0 });
  });
});
