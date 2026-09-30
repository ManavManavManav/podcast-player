// @vitest-environment happy-dom
import { act, cleanup, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { retryScanning, useAdScanner } from "@/hooks/useAdScanner";
import type { Episode } from "@/lib/types";
import { useAnalysis } from "@/store/analysis";
import { usePlayback, usePlayer } from "@/store/player";

const URL_A = "https://cdn.example/a.mp3";

/** A POST /api/analyze the test answers by hand. */
interface Pending {
  window: number;
  signal: AbortSignal;
  respond: (status: number, body: object, headers?: Record<string, string>) => void;
}
let pending: Pending[] = [];
let gets: string[] = [];

function fakeFetch(input: RequestInfo | URL, init: RequestInit = {}) {
  const url = String(input);
  if (!init.method || init.method === "GET") {
    gets.push(url);
    return Promise.resolve(Response.json({ windows: [], segments: [], ads: [] }));
  }
  const { window } = JSON.parse(String(init.body));
  return new Promise<Response>((resolve, reject) => {
    const signal = init.signal!;
    signal.addEventListener("abort", () => reject(new DOMException("Aborted", "AbortError")));
    pending.push({ window, signal, respond: (status, body, headers) => resolve(Response.json(body, { status, headers })) });
  });
}

const segments = (w: number) => [{ start: w + 1, end: w + 5, text: `at ${w}` }];
const ok = (w: number, extra: object = {}) => ({ window: w, segments: segments(w), ads: [], cached: false, ...extra });
const windowsAsked = () => pending.map((p) => p.window);
/** Answers the oldest request for window `w`. */
async function answer(w: number, status = 200, body: object = ok(w), headers?: Record<string, string>) {
  const index = pending.findIndex((p) => p.window === w && !p.signal.aborted);
  const [request] = pending.splice(index, 1);
  await act(async () => request.respond(status, body, headers));
}
const asked = (w: number) => pending.filter((p) => p.window === w && !p.signal.aborted).length;
const flush = () => act(async () => {});

beforeEach(() => {
  pending = [];
  gets = [];
  vi.stubGlobal("fetch", vi.fn(fakeFetch));
  usePlayer.setState({ episode: { id: 1, title: "Ep", podcastTitle: "Show", language: "en-US" } as Episode });
  usePlayback.setState({ source: URL_A, duration: 1500, currentTime: 0 });
  useAnalysis.getState().reset(null);
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("useAdScanner", () => {
  it("restores what's stored, then asks for the playhead's window and the next", async () => {
    renderHook(() => useAdScanner(true));
    await flush();
    expect(gets).toHaveLength(1);
    expect(new URL(gets[0], "http://x").searchParams.get("url")).toBe(URL_A);
    expect(windowsAsked()).toEqual([0, 300]);
    expect(useAnalysis.getState().windows).toEqual({ 0: "pending", 300: "pending" });

    await answer(0);
    await answer(300);
    expect(useAnalysis.getState().windows).toEqual({ 0: "done", 300: "done" });
    expect(useAnalysis.getState().segments.map((s) => s.text)).toEqual(["at 0", "at 300"]);
  });

  it("does nothing while disabled or without a source", async () => {
    renderHook(() => useAdScanner(false));
    await flush();
    expect(pending).toEqual([]);
  });

  it("follows the playhead, and doesn't ask past the end of the episode", async () => {
    renderHook(() => useAdScanner(true));
    await flush();
    await answer(0);
    await answer(300);
    act(() => usePlayback.setState({ currentTime: 1250 }));
    await flush();
    // 1200 is the last window of a 1500 s episode; nothing after it.
    expect(windowsAsked()).toEqual([1200]);
  });

  it("cancels windows the listener has seeked away from", async () => {
    renderHook(() => useAdScanner(true));
    await flush();
    const [first, second] = pending;
    act(() => usePlayback.setState({ currentTime: 905 }));
    await flush();
    expect(first.signal.aborted && second.signal.aborted).toBe(true);
    expect(useAnalysis.getState().windows).toEqual({ 900: "pending", 1200: "pending" });
  });

  it("retries a failed window after a pause", async () => {
    vi.useFakeTimers();
    renderHook(() => useAdScanner(true));
    await flush();
    await answer(0, 502, { error: "The ad detector didn't answer." });
    expect(useAnalysis.getState().windows[0]).toBe("error");
    await act(() => vi.advanceTimersByTimeAsync(8_000));
    expect(windowsAsked().filter((w) => w === 0)).toHaveLength(1);
    expect(useAnalysis.getState().windows[0]).toBe("pending");
  });

  it("stops after three failures in a row and shows why, until the listener retries", async () => {
    vi.useFakeTimers();
    renderHook(() => useAdScanner(true));
    await flush();
    await answer(0, 502, { error: "down" });
    await answer(300, 502, { error: "down" });
    await act(() => vi.advanceTimersByTimeAsync(8_000));
    await answer(0, 502, { error: "still down" });
    expect(useAnalysis.getState().error).toBe("still down");
    const before = pending.length;
    await act(() => vi.advanceTimersByTimeAsync(60_000));
    expect(pending.length).toBe(before); // stopped: nothing new is asked for
    act(() => retryScanning());
    await flush();
    expect(useAnalysis.getState().error).toBeNull();
    expect(windowsAsked()).toContain(0);
  });

  it("treats a window past the end of the audio as done", async () => {
    renderHook(() => useAdScanner(true));
    await flush();
    await answer(0, 200, { window: 0, segments: [], ads: [], cached: false, end: true });
    expect(useAnalysis.getState().windows[0]).toBe("done");
  });

  it("starts over for a new episode, cancelling the old one's work", async () => {
    renderHook(() => useAdScanner(true));
    await flush();
    const old = [...pending];
    act(() => usePlayback.setState({ source: "https://cdn.example/b.mp3", currentTime: 0 }));
    await flush();
    expect(old.every((p) => p.signal.aborted)).toBe(true);
    expect(useAnalysis.getState().url).toBe("https://cdn.example/b.mp3");
    expect(gets).toHaveLength(2);
  });

  it("waits as long as the server asks before retrying", async () => {
    vi.useFakeTimers();
    renderHook(() => useAdScanner(true));
    await flush();
    await answer(0, 503, { error: "Busy", code: "timeout" }, { "Retry-After": "20" });
    await act(() => vi.advanceTimersByTimeAsync(19_000));
    expect(asked(0)).toBe(0);
    await act(() => vi.advanceTimersByTimeAsync(1_000));
    expect(asked(0)).toBe(1);
  });

  it("backs off further after each failure in a row", async () => {
    vi.useFakeTimers();
    renderHook(() => useAdScanner(true));
    await flush();
    await answer(300, 200);
    await answer(0, 502, { error: "down" });
    await act(() => vi.advanceTimersByTimeAsync(8_000));
    await answer(0, 502, { error: "down" });
    await act(() => vi.advanceTimersByTimeAsync(8_000));
    expect(asked(0)).toBe(0); // second failure: 16 s
    await act(() => vi.advanceTimersByTimeAsync(8_000));
    expect(asked(0)).toBe(1);
  });

  it("keeps retrying windows that ran out of time, without giving up", async () => {
    vi.useFakeTimers();
    renderHook(() => useAdScanner(true));
    await flush();
    await answer(300, 200);
    for (let i = 0; i < 4; i++) {
      await answer(0, 503, { error: "Taking longer than usual", code: "timeout" }, { "Retry-After": "10" });
      await act(() => vi.advanceTimersByTimeAsync(10_000));
    }
    expect(useAnalysis.getState().error).toBeNull();
    expect(asked(0)).toBe(1);
  });

  it("waits out rate limits for as long as they last, without giving up", async () => {
    vi.useFakeTimers();
    renderHook(() => useAdScanner(true));
    await flush();
    await answer(300, 200);
    for (let i = 0; i < 4; i++) {
      await answer(0, 503, { error: "Hourly limit", code: "rate_limit" }, { "Retry-After": "102" });
      await act(() => vi.advanceTimersByTimeAsync(101_000));
      expect(asked(0)).toBe(0);
      await act(() => vi.advanceTimersByTimeAsync(1_000));
    }
    expect(useAnalysis.getState().error).toBeNull();
    expect(asked(0)).toBe(1);
  });

  it("stops straight away when the server isn't set up for ad detection", async () => {
    renderHook(() => useAdScanner(true));
    await flush();
    await answer(0, 503, { error: "Ad detection isn't set up on this server yet.", code: "config" });
    expect(useAnalysis.getState().error).toBe("Ad detection isn't set up on this server yet.");
  });
});
