import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fetchWithRetry } from "@/lib/server/retry";

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

const status = (code: number, headers: Record<string, string> = {}) => new Response(null, { status: code, headers });

describe("fetchWithRetry", () => {
  it("returns a good answer straight away", async () => {
    const send = vi.fn(async () => status(200));
    expect((await fetchWithRetry(send)).status).toBe(200);
    expect(send).toHaveBeenCalledTimes(1);
  });

  it.each([429, 500, 502, 503, 504])("retries once after a %i", async (code) => {
    const send = vi.fn().mockResolvedValueOnce(status(code)).mockResolvedValueOnce(status(200));
    const pending = fetchWithRetry(send);
    await vi.advanceTimersByTimeAsync(3_000);
    expect((await pending).status).toBe(200);
    expect(send).toHaveBeenCalledTimes(2);
  });

  it.each([400, 401, 403, 404, 422])("doesn't retry a %i", async (code) => {
    const send = vi.fn(async () => status(code));
    expect((await fetchWithRetry(send)).status).toBe(code);
    expect(send).toHaveBeenCalledTimes(1);
  });

  it("waits as long as Retry-After asks", async () => {
    const send = vi.fn().mockResolvedValueOnce(status(429, { "retry-after": "4" })).mockResolvedValueOnce(status(200));
    const pending = fetchWithRetry(send);
    await vi.advanceTimersByTimeAsync(3_900);
    expect(send).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(200);
    expect(send).toHaveBeenCalledTimes(2);
    expect((await pending).status).toBe(200);
  });

  it("understands Retry-After dates", async () => {
    vi.setSystemTime(new Date("2026-09-26T12:00:00Z"));
    const later = new Date("2026-09-26T12:00:05Z").toUTCString();
    const send = vi.fn().mockResolvedValueOnce(status(503, { "retry-after": later })).mockResolvedValueOnce(status(200));
    const pending = fetchWithRetry(send);
    await vi.advanceTimersByTimeAsync(4_900);
    expect(send).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(200);
    expect((await pending).status).toBe(200);
  });

  it("gives up rather than wait longer than the cap", async () => {
    const send = vi.fn(async () => status(429, { "retry-after": "120" }));
    const res = await fetchWithRetry(send, { maxWaitMs: 10_000 });
    expect(res.status).toBe(429);
    expect(send).toHaveBeenCalledTimes(1);
  });

  it("hands back the second failure if the retry also fails", async () => {
    const send = vi.fn(async () => status(503));
    const pending = fetchWithRetry(send);
    await vi.advanceTimersByTimeAsync(3_000);
    expect((await pending).status).toBe(503);
    expect(send).toHaveBeenCalledTimes(2);
  });

  it("retries once after a network error", async () => {
    const send = vi.fn().mockRejectedValueOnce(new TypeError("fetch failed")).mockResolvedValueOnce(status(200));
    const pending = fetchWithRetry(send);
    await vi.advanceTimersByTimeAsync(3_000);
    expect((await pending).status).toBe(200);

    const failing = vi.fn(async () => {
      throw new TypeError("fetch failed");
    });
    const twice = fetchWithRetry(failing).catch((e) => e);
    await vi.advanceTimersByTimeAsync(3_000);
    expect(await twice).toBeInstanceOf(TypeError);
    expect(failing).toHaveBeenCalledTimes(2);
  });

  it("doesn't retry an aborted request, and stops waiting when aborted", async () => {
    const aborted = vi.fn(async () => {
      throw new DOMException("Aborted", "AbortError");
    });
    await expect(fetchWithRetry(aborted)).rejects.toThrow(/Aborted/);
    expect(aborted).toHaveBeenCalledTimes(1);

    const controller = new AbortController();
    const send = vi.fn(async () => status(503));
    const pending = fetchWithRetry(send, { signal: controller.signal }).catch((e) => e);
    await vi.advanceTimersByTimeAsync(100);
    controller.abort();
    expect((await pending).name).toBe("AbortError");
    expect(send).toHaveBeenCalledTimes(1);
  });

  it("logs each retry with what went wrong", async () => {
    vi.stubEnv("PODBLOCK_LOG_LEVEL", "info");
    const warn = vi.spyOn(console, "error").mockImplementation(() => {});
    const send = vi.fn().mockResolvedValueOnce(status(429, { "retry-after": "2" })).mockResolvedValueOnce(status(200));
    const pending = fetchWithRetry(send, { label: "transcription" });
    await vi.advanceTimersByTimeAsync(2_000);
    await pending;
    expect(JSON.parse(String(warn.mock.calls[0][0]))).toMatchObject({ event: "provider.retry", provider: "transcription", status: 429, waitMs: 2000 });
    vi.unstubAllEnvs();
    warn.mockRestore();
  });
});
