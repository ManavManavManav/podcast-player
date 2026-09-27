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

  play: (episode: Episode) => void;
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
}

const noStorage = { getItem: () => null, setItem: () => {}, removeItem: () => {} };

const RECENT_LIMIT = 12;
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

      play: (episode) => {
        const { audio } = usePlayback.getState();
        if (get().episode?.id === episode.id) {
          if (audio?.paused) void audio.play().catch(() => {});
          return;
        }
        get().savePosition();
        set((s) => ({
          episode,
          autoplay: true,
          recent: [episode, ...s.recent.filter((e) => e.id !== episode.id)].slice(0, RECENT_LIMIT),
        }));
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
        set({ episode: null, panelOpen: false, sleepAt: null });
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
      }),
    },
  ),
);

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
