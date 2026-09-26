import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, describe, expect, it, vi } from "vitest";

const dir = fs.mkdtempSync(path.join(os.tmpdir(), "podblock-analyzer-"));
vi.stubEnv("DATABASE_URL", `file:${path.join(dir, "test.db")}`);

const { analyzeWindow, cachedAnalysis } = await import("@/lib/server/analyzer");
const { AppError } = await import("@/lib/server/errors");

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
