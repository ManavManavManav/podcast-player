// @vitest-environment happy-dom
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Episode } from "@/lib/types";
import { usePlayback, usePlayer } from "@/store/player";

const episode = (id: number, duration = 3600): Episode => ({
  id,
  title: `Ep ${id}`,
  description: "",
  audioUrl: `https://cdn.example/${id}.mp3`,
  image: "",
  duration,
  publishedAt: 0,
  season: null,
  episode: null,
  podcastId: 1,
  podcastTitle: "Show",
  language: "en",
});

beforeEach(() => {
  usePlayer.setState({ episode: null, positions: {}, recent: [], stats: { adsSkipped: 0, secondsSaved: 0 }, autoplay: false });
  usePlayback.setState({ audio: null, currentTime: 0, duration: 0, playing: false });
});

describe("player store", () => {
  it("plays an episode, saving the previous one's position and keeping a recent list", () => {
    usePlayer.getState().play(episode(1));
    usePlayback.setState({ currentTime: 120, duration: 3600 });
    usePlayer.getState().play(episode(2));
    const s = usePlayer.getState();
    expect(s.episode?.id).toBe(2);
    expect(s.autoplay).toBe(true);
    expect(s.recent.map((e) => e.id)).toEqual([2, 1]);
    expect(s.positions["1"]).toMatchObject({ time: 120, duration: 3600 });
  });

  it("keeps at most 12 recent episodes, most recent first, without duplicates", () => {
    for (let id = 1; id <= 14; id++) usePlayer.getState().play(episode(id));
    usePlayer.getState().play(episode(5));
    const ids = usePlayer.getState().recent.map((e) => e.id);
    expect(ids).toHaveLength(12);
    expect(ids[0]).toBe(5);
    expect(new Set(ids).size).toBe(12);
  });

  it("resumes where the listener left off, but not near the start or after the end", () => {
    const s = usePlayer.getState();
    usePlayer.setState({ positions: { "1": { time: 600, duration: 3600, updatedAt: 1 } } });
    expect(s.resumePoint(episode(1))).toBe(600);
    usePlayer.setState({ positions: { "1": { time: 3, duration: 3600, updatedAt: 1 } } });
    expect(s.resumePoint(episode(1))).toBe(0);
    usePlayer.setState({ positions: { "1": { time: 3590, duration: 3600, updatedAt: 1 } } });
    expect(s.resumePoint(episode(1))).toBe(0);
    expect(s.resumePoint(episode(9))).toBe(0);
  });

  it("doesn't save a position in the first second", () => {
    usePlayer.setState({ episode: episode(1) });
    usePlayback.setState({ currentTime: 0.5 });
    usePlayer.getState().savePosition();
    expect(usePlayer.getState().positions).toEqual({});
  });

  it("keeps only the 300 most recently updated positions", () => {
    const positions = Object.fromEntries(
      Array.from({ length: 300 }, (_, i) => [String(i), { time: 60, duration: 3600, updatedAt: i + 1 }]),
    );
    usePlayer.setState({ positions, episode: episode(999) });
    usePlayback.setState({ currentTime: 30, duration: 3600 });
    usePlayer.getState().savePosition();
    const kept = usePlayer.getState().positions;
    expect(Object.keys(kept)).toHaveLength(300);
    expect(kept["0"]).toBeUndefined(); // the oldest went
    expect(kept["999"]).toBeDefined();
  });

  it("clamps seeks to the episode and counts skipped ads", () => {
    const audio = { currentTime: 0, duration: 100 } as HTMLAudioElement;
    usePlayback.setState({ audio, duration: 100 });
    usePlayer.getState().seek(500);
    expect(audio.currentTime).toBe(99.5);
    usePlayer.getState().seek(-5);
    expect(audio.currentTime).toBe(0);
    usePlayer.getState().recordSkip(30, true);
    usePlayer.getState().recordSkip(10, false);
    expect(usePlayer.getState().stats).toEqual({ adsSkipped: 1, secondsSaved: 40 });
  });

  it("sets a sleep timer as a wall-clock time", () => {
    vi.setSystemTime(new Date("2026-09-26T12:00:00Z"));
    usePlayer.getState().setSleep(15);
    expect(usePlayer.getState().sleepAt).toBe(Date.parse("2026-09-26T12:15:00Z"));
    usePlayer.getState().setSleep(null);
    expect(usePlayer.getState().sleepAt).toBeNull();
    vi.useRealTimers();
  });
});
