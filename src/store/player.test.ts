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
  usePlayer.setState({
    episode: null,
    positions: {},
    recent: [],
    following: {},
    stats: { adsSkipped: 0, secondsSaved: 0 },
    autoplay: false,
  });
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

describe("what plays next", () => {
  // A show's list, newest first as feeds are: episode n was published on day n.
  const show = [5, 4, 3, 2, 1].map((n) => ({ ...episode(n), publishedAt: n * 86_400, description: "long show notes" }));

  it("goes to the next older episode by default", () => {
    usePlayer.getState().play(show[0], show);
    expect(usePlayer.getState().nextAfter(show[0])?.id).toBe(4);
  });

  it("goes newer when you've been catching up in order", () => {
    usePlayer.getState().play(show[4], show); // episode 1
    usePlayer.getState().play(show[3], show); // then episode 2
    expect(usePlayer.getState().nextAfter(show[3])?.id).toBe(3);
  });

  it("skips episodes already played", () => {
    usePlayer.setState({ positions: { "4": { time: 3590, duration: 3600, updatedAt: 1 } } });
    usePlayer.getState().play(show[0], show);
    expect(usePlayer.getState().nextAfter(show[0])?.id).toBe(3);
  });

  it("has nothing next without a list", () => {
    usePlayer.getState().play(episode(9));
    expect(usePlayer.getState().nextAfter(episode(9))).toBeNull();
  });

  it("has nothing next after the oldest episode", () => {
    usePlayer.getState().play(show[4], show);
    expect(usePlayer.getState().nextAfter(show[4])).toBeNull();
  });

  it("keeps neighbours without their descriptions, and only for recent episodes", () => {
    usePlayer.getState().play(show[0], show);
    const kept = usePlayer.getState().following["5"];
    expect(kept.older.map((e) => e.id)).toEqual([4, 3, 2, 1]);
    expect(kept.older.every((e) => e.description === "")).toBe(true);
    for (let i = 100; i < 113; i++) usePlayer.getState().play(episode(i));
    expect(usePlayer.getState().following["5"]).toBeUndefined();
  });
});
