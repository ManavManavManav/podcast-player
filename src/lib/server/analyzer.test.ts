import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";

const dir = fs.mkdtempSync(path.join(os.tmpdir(), "podblock-analyzer-"));
vi.stubEnv("DATABASE_URL", `file:${path.join(dir, "test.db")}`);

// The paid steps are stubbed; storage, caching and usage are real.
const steps = vi.hoisted(() => ({ extractWindow: vi.fn(), transcribe: vi.fn(), detectAds: vi.fn() }));
vi.mock("@/lib/server/audio", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/server/audio")>()),
  extractWindow: steps.extractWindow,
}));
vi.mock("@/lib/server/transcribe", () => ({ transcribe: steps.transcribe }));
vi.mock("@/lib/server/llm/detect", () => ({ detectAds: steps.detectAds }));

const { analyzeWindow, cachedAnalysis } = await import("@/lib/server/analyzer");
const { AppError } = await import("@/lib/server/errors");
const { getDb } = await import("@/lib/server/db");
const { currentMonth, usageForMonth } = await import("@/lib/server/usage");

const segmentsAt = (start: number) => [
  { start: start + 10, end: start + 40, text: "This episode is brought to you by Acme." },
  { start: start + 42, end: start + 60, text: "Back to the show." },
];

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubEnv("DETECT_API_KEY", "sk-detect");
  vi.stubEnv("TRANSCRIBE_API_KEY", "sk-transcribe");
  steps.extractWindow.mockResolvedValue(Buffer.from("flac"));
  steps.transcribe.mockImplementation(async (_audio: Buffer, start: number) => ({ segments: segmentsAt(start), audioSeconds: 300 }));
  steps.detectAds.mockImplementation(async (window: Array<{ start: number }>) => ({
    ads: [{ start: window[0].start, end: window[0].start + 30, confidence: 0.9, reason: "Ad: Acme" }],
    inputTokens: 1000,
    outputTokens: 50,
  }));
});

afterAll(() => {
  vi.unstubAllEnvs();
  fs.rmSync(dir, { recursive: true, force: true });
});

const URL_A = "https://cdn.example.com/a.mp3";

describe("analyzer configuration", () => {
  it("reports missing ad detection as a configuration error", async () => {
    vi.stubEnv("DETECT_API_KEY", "");
    const err = await analyzeWindow(URL_A, 0, "en", {}, "u1").catch((e) => e);
    expect(err).toBeInstanceOf(AppError);
    expect(err.kind).toBe("config");
  });

  it("reports missing transcription as a configuration error", async () => {
    vi.stubEnv("DETECT_API_KEY", "sk-detect");
    vi.stubEnv("TRANSCRIBE_API_KEY", "");
    const err = await analyzeWindow(URL_A, 0, "en", {}, "u1").catch((e) => e);
    expect(err).toBeInstanceOf(AppError);
    expect(err.kind).toBe("config");
  });

  it("returns nothing cached without detection configured", async () => {
    vi.stubEnv("DETECT_API_KEY", "");
    expect(await cachedAnalysis(URL_A)).toEqual({ windows: [], segments: [], ads: [] });
  });
});

describe("analyzeWindow", () => {
  it("transcribes, detects, stores and records usage, then answers from storage", async () => {
    const url = "https://cdn.example.com/first.mp3";
    const first = await analyzeWindow(url, 300, "en", { podcastTitle: "Show" }, "listener-1");
    expect(first.cached).toBe(false);
    expect(first.segments).toEqual(segmentsAt(300));
    // The ad's end snaps to where speech resumes (340 → 342).
    expect(first.ads).toEqual([{ start: 310, end: 342, confidence: 0.9, reason: "Ad: Acme" }]);
    expect(steps.extractWindow).toHaveBeenCalledWith(url, 300, 300, expect.any(AbortSignal));
    expect(steps.detectAds.mock.calls[0][2]).toEqual({ podcastTitle: "Show" });

    const usage = (await usageForMonth(currentMonth())).get("listener-1");
    expect(usage).toEqual({ audioSeconds: 300, detectCalls: 1, inputTokens: 1000, outputTokens: 50 });

    vi.clearAllMocks();
    const again = await analyzeWindow(url, 300, "en", {}, "listener-2");
    expect(again).toEqual({ ...first, cached: true });
    expect(steps.extractWindow).not.toHaveBeenCalled();
    expect(steps.detectAds).not.toHaveBeenCalled();
    expect((await usageForMonth(currentMonth())).get("listener-2")).toBeUndefined();

    expect(await cachedAnalysis(url)).toEqual({ windows: [300], segments: segmentsAt(300), ads: first.ads });
  });
});

describe("storage consistency", () => {
  /** Makes every write to the usage table fail, as a full disk or a lock would. */
  async function breakUsageWrites() {
    const db = await getDb();
    await db.execute(`CREATE TRIGGER IF NOT EXISTS fail_usage_insert BEFORE INSERT ON usage BEGIN SELECT RAISE(ABORT, 'usage write failed'); END`);
    await db.execute(`CREATE TRIGGER IF NOT EXISTS fail_usage_update BEFORE UPDATE ON usage BEGIN SELECT RAISE(ABORT, 'usage write failed'); END`);
  }
  async function fixUsageWrites() {
    const db = await getDb();
    await db.execute("DROP TRIGGER IF EXISTS fail_usage_insert");
    await db.execute("DROP TRIGGER IF EXISTS fail_usage_update");
  }

  it("never keeps paid work without the usage that paid for it", async () => {
    const url = "https://cdn.example.com/atomic.mp3";
    await breakUsageWrites();
    try {
      await expect(analyzeWindow(url, 0, "en", {}, "listener-3")).rejects.toThrow(/usage write failed/);
    } finally {
      await fixUsageWrites();
    }
    const db = await getDb();
    const windows = await db.execute({ sql: "SELECT COUNT(*) AS n FROM analysis_window WHERE url = ?", args: [url] });
    expect(Number(windows.rows[0].n)).toBe(0);
    const verdicts = await db.execute("SELECT COUNT(*) AS n FROM analysis_verdict");
    const before = Number(verdicts.rows[0].n);

    // Once writes work again, the retry does the work and records both.
    await analyzeWindow(url, 0, "en", {}, "listener-3");
    expect((await usageForMonth(currentMonth())).get("listener-3")?.audioSeconds).toBe(300);
    const after = await db.execute("SELECT COUNT(*) AS n FROM analysis_verdict");
    expect(Number(after.rows[0].n)).toBe(before + 1);
  });

  it("keeps the transcript when only the detection's usage write fails", async () => {
    const url = "https://cdn.example.com/atomic-detect.mp3";
    const db = await getDb();
    // Let the transcription's usage row in, then break writes for the detection.
    steps.detectAds.mockImplementationOnce(async (window: Array<{ start: number }>) => {
      await breakUsageWrites();
      return { ads: [{ start: window[0].start, end: window[0].start + 30, confidence: 0.9, reason: "Ad" }], inputTokens: 1, outputTokens: 1 };
    });
    try {
      await expect(analyzeWindow(url, 0, "en", {}, "listener-4")).rejects.toThrow(/usage write failed/);
    } finally {
      await fixUsageWrites();
    }
    const windows = await db.execute({ sql: "SELECT COUNT(*) AS n FROM analysis_window WHERE url = ?", args: [url] });
    expect(Number(windows.rows[0].n)).toBe(1);
    const verdicts = await db.execute({
      sql: "SELECT COUNT(*) AS n FROM analysis_verdict v JOIN analysis_window w USING (url_key, start) WHERE w.url = ?",
      args: [url],
    });
    expect(Number(verdicts.rows[0].n)).toBe(0);
  });
});

describe("shared work", () => {
  it("runs a window once for listeners asking at the same time", async () => {
    const url = "https://cdn.example.com/shared.mp3";
    const [a, b] = await Promise.all([analyzeWindow(url, 0, "en", {}, "u-a"), analyzeWindow(url, 0, "en", {}, "u-b")]);
    expect(a.segments).toEqual(b.segments);
    expect(steps.extractWindow).toHaveBeenCalledTimes(1);
    expect(steps.detectAds).toHaveBeenCalledTimes(1);
  });

  it("keeps going for the others when one listener leaves", async () => {
    const url = "https://cdn.example.com/shared-leave.mp3";
    let finish!: () => void;
    steps.extractWindow.mockImplementationOnce(() => new Promise((resolve) => (finish = () => resolve(Buffer.from("flac")))));
    const leaving = new AbortController();
    const first = analyzeWindow(url, 0, "en", {}, "u-a", leaving.signal).catch((e) => e);
    const second = analyzeWindow(url, 0, "en", {}, "u-b");
    await vi.waitFor(() => expect(steps.extractWindow).toHaveBeenCalledTimes(1));
    leaving.abort();
    finish();
    expect((await first).name).toBe("AbortError");
    expect((await second).segments).toEqual(segmentsAt(0));
  });

  it("starts fresh work for a listener who arrives while cancelled work is still winding down (E-4)", async () => {
    const url = "https://cdn.example.com/shared-race.mp3";
    // Like ffmpeg: after an abort it takes a moment to actually stop.
    steps.extractWindow.mockImplementationOnce(
      (_url: string, _start: number, _duration: number, signal: AbortSignal) =>
        new Promise((_, reject) =>
          signal.addEventListener("abort", () => setTimeout(() => reject(new DOMException("Aborted", "AbortError")), 50)),
        ),
    );
    const leaving = new AbortController();
    const first = analyzeWindow(url, 0, "en", {}, "u-a", leaving.signal).catch((e) => e);
    await vi.waitFor(() => expect(steps.extractWindow).toHaveBeenCalledTimes(1));
    leaving.abort();

    const second = await analyzeWindow(url, 0, "en", {}, "u-b");
    expect(second.segments).toEqual(segmentsAt(0));
    expect(steps.extractWindow).toHaveBeenCalledTimes(2);
    expect((await first).name).toBe("AbortError");
  });
});

/** What ffmpeg writes past the end of a file: a FLAC stream with metadata and no audio frames. */
const HEADER_ONLY_FLAC = Buffer.concat([Buffer.from("fLaC"), Buffer.from([0x80, 0, 0, 34]), Buffer.alloc(34)]);

describe("the end of the audio", () => {
  it("answers an empty, final window without paying for transcription or storing anything", async () => {
    const url = "https://cdn.example.com/short.mp3";
    await analyzeWindow(url, 0, "en", {}, "listener-end");
    vi.clearAllMocks();
    steps.extractWindow.mockResolvedValue(HEADER_ONLY_FLAC);

    const past = await analyzeWindow(url, 300, "en", {}, "listener-end");
    expect(past).toMatchObject({ window: 300, segments: [], end: true });
    // Ads found so far in the episode still come back.
    expect(past.ads).toHaveLength(1);
    expect(steps.transcribe).not.toHaveBeenCalled();
    expect(steps.detectAds).not.toHaveBeenCalled();
    expect((await cachedAnalysis(url)).windows).toEqual([0]);
    expect((await usageForMonth(currentMonth())).get("listener-end")?.audioSeconds).toBe(300);
  });
});

describe("what the README promises", () => {
  it("redoes detection, not transcription, when the model changes", async () => {
    const url = "https://cdn.example.com/model-change.mp3";
    await analyzeWindow(url, 0, "en", {}, "u-model");
    vi.clearAllMocks();
    vi.stubEnv("DETECT_MODEL", "another-model");
    const redone = await analyzeWindow(url, 0, "en", {}, "u-model");
    expect(redone.cached).toBe(false);
    expect(steps.extractWindow).not.toHaveBeenCalled();
    expect(steps.transcribe).not.toHaveBeenCalled();
    expect(steps.detectAds).toHaveBeenCalledTimes(1);
    expect(steps.detectAds.mock.calls[0][3]).toMatchObject({ model: "another-model" });
  });

  it("gives the detector the previous window's transcript as context", async () => {
    const url = "https://cdn.example.com/context.mp3";
    await analyzeWindow(url, 0, "en", {}, "u-context");
    await analyzeWindow(url, 300, "en", {}, "u-context");
    const [windowSegments, context] = steps.detectAds.mock.calls[1];
    expect(windowSegments).toEqual(segmentsAt(300));
    expect(context).toEqual(segmentsAt(0));
    // The first window has nothing before it.
    expect(steps.detectAds.mock.calls[0][1]).toEqual([]);
  });

  it("keeps the transcript when detection fails, so a retry only redoes detection", async () => {
    const url = "https://cdn.example.com/detect-fails.mp3";
    steps.detectAds.mockRejectedValueOnce(new AppError("detection", "Ad detection failed (500): boom"));
    await expect(analyzeWindow(url, 0, "en", {}, "u-retry")).rejects.toThrow(/boom/);
    vi.clearAllMocks();
    await analyzeWindow(url, 0, "en", {}, "u-retry");
    expect(steps.transcribe).not.toHaveBeenCalled();
    expect(steps.detectAds).toHaveBeenCalledTimes(1);
    // Transcription was paid once, detection once (the failed call cost nothing recorded).
    expect((await usageForMonth(currentMonth())).get("u-retry")).toMatchObject({ audioSeconds: 300, detectCalls: 1 });
  });

  it("stores nothing when transcription fails", async () => {
    const url = "https://cdn.example.com/transcribe-fails.mp3";
    steps.transcribe.mockRejectedValueOnce(new AppError("transcription", "Transcription failed (503): down"));
    await expect(analyzeWindow(url, 0, "en", {}, "u-t")).rejects.toThrow(/down/);
    expect(await cachedAnalysis(url)).toEqual({ windows: [], segments: [], ads: [] });
    expect(steps.detectAds).not.toHaveBeenCalled();
  });

  it("merges an ad that spans a window boundary into one", async () => {
    const url = "https://cdn.example.com/boundary.mp3";
    steps.detectAds
      .mockResolvedValueOnce({ ads: [{ start: 280, end: 300, confidence: 0.9, reason: "Ad: Acme" }], inputTokens: 1, outputTokens: 1 })
      .mockResolvedValueOnce({ ads: [{ start: 300, end: 330, confidence: 0.9, reason: "Ad: Acme" }], inputTokens: 1, outputTokens: 1 });
    await analyzeWindow(url, 0, "en", {}, "u-b");
    const second = await analyzeWindow(url, 300, "en", {}, "u-b");
    expect(second.ads).toEqual([{ start: 280, end: 330, confidence: 0.9, reason: "Ad: Acme" }]);
  });
});
