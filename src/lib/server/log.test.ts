import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { log, requestId, withRequestContext } from "@/lib/server/log";

let lines: Array<Record<string, unknown>>;

beforeEach(() => {
  lines = [];
  const capture = (line: string) => lines.push(JSON.parse(line));
  vi.spyOn(console, "log").mockImplementation(capture);
  vi.spyOn(console, "error").mockImplementation(capture);
  vi.stubEnv("PODBLOCK_LOG_LEVEL", "debug");
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
});

describe("log", () => {
  it("writes one JSON object per event", () => {
    log.info("analysis.detected", { window: 300, ads: 2 });
    expect(lines).toHaveLength(1);
    expect(lines[0]).toMatchObject({ level: "info", event: "analysis.detected", window: 300, ads: 2 });
    expect(Date.parse(String(lines[0].time))).not.toBeNaN();
  });

  it("sends warnings and errors to stderr", () => {
    log.info("a");
    log.error("b");
    expect(vi.mocked(console.log)).toHaveBeenCalledTimes(1);
    expect(vi.mocked(console.error)).toHaveBeenCalledTimes(1);
  });

  it("drops events below the configured level", () => {
    vi.stubEnv("PODBLOCK_LOG_LEVEL", "warn");
    log.debug("quiet");
    log.info("quiet");
    log.warn("loud");
    expect(lines.map((l) => l.event)).toEqual(["loud"]);
  });

  it("is silent in tests unless asked", () => {
    vi.stubEnv("PODBLOCK_LOG_LEVEL", "");
    log.error("nobody hears this");
    expect(lines).toEqual([]);
  });

  it("describes errors, with their causes", () => {
    const cause = new Error("socket hang up");
    log.error("analysis.failed", { err: new Error("Transcription failed (502)", { cause }) });
    expect(lines[0].err).toMatchObject({ name: "Error", message: "Transcription failed (502)", cause: { message: "socket hang up" } });
    expect(String((lines[0].err as { stack: string }).stack)).toContain("log.test.ts");
  });

  it("tags events with the request they belong to", async () => {
    const req = new Request("http://localhost/api/analyze", { headers: { "x-request-id": "req-123" } });
    await withRequestContext(req, async () => {
      await Promise.resolve();
      log.info("inside");
      expect(requestId()).toBe("req-123");
    });
    log.info("outside");
    expect(lines[0].requestId).toBe("req-123");
    expect(lines[1].requestId).toBeUndefined();
  });

  it("makes up a request id when the platform doesn't send one", async () => {
    await withRequestContext(new Request("http://localhost/x"), async () => log.info("inside"));
    expect(String(lines[0].requestId)).toMatch(/^[0-9a-f-]{36}$/);
  });

  it("never writes configured secrets, even inside messages", () => {
    vi.stubEnv("TRANSCRIBE_API_KEY", "gsk_live_abcdef123456");
    vi.stubEnv("BETTER_AUTH_SECRET", "a-very-long-auth-secret-value");
    log.error("provider.failed", { message: "Invalid API Key: gsk_live_abcdef123456", header: "a-very-long-auth-secret-value" });
    const written = JSON.stringify(lines);
    expect(written).not.toContain("gsk_live_abcdef123456");
    expect(written).not.toContain("a-very-long-auth-secret-value");
    expect(written).toContain("[redacted]");
  });
});
