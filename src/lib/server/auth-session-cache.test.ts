import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, describe, expect, it, vi } from "vitest";

const dir = fs.mkdtempSync(path.join(os.tmpdir(), "podblock-session-cache-"));
vi.stubEnv("NODE_ENV", "production");
vi.stubEnv("DATABASE_URL", `file:${path.join(dir, "test.db")}`);
vi.stubEnv("BETTER_AUTH_SECRET", "test-secret-test-secret-test-secret-test-secret");
vi.stubEnv("BETTER_AUTH_URL", "http://localhost:3000");
vi.stubEnv("PODBLOCK_ADMIN_EMAIL", "owner@example.com");
vi.stubEnv("PODBLOCK_SETUP_CODE", "setup-code-for-tests");

const { getAuth } = await import("@/lib/server/auth");
const { getDb } = await import("@/lib/server/db");

afterAll(() => {
  vi.unstubAllEnvs();
  fs.rmSync(dir, { recursive: true, force: true });
});

async function signedInCookie() {
  const auth = await getAuth();
  const post = (route: string, body: object) =>
    auth.handler(
      new Request(`http://localhost:3000/api/auth${route}`, {
        method: "POST",
        headers: { "content-type": "application/json", origin: "http://localhost:3000", "x-podblock-setup-code": "setup-code-for-tests", "x-forwarded-for": `192.0.2.${Math.floor(Math.random() * 250)}` },
        body: JSON.stringify(body),
      }),
    );
  await post("/sign-up/email", { name: "Owner", email: "owner@example.com", password: "long enough password" });
  const res = await post("/sign-in/email", { email: "owner@example.com", password: "long enough password" });
  return res.headers.getSetCookie().map((c) => c.split(";")[0]).join("; ");
}

describe("session checks", () => {
  it("answer repeat checks from the signed cookie, without the database", async () => {
    const cookie = await signedInCookie();
    const auth = await getAuth();
    const db = await getDb();
    const execute = vi.spyOn(db, "execute");
    const batch = vi.spyOn(db, "batch");

    const session = await auth.api.getSession({ headers: new Headers({ cookie }) });
    expect(session?.user.email).toBe("owner@example.com");
    expect(execute.mock.calls.length + batch.mock.calls.length).toBe(0);

    // Where staleness matters, the database is asked.
    await auth.api.getSession({ headers: new Headers({ cookie }), query: { disableCookieCache: true } });
    expect(execute.mock.calls.length + batch.mock.calls.length).toBeGreaterThan(0);
  });
});
