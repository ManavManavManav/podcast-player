import fs from "node:fs";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const cleanupOldData = vi.hoisted(() => vi.fn());
vi.mock("@/lib/server/retention", () => ({ cleanupOldData }));

const { GET } = await import("@/app/api/cron/cleanup/route");

const call = (authorization?: string) =>
  GET(new Request("http://localhost:3000/api/cron/cleanup", { headers: authorization ? { authorization } : {} }));

beforeEach(() => {
  cleanupOldData.mockResolvedValue({ windows: 3, verdicts: 3, sessions: 1, verifications: 0, rateLimits: 2 });
  vi.spyOn(console, "error").mockImplementation(() => {});
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe("GET /api/cron/cleanup", () => {
  it("runs the cleanup when called with the cron secret, as Vercel Cron does", async () => {
    vi.stubEnv("CRON_SECRET", "cron-secret-value");
    const res = await call("Bearer cron-secret-value");
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true, removed: { windows: 3, verdicts: 3, sessions: 1, verifications: 0, rateLimits: 2 } });
  });

  it("refuses anyone else", async () => {
    vi.stubEnv("CRON_SECRET", "cron-secret-value");
    expect((await call()).status).toBe(401);
    expect((await call("Bearer wrong")).status).toBe(401);
    expect((await call("cron-secret-value")).status).toBe(401);
    expect(cleanupOldData).not.toHaveBeenCalled();
  });

  it("does nothing until a cron secret is configured", async () => {
    vi.stubEnv("CRON_SECRET", "");
    expect((await call("Bearer ")).status).toBe(503);
    expect(cleanupOldData).not.toHaveBeenCalled();
  });
});

describe("vercel.json", () => {
  it("schedules the cleanup daily", () => {
    const config = JSON.parse(fs.readFileSync(path.resolve("vercel.json"), "utf-8"));
    expect(config.crons).toContainEqual({ path: "/api/cron/cleanup", schedule: expect.stringMatching(/^\d+ \d+ \* \* \*$/) });
  });
});
