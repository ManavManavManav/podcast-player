import { NextRequest, NextResponse } from "next/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  requireUser: vi.fn(),
  analyzeWindow: vi.fn(),
  cachedAnalysis: vi.fn(),
  isPublicUrl: vi.fn(),
}));
vi.mock("@/lib/server/session", () => ({ requireUser: mocks.requireUser }));
vi.mock("@/lib/server/analyzer", () => ({ analyzeWindow: mocks.analyzeWindow, cachedAnalysis: mocks.cachedAnalysis }));
vi.mock("@/lib/server/guard", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/server/guard")>()),
  isPublicUrl: mocks.isPublicUrl,
}));

const { GET, POST, maxDuration } = await import("@/app/api/analyze/route");
const { AppError } = await import("@/lib/server/errors");

const AUDIO = "https://cdn.example.com/ep1.mp3";
const user = { id: "u1", name: "U", email: "u@example.com", role: "user", approved: true };

function post(body: unknown, headers: Record<string, string> = {}, signal?: AbortSignal) {
  return new NextRequest("http://localhost:3000/api/analyze", {
    method: "POST",
    headers: { host: "localhost:3000", "content-type": "application/json", origin: "http://localhost:3000", ...headers },
    body: typeof body === "string" ? body : JSON.stringify(body),
    signal,
  });
}

/** Like the analyzer: runs until its signal aborts, then rejects the way SharedTask does. */
function untilAborted(_url: string, _w: number, _l: unknown, _e: unknown, _u: string, signal: AbortSignal) {
  return new Promise((_, reject) => {
    const abort = () => reject(new DOMException("Aborted", "AbortError"));
    if (signal.aborted) return abort();
    signal.addEventListener("abort", abort, { once: true });
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.requireUser.mockResolvedValue(user);
  mocks.isPublicUrl.mockResolvedValue(true);
  mocks.analyzeWindow.mockResolvedValue({ window: 300, segments: [], ads: [], cached: false });
  mocks.cachedAnalysis.mockResolvedValue({ windows: [0], segments: [], ads: [] });
  vi.spyOn(console, "error").mockImplementation(() => {});
  vi.stubEnv("PODBLOCK_LOG_LEVEL", "info");
});

/** The structured log lines written so far. */
const logged = () => vi.mocked(console.error).mock.calls.map(([line]) => JSON.parse(String(line)));

describe("POST /api/analyze: requests", () => {
  it("refuses non-JSON and cross-site requests before anything else", async () => {
    expect((await POST(post("{}", { "content-type": "text/plain" }))).status).toBe(415);
    expect((await POST(post({}, { origin: "https://evil.example" }))).status).toBe(403);
    expect(mocks.requireUser).not.toHaveBeenCalled();
  });

  it("passes on the session check's refusal", async () => {
    mocks.requireUser.mockResolvedValue(NextResponse.json({ error: "Sign in required" }, { status: 401 }));
    expect((await POST(post({ url: AUDIO, window: 0 }))).status).toBe(401);
    expect(mocks.analyzeWindow).not.toHaveBeenCalled();
  });

  it.each([
    ["malformed JSON", "{"],
    ["a non-http URL", { url: "file:///etc/passwd", window: 0 }],
    ["a window off the grid", { url: AUDIO, window: 299 }],
    ["a negative window", { url: AUDIO, window: -300 }],
    ["a window past 12 hours", { url: AUDIO, window: 12 * 3600 + 300 }],
    ["a non-numeric window", { url: AUDIO, window: "300" }],
  ])("rejects %s with 400", async (_, body) => {
    expect((await POST(post(body))).status).toBe(400);
    expect(mocks.analyzeWindow).not.toHaveBeenCalled();
  });

  it("rejects audio on a non-public host", async () => {
    mocks.isPublicUrl.mockResolvedValue(false);
    expect((await POST(post({ url: AUDIO, window: 0 }))).status).toBe(400);
  });

  it("analyzes the window with a normalized language and bounded episode hints", async () => {
    const res = await POST(
      post({
        url: AUDIO,
        window: 300,
        language: "en-US",
        episode: { podcastTitle: `  ${"x".repeat(400)}  `, episodeTitle: "Ep 1", website: "javascript:alert(1)" },
      }),
    );
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ window: 300, segments: [], ads: [], cached: false });
    const [url, window, language, episode, userId] = mocks.analyzeWindow.mock.calls[0];
    expect([url, window, language, userId]).toEqual([AUDIO, 300, "en", "u1"]);
    expect(episode).toEqual({ podcastTitle: "x".repeat(300), episodeTitle: "Ep 1", website: undefined });
  });

  it("answers 499 with no body when the client went away", async () => {
    mocks.analyzeWindow.mockImplementation(untilAborted);
    const client = new AbortController();
    const pending = POST(post({ url: AUDIO, window: 0 }, {}, client.signal));
    client.abort();
    expect((await pending).status).toBe(499);
  });
});

describe("POST /api/analyze: failures", () => {
  it("doesn't show internal details (ffmpeg output, paths, provider responses) to the listener", async () => {
    mocks.analyzeWindow.mockRejectedValue(new Error("ffmpeg failed (exit 1): /opt/ffmpeg/bin: Invalid data found"));
    const res = await POST(post({ url: AUDIO, window: 0 }, { "x-request-id": "req-7" }));
    expect(res.status).toBe(502);
    const body = await res.json();
    expect(body.error).not.toMatch(/ffmpeg|\/opt|Invalid data/);
    expect(body.error).toBeTruthy();
    // The details still reach the server's log, tagged with the request.
    const [entry] = logged();
    expect(entry).toMatchObject({ event: "analysis.failed", code: "internal", requestId: "req-7" });
    expect(entry.err.message).toMatch(/Invalid data found/);
  });

  it("uses the error's public message and kind when there is one", async () => {
    mocks.analyzeWindow.mockRejectedValue(
      new AppError("audio", "ffmpeg failed (exit 1): 404 Not Found", { publicMessage: "Couldn't read this episode's audio." }),
    );
    const res = await POST(post({ url: AUDIO, window: 0 }));
    expect(res.status).toBe(502);
    expect(await res.json()).toEqual({ error: "Couldn't read this episode's audio.", code: "audio" });
  });

  it("reports missing server configuration as unavailable", async () => {
    mocks.analyzeWindow.mockRejectedValue(new AppError("config", "DETECT_API_KEY is not set"));
    const res = await POST(post({ url: AUDIO, window: 0 }));
    expect(res.status).toBe(503);
    const body = await res.json();
    expect(body.code).toBe("config");
    expect(body.error).not.toMatch(/DETECT_API_KEY/);
  });
});

describe("POST /api/analyze: time limit", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("gives up before the platform's limit, and says when to retry", async () => {
    vi.useFakeTimers();
    mocks.analyzeWindow.mockImplementation(untilAborted);
    const pending = POST(post({ url: AUDIO, window: 0 }));
    await vi.advanceTimersByTimeAsync((maxDuration - 10) * 1000);
    const res = await pending;
    expect(res.status).toBe(503);
    expect(res.headers.get("retry-after")).toMatch(/^\d+$/);
    expect((await res.json()).code).toBe("timeout");
  });

  it("doesn't cut off work that finishes in time", async () => {
    vi.useFakeTimers();
    mocks.analyzeWindow.mockImplementation(
      () => new Promise((resolve) => setTimeout(() => resolve({ window: 0, segments: [], ads: [], cached: false }), 60_000)),
    );
    const pending = POST(post({ url: AUDIO, window: 0 }));
    await vi.advanceTimersByTimeAsync(60_000);
    expect((await pending).status).toBe(200);
  });

  it("treats an abort nobody asked for as a temporary failure, not a departed client", async () => {
    mocks.analyzeWindow.mockRejectedValue(new DOMException("Aborted", "AbortError"));
    const res = await POST(post({ url: AUDIO, window: 0 }));
    expect(res.status).toBe(503);
  });
});

describe("GET /api/analyze", () => {
  it("returns what's stored for the episode", async () => {
    const res = await GET(new NextRequest(`http://localhost:3000/api/analyze?url=${encodeURIComponent(AUDIO)}`));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ windows: [0], segments: [], ads: [] });
    expect(mocks.cachedAnalysis).toHaveBeenCalledWith(AUDIO);
  });

  it("rejects a missing or non-http URL", async () => {
    expect((await GET(new NextRequest("http://localhost:3000/api/analyze"))).status).toBe(400);
    expect((await GET(new NextRequest("http://localhost:3000/api/analyze?url=ftp://x/a.mp3"))).status).toBe(400);
  });
});
