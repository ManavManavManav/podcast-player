import { NextRequest, NextResponse } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ requireUser: vi.fn(), resolveAudioUrl: vi.fn(), isPublicUrl: vi.fn() }));
vi.mock("@/lib/server/session", () => ({ requireUser: mocks.requireUser }));
vi.mock("@/lib/server/audio", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/server/audio")>()),
  resolveAudioUrl: mocks.resolveAudioUrl,
}));
vi.mock("@/lib/server/guard", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/server/guard")>()),
  isPublicUrl: mocks.isPublicUrl,
}));

const { POST } = await import("@/app/api/resolve/route");

const AUDIO = "https://feed.example/ep.mp3";
const post = (body: unknown, headers: Record<string, string> = {}) =>
  POST(
    new NextRequest("http://localhost:3000/api/resolve", {
      method: "POST",
      headers: { host: "localhost:3000", "content-type": "application/json", origin: "http://localhost:3000", ...headers },
      body: typeof body === "string" ? body : JSON.stringify(body),
    }),
  );

beforeEach(() => {
  vi.clearAllMocks();
  mocks.requireUser.mockResolvedValue({ id: "u1", role: "user", approved: true });
  mocks.isPublicUrl.mockResolvedValue(true);
  mocks.resolveAudioUrl.mockResolvedValue("https://cdn.example/variant-7/ep.mp3");
});

describe("POST /api/resolve", () => {
  it("refuses non-JSON, cross-site and signed-out requests", async () => {
    expect((await post("{}", { "content-type": "text/plain" })).status).toBe(415);
    expect((await post({ url: AUDIO }, { "sec-fetch-site": "cross-site" })).status).toBe(403);
    mocks.requireUser.mockResolvedValue(NextResponse.json({ error: "Sign in required" }, { status: 401 }));
    expect((await post({ url: AUDIO })).status).toBe(401);
    expect(mocks.resolveAudioUrl).not.toHaveBeenCalled();
  });

  it.each([["malformed JSON", "{"], ["no URL", {}], ["a non-http URL", { url: "file:///etc/passwd" }]])(
    "rejects %s",
    async (_, body) => {
      expect((await post(body)).status).toBe(400);
    },
  );

  it("rejects audio on a non-public host", async () => {
    mocks.isPublicUrl.mockResolvedValue(false);
    expect((await post({ url: AUDIO })).status).toBe(400);
    expect(mocks.resolveAudioUrl).not.toHaveBeenCalled();
  });

  it("returns the pinned variant", async () => {
    const res = await post({ url: AUDIO });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ url: "https://cdn.example/variant-7/ep.mp3" });
  });

  it("falls back to the original if the pinned URL isn't public", async () => {
    mocks.isPublicUrl.mockImplementation(async (url: string) => url === AUDIO);
    expect(await (await post({ url: AUDIO })).json()).toEqual({ url: AUDIO });
  });

  it("asks for a fresh answer when the player's pinned link went stale", async () => {
    await post({ url: AUDIO, fresh: true });
    expect(mocks.resolveAudioUrl).toHaveBeenCalledWith(AUDIO, { fresh: true });
    await post({ url: AUDIO });
    expect(mocks.resolveAudioUrl).toHaveBeenLastCalledWith(AUDIO, { fresh: false });
  });
});
