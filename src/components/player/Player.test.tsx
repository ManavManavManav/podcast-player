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
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo | URL, init: RequestInit = {}) => {
      if (String(input).startsWith("/api/resolve")) return Response.json({ url: SOURCE });
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
