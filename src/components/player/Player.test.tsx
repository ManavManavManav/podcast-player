// @vitest-environment happy-dom
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Player } from "@/components/player/Player";
import type { AdRange, Episode } from "@/lib/types";
import { useAnalysis } from "@/store/analysis";
import { usePlayback, usePlayer } from "@/store/player";

const SOURCE = "https://cdn.example/pinned/ep.mp3";
const episode = {
  id: 7,
  title: "An episode",
  podcastTitle: "A show",
  podcastId: 3,
  audioUrl: "https://feed.example/ep.mp3",
  image: "",
  duration: 1800,
  language: "en",
} as Episode;
const ad = (start: number, end: number): AdRange => ({ start, end, confidence: 0.9, reason: "Ad: Acme" });

let paused = true;
let audio: HTMLAudioElement;
let resolveCalls: Array<{ url: string; fresh?: boolean }> = [];
/** What /api/resolve pins; changes when a stale link is re-pinned. */
let pinned = SOURCE;
const mediaHandlers = new Map<string, (details: MediaSessionActionDetails) => void>();

beforeEach(async () => {
  paused = true;
  vi.spyOn(HTMLMediaElement.prototype, "load").mockImplementation(() => {});
  vi.spyOn(HTMLMediaElement.prototype, "pause").mockImplementation(() => {
    paused = true;
  });
  vi.spyOn(HTMLMediaElement.prototype, "play").mockImplementation(async () => {
    paused = false;
  });
  Object.defineProperty(HTMLMediaElement.prototype, "paused", { get: () => paused, configurable: true });
  resolveCalls = [];
  pinned = SOURCE;
  mediaHandlers.clear();
  Object.defineProperty(navigator, "mediaSession", {
    configurable: true,
    value: { metadata: null, playbackState: "none", setActionHandler: (action: string, handler: never) => mediaHandlers.set(action, handler) },
  });
  vi.stubGlobal("MediaMetadata", class { constructor(readonly init: object) {} });
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo | URL, init: RequestInit = {}) => {
      if (String(input).startsWith("/api/resolve")) {
        resolveCalls.push(JSON.parse(String(init.body)));
        return Response.json({ url: pinned });
      }
      if (init.method === "POST") return new Promise<Response>(() => {}); // analysis stays in flight
      return Response.json({ windows: [], segments: [], ads: [] });
    }),
  );
  localStorage.clear();
  usePlayer.setState({ episode, autoplay: false, autoSkip: true, positions: {}, stats: { adsSkipped: 0, secondsSaved: 0 } });
  usePlayback.setState({ source: null, currentTime: 0, duration: 0 });

  render(<Player userId="u1" />);
  await act(async () => {}); // resolve the pinned URL; the scanner resets the analysis store
  audio = document.querySelector("audio")!;
  expect(usePlayback.getState().source).toBe(SOURCE);
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

/** Analysis results as the scanner would store them. */
function analyzed(ads: AdRange[], windows: number[] = [0, 300, 600]) {
  act(() => useAnalysis.setState({ ads, windows: Object.fromEntries(windows.map((w) => [w, "done" as const])) }));
}

/** Playback reaching `t`, as the element reports it. */
function playTo(t: number) {
  paused = false;
  act(() => {
    audio.currentTime = t;
    fireEvent.timeUpdate(audio);
  });
}

/** The listener dragging the seek bar to `t`. */
function listenerSeeks(t: number) {
  act(() => {
    audio.currentTime = t;
    fireEvent.seeking(audio);
  });
}

describe("auto-skip", () => {
  it("jumps over an ad the playhead reaches, and says so", () => {
    analyzed([ad(10, 40)]);
    playTo(9.8);
    playTo(10.1);
    expect(audio.currentTime).toBe(40);
    expect(screen.getByText(/Skipped a 30 sec ad/)).toBeTruthy();
    expect(usePlayer.getState().stats).toEqual({ adsSkipped: 1, secondsSaved: expect.closeTo(29.9, 5) });
  });

  it("leaves ads alone when skipping is off", () => {
    analyzed([ad(10, 40)]);
    act(() => usePlayer.setState({ autoSkip: false }));
    playTo(9.8);
    playTo(10.1);
    expect(audio.currentTime).toBe(10.1);
  });

  it("plays an ad the listener deliberately seeked into", () => {
    analyzed([ad(100, 160)]);
    playTo(5);
    listenerSeeks(120);
    playTo(120.3);
    expect(audio.currentTime).toBe(120.3);
  });

  it("doesn't skip the last sliver of an ad", () => {
    analyzed([ad(10, 11.2)]);
    playTo(9.8);
    playTo(10.0);
    expect(audio.currentTime).toBe(10);
  });

  it("goes back to the ad and plays it on Undo", () => {
    analyzed([ad(10, 40)]);
    usePlayback.setState({ duration: 1800 });
    playTo(9.8);
    playTo(10.1);
    fireEvent.click(screen.getByRole("button", { name: "Undo" }));
    expect(audio.currentTime).toBe(10);
    playTo(10.3);
    expect(audio.currentTime).toBe(10.3);
  });

  it("waits at the end of an ad break that reaches what's been analyzed, then carries on", () => {
    // The ad runs to 300 s, where analysis stops: it may continue into the next window.
    analyzed([ad(250, 300)], [0]);
    act(() => useAnalysis.getState().setStatus(300, "pending"));
    playTo(249.8);
    playTo(250.1);
    expect(audio.currentTime).toBe(300);
    expect(paused).toBe(true);
    expect(usePlayback.getState().holding).toBe(true);
    expect(screen.getByText(/Skipping ad break/)).toBeTruthy();

    act(() => useAnalysis.getState().setStatus(300, "done"));
    expect(paused).toBe(false);
    expect(usePlayback.getState().holding).toBe(false);
  });

  it("doesn't wait forever for the next window", () => {
    vi.useFakeTimers();
    analyzed([ad(250, 300)], [0]);
    act(() => useAnalysis.getState().setStatus(300, "pending"));
    playTo(249.8);
    playTo(250.1);
    expect(paused).toBe(true);
    act(() => vi.advanceTimersByTime(15_000));
    expect(paused).toBe(false);
  });
});

describe("loading", () => {
  it("re-pins a stale audio link once, and picks up where it was", async () => {
    playTo(42);
    pinned = "https://cdn.example/pinned-again/ep.mp3";
    await act(async () => {
      fireEvent.error(audio);
    });
    expect(resolveCalls.at(-1)).toEqual({ url: episode.audioUrl, fresh: true });
    expect(audio.getAttribute("src")).toBe("https://cdn.example/pinned-again/ep.mp3");
    act(() => {
      fireEvent.loadedMetadata(audio);
    });
    expect(audio.currentTime).toBe(42);
    expect(usePlayback.getState().error).toBeNull();

    // A second failure is reported, not retried forever.
    await act(async () => {
      fireEvent.error(audio);
    });
    expect(resolveCalls.filter((c) => c.fresh)).toHaveLength(1);
    expect(usePlayback.getState().error).toMatch(/couldn't be loaded/);
  });
});

describe("load errors", () => {
  it("says so under the title, and Retry loads the episode again", async () => {
    await act(async () => fireEvent.error(audio)); // re-pinned once
    await act(async () => fireEvent.error(audio)); // then reported
    expect(screen.getByText(/Couldn't load this episode's audio/)).toBeTruthy();
    const pinsBefore = resolveCalls.length;
    await act(async () => fireEvent.click(screen.getByRole("button", { name: "Retry" })));
    expect(resolveCalls.length).toBe(pinsBefore + 1);
    expect(usePlayback.getState().error).toBeNull();
    expect(screen.queryByText(/Couldn't load/)).toBeNull();
  });
});

describe("end of episode", () => {
  const next = { ...episode, id: 8, title: "The next one", publishedAt: 50 } as Episode;

  function reachTheEnd() {
    act(() => {
      usePlayer.setState({ recent: [episode], following: { "7": { newer: [], older: [next] } } });
      audio.currentTime = 1799;
      fireEvent.timeUpdate(audio);
      fireEvent.ended(audio);
    });
  }

  it("counts down, then starts the next episode", () => {
    vi.useFakeTimers();
    reachTheEnd();
    expect(screen.getByText(/Up next in/).textContent).toMatch(/Up next in 5: The next one/);
    act(() => vi.advanceTimersByTime(5_000));
    expect(usePlayer.getState().episode?.id).toBe(8);
    expect(usePlayer.getState().autoplay).toBe(true);
  });

  it("stops at Finished when cancelled, and can replay", () => {
    vi.useFakeTimers();
    reachTheEnd();
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    act(() => vi.advanceTimersByTime(10_000));
    expect(usePlayer.getState().episode?.id).toBe(7);
    expect(screen.getByText(/^Finished/)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Replay" }));
    expect(audio.currentTime).toBe(0);
    expect(paused).toBe(false);
  });

  it("doesn't start anything when auto-start is off", () => {
    vi.useFakeTimers();
    act(() => usePlayer.setState({ autoNext: false }));
    reachTheEnd();
    act(() => vi.advanceTimersByTime(10_000));
    expect(usePlayer.getState().episode?.id).toBe(7);
    expect(screen.getByText(/^Finished/)).toBeTruthy();
    act(() => usePlayer.setState({ autoNext: true }));
  });
});

describe("media keys", () => {
  it("pauses on pause and plays on play, whatever the current state", () => {
    paused = true;
    act(() => mediaHandlers.get("pause")!({ action: "pause" }));
    expect(paused).toBe(true);
    act(() => mediaHandlers.get("play")!({ action: "play" }));
    expect(paused).toBe(false);
    act(() => mediaHandlers.get("play")!({ action: "play" }));
    expect(paused).toBe(false);
    act(() => mediaHandlers.get("pause")!({ action: "pause" }));
    expect(paused).toBe(true);
  });
});
