import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, describe, expect, it, vi } from "vitest";

/**
 * The account rules (auth.ts) through Better Auth's real HTTP handler, on a
 * throwaway database, in production mode. Each request comes from its own
 * address so sign-up rate limits don't interfere.
 */
const dir = fs.mkdtempSync(path.join(os.tmpdir(), "podblock-auth-rules-"));
vi.stubEnv("NODE_ENV", "production");
vi.stubEnv("DATABASE_URL", `file:${path.join(dir, "test.db")}`);
vi.stubEnv("BETTER_AUTH_SECRET", "test-secret-test-secret-test-secret-test-secret");
vi.stubEnv("BETTER_AUTH_URL", "http://localhost:3000");
vi.stubEnv("PODBLOCK_ADMIN_EMAIL", "Owner@Example.com");

const { getAuth } = await import("@/lib/server/auth");
const { getDb } = await import("@/lib/server/db");

afterAll(() => {
  vi.unstubAllEnvs();
  fs.rmSync(dir, { recursive: true, force: true });
});

let ip = 0;
async function call(route: string, body: object, cookie?: string) {
  const auth = await getAuth();
  return auth.handler(
    new Request(`http://localhost:3000/api/auth${route}`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        origin: "http://localhost:3000",
        "x-forwarded-for": `198.51.100.${++ip}`,
        ...(cookie ? { cookie } : {}),
      },
      body: JSON.stringify(body),
    }),
  );
}

const signUp = (email: string, extra: object = {}) =>
  call("/sign-up/email", { name: email.split("@")[0], email, password: "long enough password", ...extra });

async function signIn(email: string) {
  const res = await call("/sign-in/email", { email, password: "long enough password" });
  const cookie = res.headers.getSetCookie().map((c) => c.split(";")[0]).join("; ");
  return { res, cookie };
}

async function row(email: string) {
  const db = await getDb();
  const { rows } = await db.execute({ sql: `SELECT role, approved, banned FROM "user" WHERE lower(email) = lower(?)`, args: [email] });
  return rows[0] ? { role: rows[0].role, approved: Number(rows[0].approved), banned: Number(rows[0].banned) } : null;
}

/** Tests share one database and build on each other, in order. */
describe("account rules", () => {
  it("refuses sign-ups until the owner has an account", async () => {
    const res = await signUp("early@example.com");
    expect(res.status).toBe(403);
    expect(await row("early@example.com")).toBeNull();
  });

  it("makes the owner's account (email matched without case) the approved admin", async () => {
    expect((await signUp("owner@example.com")).status).toBe(200);
    expect(await row("owner@example.com")).toEqual({ role: "admin", approved: 1, banned: 0 });
  });

  it("lets others sign up, waiting for approval", async () => {
    expect((await signUp("friend@example.com")).status).toBe(200);
    expect(await row("friend@example.com")).toMatchObject({ role: "user", approved: 0 });
  });

  it("ignores attempts to sign up already approved or as admin", async () => {
    const res = await signUp("sneaky@example.com", { approved: true, role: "admin" });
    // Better Auth refuses fields users may not set; either way nothing is granted.
    if (res.status === 200) expect(await row("sneaky@example.com")).toMatchObject({ role: "user", approved: 0 });
    else expect(await row("sneaky@example.com")).toBeNull();
  });

  it("doesn't let users approve or promote themselves", async () => {
    const { cookie } = await signIn("friend@example.com");
    expect(cookie).toContain("session_token");
    await call("/update-user", { approved: true }, cookie);
    await call("/update-user", { role: "admin" }, cookie);
    expect(await row("friend@example.com")).toMatchObject({ role: "user", approved: 0 });
  });

  it("keeps disabled accounts out", async () => {
    const db = await getDb();
    await db.execute(`UPDATE "user" SET banned = 1 WHERE email = 'friend@example.com'`);
    const { res } = await signIn("friend@example.com");
    expect(res.status).toBe(403);
    expect((await res.json()).code).toBe("BANNED_USER");
  });

  it("promotes an existing account with the owner's email when the server starts", async () => {
    const db = await getDb();
    await db.execute(`UPDATE "user" SET role = 'user', approved = 0, banned = 1 WHERE email = 'owner@example.com'`);
    (globalThis as { __podblockAuth?: unknown }).__podblockAuth = undefined; // a restart
    await getAuth();
    expect(await row("owner@example.com")).toEqual({ role: "admin", approved: 1, banned: 0 });
  });
});

describe("admin bootstrap (S-5, pending Q3)", () => {
  // Current behaviour, pinned so the fix shows up as a deliberate change:
  // nothing proves the person signing up owns the admin email.
  it("makes whoever first signs up with the admin email the admin, without verifying it", async () => {
    const db = await getDb();
    await db.execute(`DELETE FROM "user" WHERE email = 'owner@example.com'`);
    await db.execute(`DELETE FROM "user" WHERE role = 'admin'`);
    expect((await signUp("owner@example.com")).status).toBe(200);
    expect(await row("owner@example.com")).toMatchObject({ role: "admin", approved: 1 });
  });
});
