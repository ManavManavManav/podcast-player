"use client";

import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";
import type { Episode } from "@/lib/types";

export const PLAYBACK_RATES = [0.8, 1, 1.2, 1.5, 1.75, 2] as const;
/** How far the back and forward buttons, keys and media keys jump. */
export const BACK_SECONDS = 15;
export const FORWARD_SECONDS = 30;
/** A fine step, for Shift+arrow on the seek bar. */
export const FINE_SECONDS = 5;

// --- Live playback state -------------------------------------------------------
// Changes several times a second, so it lives in its own store that is never
// written to localStorage.

interface PlaybackState {
  /** The <audio> element owned by <Player>. */
  audio: HTMLAudioElement | null;
  /**
   * The exact audio file being played (the episode URL after redirects),
   * shared with the ad scanner so both see the same ad-stitched variant.
   */
  source: string | null;
  playing: boolean;
  buffering: boolean;
  /** Paused at the end of an ad break while checking whether it continues. */
  holding: boolean;
  currentTime: number;
  duration: number;
  error: string | null;
  /** Bumped to load the current episode's audio again (Retry after an error). */
  reloadToken: number;
  /** Playback reached the end of the episode. */
  ended: boolean;
  /** Ads skipped in this episode so far, and the seconds saved. */
  episodeSkips: { count: number; seconds: number };
  /** After the episode ends: what plays next, and when (Unix ms). Null when cancelled or there's nothing next. */
  upNext: Episode | null;
  upNextAt: number | null;
}

export const usePlayback = create<PlaybackState>()(() => ({
  audio: null,
  source: null,
  playing: false,
  buffering: false,
  holding: false,
  currentTime: 0,
  duration: 0,
  error: null,
  reloadToken: 0,
  ended: false,
  episodeSkips: { count: 0, seconds: 0 },
  upNext: null,
  upNextAt: null,
}));

// --- Persisted player state ------------------------------------------------------

interface SavedPosition {
  time: number;
  duration: number;
  updatedAt: number;
}

interface PlayerState {
  episode: Episode | null;
  /** Whether <Player> should start playing when it loads `episode`. */
  autoplay: boolean;

  volume: number;
  muted: boolean;
  rate: number;
  autoSkip: boolean;
  panelOpen: boolean;
  /** Unix ms at which the sleep timer pauses playback. */
  sleepAt: number | null;

  positions: Record<string, SavedPosition>;
  recent: Episode[];
  stats: { adsSkipped: number; secondsSaved: number };
  /** Whether the next episode starts by itself when one ends. */
  autoNext: boolean;
  /**
   * For recently played episodes: the neighbouring episodes of the same show,
   * from the list they were played from, so the next one can start without
   * fetching the feed again.
   */
  following: Record<string, Neighbours>;
  /** The full-window Now Playing view. Not saved: a reload starts on the page. */
  stageOpen: boolean;

  /** Plays `episode`; `list` is the show's episode list it was chosen from, if any. */
  play: (episode: Episode, list?: Episode[]) => void;
  toggle: () => void;
  seek: (time: number) => void;
  skipBy: (seconds: number) => void;
  stop: () => void;
  setVolume: (volume: number) => void;
  toggleMute: () => void;
  setRate: (rate: number) => void;
  setAutoSkip: (on: boolean) => void;
  setPanelOpen: (open: boolean) => void;
  setSleep: (minutes: number | null) => void;
  /** Adds to the lifetime stats; `newAd` is false when extending a skip already counted. */
  recordSkip: (seconds: number, newAd: boolean) => void;
  savePosition: () => void;
  resumePoint: (episode: Episode) => number;
  setAutoNext: (on: boolean) => void;
  setStageOpen: (open: boolean) => void;
  /** The episode to play after `episode` ends, or null. */
  nextAfter: (episode: Episode) => Episode | null;
}

interface Neighbours {
  /** Up to a few newer episodes, nearest first. */
  newer: Episode[];
  /** Up to a few older episodes, nearest first. */
  older: Episode[];
}

const noStorage = { getItem: () => null, setItem: () => {}, removeItem: () => {} };

const RECENT_LIMIT = 12;
/** Neighbours kept on each side: enough to step past a few already-played episodes. */
const NEIGHBOUR_LIMIT = 4;
const POSITION_LIMIT = 300;
/** Past this many seconds from the end, an episode counts as finished. */
const FINISHED_MARGIN = 30;

export function positionKey(episode: Pick<Episode, "id">) {
  return String(episode.id);
}

export const usePlayer = create<PlayerState>()(
  persist(
    (set, get) => ({
      episode: null,
      autoplay: false,

      volume: 1,
      muted: false,
      rate: 1,
      autoSkip: true,
      panelOpen: false,
      sleepAt: null,

      positions: {},
      recent: [],
      stats: { adsSkipped: 0, secondsSaved: 0 },
      autoNext: true,
      following: {},
      stageOpen: false,

      play: (episode, list) => {
        const { audio } = usePlayback.getState();
        if (get().episode?.id === episode.id) {
          if (audio?.paused) void audio.play().catch(() => {});
          return;
        }
        get().savePosition();
        set((s) => {
          const recent = [episode, ...s.recent.filter((e) => e.id !== episode.id)].slice(0, RECENT_LIMIT);
          const keep = new Set(recent.map(positionKey));
          const following = Object.fromEntries(Object.entries(s.following).filter(([id]) => keep.has(id)));
          if (list) following[positionKey(episode)] = neighbours(episode, list);
          return { episode, autoplay: true, recent, following };
        });
        // <Player> reacts to the episode change: loads, resumes and plays.
      },

      toggle: () => {
        const { audio } = usePlayback.getState();
        if (!audio || !get().episode) return;
        if (audio.paused) void audio.play().catch(() => {});
        else audio.pause();
      },

      seek: (time) => {
        const { audio, duration } = usePlayback.getState();
        if (!audio) return;
        const end = duration || audio.duration;
        const clamped = Math.max(0, Number.isFinite(end) && end > 0 ? Math.min(time, end - 0.5) : time);
        audio.currentTime = clamped;
        usePlayback.setState({ currentTime: clamped });
      },

      skipBy: (seconds) => get().seek(usePlayback.getState().currentTime + seconds),

      stop: () => {
        get().savePosition();
        usePlayback.getState().audio?.pause();
        usePlayback.setState({ source: null, playing: false, currentTime: 0, duration: 0, error: null });
        set({ episode: null, panelOpen: false, sleepAt: null, stageOpen: false });
      },

      setVolume: (volume) => set({ volume, muted: volume === 0 }),
      toggleMute: () => set((s) => ({ muted: !s.muted })),
      setRate: (rate) => set({ rate }),
      setAutoSkip: (autoSkip) => set({ autoSkip }),
      setPanelOpen: (panelOpen) => set({ panelOpen }),

      setSleep: (minutes) => set({ sleepAt: minutes === null ? null : Date.now() + minutes * 60_000 }),

      recordSkip: (seconds, newAd) =>
        set((s) => ({
          stats: {
            adsSkipped: s.stats.adsSkipped + (newAd ? 1 : 0),
            secondsSaved: s.stats.secondsSaved + seconds,
          },
        })),

      savePosition: () => {
        const { episode } = get();
        const { currentTime, duration } = usePlayback.getState();
        if (!episode || currentTime < 1) return;
        set((s) => ({
          positions: prune({
            ...s.positions,
            [positionKey(episode)]: { time: currentTime, duration, updatedAt: Date.now() },
          }),
        }));
      },

      setAutoNext: (autoNext) => set({ autoNext }),
      setStageOpen: (stageOpen) => set({ stageOpen }),

      nextAfter: (episode) => {
        const { following, recent, positions } = get();
        const around = following[positionKey(episode)];
        if (!around) return null;
        // Keep going the way you've been listening: if the show's previous episode you played is
        // older than this one, you're catching up in order, so go newer; otherwise go older.
        const previous = recent.find((e) => e.id !== episode.id && e.podcastId === episode.podcastId);
        const candidates = previous && previous.publishedAt < episode.publishedAt ? around.newer : around.older;
        const finished = (e: Episode) => {
          const saved = positions[positionKey(e)];
          const duration = saved?.duration || e.duration;
          return Boolean(saved && duration && saved.time > duration - FINISHED_MARGIN);
        };
        return candidates.find((e) => !finished(e)) ?? null;
      },

      resumePoint: (episode) => {
        const saved = get().positions[positionKey(episode)];
        if (!saved || saved.time < 5) return 0;
        const duration = saved.duration || episode.duration;
        return duration && saved.time > duration - FINISHED_MARGIN ? 0 : saved.time;
      },
    }),
    {
      name: "podblock-player",
      version: 1,
      // `window.localStorage`, not the global: Node 25+ has an experimental
      // global localStorage that warns when touched during server rendering.
      storage: createJSONStorage(() => (typeof window === "undefined" ? noStorage : window.localStorage)),
      // Rehydrated by <Player> after mount, so the first client render matches
      // the server's (which has no localStorage).
      skipHydration: true,
      partialize: (s) => ({
        episode: s.episode,
        volume: s.volume,
        muted: s.muted,
        rate: s.rate,
        autoSkip: s.autoSkip,
        positions: s.positions,
        recent: s.recent,
        stats: s.stats,
        autoNext: s.autoNext,
        following: s.following,
      }),
    },
  ),
);

/** The episodes either side of `episode` in its show's list, nearest first, without their long descriptions. */
function neighbours(episode: Episode, list: Episode[]): Neighbours {
  const slim = (e: Episode): Episode => ({ ...e, description: "" });
  const others = list.filter((e) => e.id !== episode.id && e.podcastId === episode.podcastId);
  return {
    newer: others
      .filter((e) => e.publishedAt > episode.publishedAt)
      .sort((a, b) => a.publishedAt - b.publishedAt)
      .slice(0, NEIGHBOUR_LIMIT)
      .map(slim),
    older: others
      .filter((e) => e.publishedAt < episode.publishedAt)
      .sort((a, b) => b.publishedAt - a.publishedAt)
      .slice(0, NEIGHBOUR_LIMIT)
      .map(slim),
  };
}

function prune(positions: Record<string, SavedPosition>) {
  const entries = Object.entries(positions);
  if (entries.length <= POSITION_LIMIT) return positions;
  return Object.fromEntries(
    entries.sort(([, a], [, b]) => b.updatedAt - a.updatedAt).slice(0, POSITION_LIMIT),
  );
}

/** Progress (0–1) for an episode, from live playback or its saved position. */
export function useEpisodeProgress(episode: Episode): number {
  const isCurrent = usePlayer((s) => s.episode?.id === episode.id);
  const live = usePlayback((s) => (isCurrent && s.duration ? s.currentTime / s.duration : null));
  const saved = usePlayer((s) => s.positions[positionKey(episode)]);
  if (live !== null) return live;
  const duration = saved?.duration || episode.duration;
  return saved && duration ? Math.min(1, saved.time / duration) : 0;
}
