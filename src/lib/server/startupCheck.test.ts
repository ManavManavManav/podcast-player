import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { checkConfiguration } from "@/lib/server/startupCheck";

let lines: Array<Record<string, unknown>>;

beforeEach(() => {
  lines = [];
  const capture = (line: string) => lines.push(JSON.parse(line));
  vi.spyOn(console, "log").mockImplementation(capture);
  vi.spyOn(console, "error").mockImplementation(capture);
  vi.stubEnv("PODBLOCK_LOG_LEVEL", "info");
  vi.stubEnv("VERCEL", "");
  vi.stubEnv("BETTER_AUTH_SECRET", "x".repeat(48));
  vi.stubEnv("BETTER_AUTH_URL", "https://podblock.example.com");
  vi.stubEnv("PODBLOCK_ADMIN_EMAIL", "owner@example.com");
  vi.stubEnv("PODCAST_INDEX_API_KEY", "k");
  vi.stubEnv("PODCAST_INDEX_API_SECRET", "s");
  vi.stubEnv("TRANSCRIBE_API_KEY", "t");
  vi.stubEnv("DETECT_API_KEY", "d");
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
});

describe("startup check", () => {
  it("starts quietly with a complete configuration", async () => {
    vi.stubEnv("NODE_ENV", "production");
    checkConfiguration();
    expect(lines).toEqual([]);
  });

  it("refuses to start in production with a broken configuration, saying what's wrong", async () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("BETTER_AUTH_SECRET", "");
    expect(() => checkConfiguration()).toThrow(/BETTER_AUTH_SECRET/);
    expect(lines).toContainEqual(expect.objectContaining({ level: "error", event: "config.invalid" }));
  });

  it("only warns in development", async () => {
    vi.stubEnv("NODE_ENV", "development");
    vi.stubEnv("TRANSCRIBE_BASE_URL", "not a url");
    checkConfiguration();
    expect(lines).toContainEqual(expect.objectContaining({ level: "error", event: "config.invalid" }));
  });

  it("logs what won't work", async () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("DETECT_API_KEY", "");
    checkConfiguration();
    expect(lines).toEqual([expect.objectContaining({ level: "warn", event: "config.warning", message: expect.stringContaining("DETECT_API_KEY") })]);
  });
});
