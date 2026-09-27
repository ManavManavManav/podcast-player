import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Creating the admin account (S-5): signing up with PODBLOCK_ADMIN_EMAIL
 * takes the one-time setup code, so nobody else can claim that address first.
 */
const dir = fs.mkdtempSync(path.join(os.tmpdir(), "podblock-bootstrap-"));
vi.stubEnv("NODE_ENV", "production");
vi.stubEnv("DATABASE_URL", `file:${path.join(dir, "test.db")}`);
vi.stubEnv("BETTER_AUTH_SECRET", "test-secret-test-secret-test-secret-test-secret");
vi.stubEnv("BETTER_AUTH_URL", "http://localhost:3000");
vi.stubEnv("PODBLOCK_ADMIN_EMAIL", "owner@example.com");

const { getAuth, ownerSignUpRefusal, SETUP_CODE_HEADER } = await import("@/lib/server/auth");
const { getDb } = await import("@/lib/server/db");

afterAll(() => {
  vi.unstubAllEnvs();
  fs.rmSync(dir, { recursive: true, force: true });
});

let ip = 0;
async function signUp(email: string, code?: string) {
  const auth = await getAuth();
  return auth.handler(
    new Request("http://localhost:3000/api/auth/sign-up/email", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        origin: "http://localhost:3000",
        "x-forwarded-for": `203.0.113.${++ip}`,
        ...(code !== undefined ? { [SETUP_CODE_HEADER]: code } : {}),
      },
      body: JSON.stringify({ name: "Someone", email, password: "long enough password" }),
    }),
  );
}

async function role(email: string) {
  const db = await getDb();
  const { rows } = await db.execute({ sql: `SELECT role, approved FROM "user" WHERE email = ?`, args: [email] });
  return rows[0] ? { role: rows[0].role, approved: Number(rows[0].approved) } : null;
}

beforeEach(() => {
  vi.stubEnv("PODBLOCK_SETUP_CODE", "");
});

describe("creating the admin account", () => {
  it("is refused while no setup code is configured, saying how to fix it", async () => {
    const res = await signUp("owner@example.com", "anything");
    expect(res.status).toBe(403);
    expect((await res.json()).message).toMatch(/PODBLOCK_SETUP_CODE/);
    expect(await role("owner@example.com")).toBeNull();
  });

  it("needs the right code", async () => {
    vi.stubEnv("PODBLOCK_SETUP_CODE", "correct-horse-battery-staple");
    expect((await signUp("owner@example.com")).status).toBe(403);
    expect((await signUp("owner@example.com", "wrong-code")).status).toBe(403);
    expect(await role("owner@example.com")).toBeNull();

    expect((await signUp("owner@example.com", "correct-horse-battery-staple")).status).toBe(200);
    expect(await role("owner@example.com")).toEqual({ role: "admin", approved: 1 });
  });

  it("isn't needed by anyone else once the admin exists", async () => {
    expect((await signUp("friend@example.com")).status).toBe(200);
    expect(await role("friend@example.com")).toEqual({ role: "user", approved: 0 });
  });
});

describe("ownerSignUpRefusal", () => {
  const owner = { email: "owner@example.com", emailVerified: false };
  const ctx = (pathname: string, headers: Record<string, string> = {}) => ({ path: pathname, headers: new Headers(headers) });

  it("accepts an address GitHub or Google has verified, without a code", () => {
    vi.stubEnv("PODBLOCK_SETUP_CODE", "");
    expect(ownerSignUpRefusal({ ...owner, emailVerified: true }, ctx("/callback/:id"))).toBeNull();
  });

  it("doesn't take a verified flag as proof on an email sign-up", () => {
    vi.stubEnv("PODBLOCK_SETUP_CODE", "code");
    expect(ownerSignUpRefusal({ ...owner, emailVerified: true }, ctx("/sign-up/email"))).toMatch(/setup code/i);
  });

  it("compares codes exactly", () => {
    vi.stubEnv("PODBLOCK_SETUP_CODE", "code");
    expect(ownerSignUpRefusal(owner, ctx("/sign-up/email", { [SETUP_CODE_HEADER]: "code" }))).toBeNull();
    expect(ownerSignUpRefusal(owner, ctx("/sign-up/email", { [SETUP_CODE_HEADER]: "cod" }))).not.toBeNull();
    expect(ownerSignUpRefusal(owner, ctx("/sign-up/email", { [SETUP_CODE_HEADER]: "CODE" }))).not.toBeNull();
    expect(ownerSignUpRefusal(owner, null)).not.toBeNull();
  });
});

describe("promoting the owner at startup", () => {
  it("doesn't promote an unapproved, unverified account that merely uses the admin email", async () => {
    const db = await getDb();
    // Someone signed up as newcomer@ before the owner pointed PODBLOCK_ADMIN_EMAIL at that address.
    expect((await signUp("newcomer@example.com")).status).toBe(200);
    vi.stubEnv("PODBLOCK_ADMIN_EMAIL", "newcomer@example.com");
    (globalThis as { __podblockAuth?: unknown }).__podblockAuth = undefined;
    await getAuth();
    expect(await role("newcomer@example.com")).toEqual({ role: "user", approved: 0 });

    // Once the admin has approved that account, it can be made the admin this way.
    await db.execute(`UPDATE "user" SET approved = 1 WHERE email = 'newcomer@example.com'`);
    (globalThis as { __podblockAuth?: unknown }).__podblockAuth = undefined;
    await getAuth();
    expect(await role("newcomer@example.com")).toEqual({ role: "admin", approved: 1 });
    vi.stubEnv("PODBLOCK_ADMIN_EMAIL", "owner@example.com");
  });
});
