import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

/**
 * Better Auth against a throwaway SQLite database. Runs in production mode,
 * where rate limiting is on.
 */
const dir = fs.mkdtempSync(path.join(os.tmpdir(), "podblock-auth-"));
vi.stubEnv("NODE_ENV", "production");
vi.stubEnv("DATABASE_URL", `file:${path.join(dir, "test.db")}`);
vi.stubEnv("BETTER_AUTH_SECRET", "test-secret-test-secret-test-secret-test-secret");
vi.stubEnv("BETTER_AUTH_URL", "http://localhost:3000");
vi.stubEnv("PODBLOCK_ADMIN_EMAIL", "owner@example.com");
vi.stubEnv("PODBLOCK_SETUP_CODE", "setup-code-for-tests");

const { getAuth } = await import("@/lib/server/auth");
const { getDb } = await import("@/lib/server/db");
type Auth = Awaited<ReturnType<typeof getAuth>>;

/** A fresh auth instance, like a new serverless instance would create (same database). */
async function freshInstance(): Promise<Auth> {
  (globalThis as { __podblockAuth?: unknown }).__podblockAuth = undefined;
  return getAuth();
}

function post(auth: Auth, route: string, body: object, ip = "203.0.113.7") {
  return auth.handler(
    new Request(`http://localhost:3000/api/auth${route}`, {
      method: "POST",
      headers: { "content-type": "application/json", origin: "http://localhost:3000", "x-podblock-setup-code": "setup-code-for-tests", "x-forwarded-for": ip },
      body: JSON.stringify(body),
    }),
  );
}

beforeAll(async () => {
  const auth = await getAuth();
  const res = await post(auth, "/sign-up/email", { name: "Owner", email: "owner@example.com", password: "correct horse battery" }, "198.51.100.1");
  expect(res.status).toBe(200);
});

afterAll(() => {
  vi.unstubAllEnvs();
  fs.rmSync(dir, { recursive: true, force: true });
});

describe("sign-in rate limiting", () => {
  // Better Auth's memory store is one Map per process, which two instances
  // in this test would share; separate serverless instances wouldn't. So
  // check where the counts live.
  it("keeps its counts in the database, where every server instance sees them", async () => {
    const auth = await freshInstance();
    await post(auth, "/sign-in/email", { email: "nobody@example.com", password: "whatever-at-all" }, "203.0.113.99");
    const db = await getDb();
    const { rows } = await db.execute(`SELECT key FROM "rateLimit"`);
    expect(rows.map((r) => String(r.key))).toContain("203.0.113.99|/sign-in/email");
  });

  it("refuses a fourth quick attempt, even on another instance", async () => {
    const attempt = (auth: Auth) => post(auth, "/sign-in/email", { email: "owner@example.com", password: "wrong password!" });

    const first = await freshInstance();
    for (let i = 0; i < 3; i++) expect((await attempt(first)).status).toBe(401);

    // Another instance (another lambda) must see the same count.
    const second = await freshInstance();
    expect((await attempt(second)).status).toBe(429);
  });

  it("counts each client separately", async () => {
    const auth = await freshInstance();
    const res = await post(auth, "/sign-in/email", { email: "owner@example.com", password: "correct horse battery" }, "192.0.2.50");
    expect(res.status).toBe(200);
  });
});
