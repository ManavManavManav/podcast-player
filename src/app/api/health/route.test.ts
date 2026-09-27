import { NextResponse } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ requireUser: vi.fn() }));
vi.mock("@/lib/server/session", () => ({ requireUser: mocks.requireUser }));

const { GET } = await import("@/app/api/health/route");

beforeEach(() => {
  vi.unstubAllEnvs();
  mocks.requireUser.mockResolvedValue({ id: "u1", role: "user", approved: true });
  for (const key of ["PODCAST_INDEX_API_KEY", "PODCAST_INDEX_API_SECRET", "PODCAST_INDEX_API_SECRET_BASE64", "TRANSCRIBE_API_KEY", "DETECT_API_KEY"]) {
    vi.stubEnv(key, "");
  }
});

describe("GET /api/health", () => {
  it("needs a signed-in, approved user", async () => {
    mocks.requireUser.mockResolvedValue(NextResponse.json({ error: "Sign in required" }, { status: 401 }));
    expect((await GET()).status).toBe(401);
  });

  it("reports which parts are configured, without their values", async () => {
    vi.stubEnv("TRANSCRIBE_API_KEY", "sk-secret-value");
    const res = await GET();
    const body = await res.json();
    expect(body).toEqual({ ok: false, podcastIndex: false, transcription: true, detection: false });
    expect(JSON.stringify(body)).not.toContain("sk-secret");
  });

  it("is ok only when everything is configured", async () => {
    vi.stubEnv("PODCAST_INDEX_API_KEY", "k");
    vi.stubEnv("PODCAST_INDEX_API_SECRET", "s");
    vi.stubEnv("TRANSCRIBE_API_KEY", "t");
    vi.stubEnv("DETECT_API_KEY", "d");
    expect((await (await GET()).json()).ok).toBe(true);
  });
});
