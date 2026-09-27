import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const execute = vi.hoisted(() => vi.fn());
vi.mock("@/lib/server/db", () => ({ getDb: async () => ({ execute }) }));

const { GET } = await import("@/app/api/readyz/route");

beforeEach(() => {
  execute.mockReset();
  vi.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe("GET /api/readyz", () => {
  it("is ready when the database answers", async () => {
    execute.mockResolvedValue({ rows: [{ 1: 1 }] });
    const res = await GET();
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true, database: "ok" });
    expect(execute).toHaveBeenCalledWith("SELECT 1");
  });

  it("isn't ready when the database fails, and doesn't say why", async () => {
    execute.mockRejectedValue(new Error("SERVER_ERROR: auth token rejected for libsql://prod.turso.io"));
    const res = await GET();
    expect(res.status).toBe(503);
    const body = await res.json();
    expect(body).toEqual({ ok: false, database: "unavailable" });
  });

  it("isn't ready when the database doesn't answer in time", async () => {
    vi.useFakeTimers();
    execute.mockImplementation(() => new Promise(() => {}));
    const pending = GET();
    await vi.advanceTimersByTimeAsync(3_000);
    expect((await pending).status).toBe(503);
  });
});
