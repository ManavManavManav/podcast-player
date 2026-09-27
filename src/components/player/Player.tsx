"use client";

import {
  LoaderCircle,
  Moon,
  Pause,
  Play,
  RotateCcw,
  RotateCw,
  ScrollText,
  ShieldCheck,
  ShieldOff,
  Volume1,
  Volume2,
  VolumeX,
  X,
} from "lucide-react";
import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import { Artwork } from "@/components/Artwork";
import { MenuItem, Popover } from "@/components/player/Popover";
import { NowPlayingPanel } from "@/components/player/NowPlayingPanel";
import { BAR_FADE_MS, BAR_REVEAL_MS, burstInProgress } from "@/components/player/PlayBurst";
import { SkipToast, type SkipNotice } from "@/components/player/SkipToast";
import { Timeline } from "@/components/player/Timeline";
import { IconButton } from "@/components/ui/IconButton";
import { useAdScanner } from "@/hooks/useAdScanner";
import { WINDOW_SECONDS, windowStartFor } from "@/lib/analysis";
import { formatClock } from "@/lib/text";
import type { AdRange } from "@/lib/types";
import { adAt, useAnalysis } from "@/store/analysis";
import { PLAYBACK_RATES, usePlayback, usePlayer } from "@/store/player";

const BACK_SECONDS = 15;
const FORWARD_SECONDS = 30;
const SLEEP_OPTIONS = [5, 15, 30, 45, 60];
/** Don't bother skipping the last sliver of an ad. */
const MIN_REMAINING = 1.5;
/** Longest we'll wait at the end of an ad break to learn whether it continues. */
const MAX_HOLD_MS = 15_000;

/**
 * Ad ranges get recomputed (and can grow) as more of the episode is
 * transcribed, so ads the listener chose to hear, or already skipped, are
 * remembered as intervals and matched by overlap.
 */
const overlaps = (a: AdRange, list: AdRange[]) => list.some((b) => a.start < b.end && b.start < a.end);

/** End of the run of analyzed windows that contains `time`. */
function analyzedUntil(time: number): number {
  const { windows } = useAnalysis.getState();
  let w = windowStartFor(time);
  while (windows[w] === "done") w += WINDOW_SECONDS;
  return w;
}

export function Player({ userId }: { userId: string }) {
  const audioRef = useRef<HTMLAudioElement>(null);
  const episode = usePlayer((s) => s.episode);
  const panelOpen = usePlayer((s) => s.panelOpen);
  const [notice, setNotice] = useState<SkipNotice | null>(null);
  const dismissNotice = useCallback(() => setNotice(null), []);

  // Auto-skip bookkeeping, kept in refs because it changes on every tick.
  const lastTime = useRef(0);
  const ignored = useRef<AdRange[]>([]);
  const skipped = useRef<AdRange[]>([]);
  const programmaticSeek = useRef(false);
  /** Whether this episode's audio link has already been re-pinned after a load error. */
  const repinned = useRef(false);
  const hold = useRef<{ frontier: number; timer: ReturnType<typeof setTimeout> } | null>(null);
  const holding = usePlayback((s) => s.holding);

  const releaseHold = useCallback((resume: boolean) => {
    const current = hold.current;
    if (!current) return;
    clearTimeout(current.timer);
    hold.current = null;
    usePlayback.setState({ holding: false });
    if (resume) void audioRef.current?.play().catch(() => {});
  }, []);

  // Restore this user's settings and last episode from localStorage after
  // mount. Storage is per user, so people sharing a browser don't see each
  // other's listening.
  useEffect(() => {
    const name = `podblock-player:${userId}`;
    try {
      // History saved before accounts existed goes to the first user who signs in here.
      const legacy = localStorage.getItem("podblock-player");
      if (legacy && !localStorage.getItem(name)) localStorage.setItem(name, legacy);
      localStorage.removeItem("podblock-player");
    } catch {
      // Storage unavailable (private mode); nothing to migrate.
    }
    usePlayer.persist.setOptions({ name });
    void usePlayer.persist.rehydrate();
  }, [userId]);

  useEffect(() => {
    usePlayback.setState({ audio: audioRef.current });
    return () => usePlayback.setState({ audio: null });
  }, []);

  useAdScanner(Boolean(episode));

  // --- Load a new episode ---------------------------------------------------------
  useEffect(() => {
    const audio = audioRef.current;
    if (!audio) return;
    ignored.current = [];
    skipped.current = [];
    repinned.current = false;
    releaseHold(false);
    setNotice(null);
    // Stop the previous episode now; resolving the new one can take a moment,
    // and its time updates would otherwise be saved as the new one's position.
    audio.pause();
    audio.removeAttribute("src");
    audio.load();
    if (!episode) {
      usePlayback.setState({ source: null });
      return;
    }

    const player = usePlayer.getState();
    const resumeAt = player.resumePoint(episode);
    usePlayback.setState({
      source: null,
      currentTime: resumeAt,
      duration: episode.duration,
      playing: false,
      buffering: player.autoplay,
      error: null,
    });
    lastTime.current = resumeAt;

    let cancelled = false;
    const onReady = () => {
      if (resumeAt) {
        programmaticSeek.current = true;
        audio.currentTime = resumeAt;
      }
      if (usePlayer.getState().autoplay) {
        void audio.play().catch(() => usePlayback.setState({ buffering: false }));
        usePlayer.setState({ autoplay: false });
      }
    };

    // Pin the ad-stitched variant first so playback and analysis agree.
    void fetch("/api/resolve", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ url: episode.audioUrl }),
    })
      .then((res) => (res.ok ? res.json() : { url: episode.audioUrl }))
      .catch(() => ({ url: episode.audioUrl }))
      .then(({ url }: { url: string }) => {
        if (cancelled) return;
        usePlayback.setState({ source: url });
        audio.addEventListener("loadedmetadata", onReady, { once: true });
        audio.src = url;
        audio.playbackRate = usePlayer.getState().rate;
      });

    return () => {
      cancelled = true;
      audio.removeEventListener("loadedmetadata", onReady);
    };
  }, [episode, releaseHold]);

  // --- Settings → element -------------------------------------------------------------
  const volume = usePlayer((s) => s.volume);
  const muted = usePlayer((s) => s.muted);
  const rate = usePlayer((s) => s.rate);
  useEffect(() => {
    const audio = audioRef.current;
    if (!audio) return;
    audio.volume = volume;
    audio.muted = muted;
    audio.playbackRate = rate;
  }, [volume, muted, rate]);

  // --- Auto-skip ------------------------------------------------------------------------
  const onTimeUpdate = () => {
    const audio = audioRef.current!;
    const t = audio.currentTime;
    usePlayback.setState({ currentTime: t });

    const natural = Math.abs(t - lastTime.current) < 3;
    lastTime.current = t;
    if (!natural || audio.paused || !usePlayer.getState().autoSkip) return;

    const ad = adAt(useAnalysis.getState().ads, t);
    if (!ad || overlaps(ad, ignored.current) || ad.end - t < MIN_REMAINING) return;

    // A long ad break grows as more of it is transcribed, so it can take a few
    // hops; they count as one skip.
    const firstHop = !overlaps(ad, skipped.current);
    skipped.current.push(ad);
    programmaticSeek.current = true;
    audio.currentTime = ad.end;
    lastTime.current = ad.end;
    usePlayback.setState({ currentTime: ad.end });
    usePlayer.getState().recordSkip(ad.end - t, firstHop);
    setNotice((previous) => ({
      ad,
      seconds: (firstHop || !previous ? 0 : previous.seconds) + (ad.end - t),
      at: Date.now(),
    }));

    // If the ad runs right up to the end of what's been transcribed, it may
    // well continue. Wait for the next minute rather than play a fragment.
    const frontier = analyzedUntil(ad.start);
    const { duration } = usePlayback.getState();
    if (ad.end >= frontier - 1.5 && (!duration || frontier < duration)) {
      releaseHold(false);
      hold.current = { frontier, timer: setTimeout(() => releaseHold(true), MAX_HOLD_MS) };
      usePlayback.setState({ holding: true });
      audio.pause();
    }
  };

  // Resume from a hold once the next window is in (or failed).
  const windows = useAnalysis((s) => s.windows);
  useEffect(() => {
    const current = hold.current;
    if (!current) return;
    const status = windows[current.frontier];
    if (status === "done" || status === "error") releaseHold(true);
  }, [windows, releaseHold]);

  const onSeeking = () => {
    const audio = audioRef.current!;
    if (programmaticSeek.current) {
      programmaticSeek.current = false;
      return;
    }
    // The listener took over; stop waiting on the ad break.
    releaseHold(true);
    // The listener deliberately jumped into an ad (e.g. clicked it in the list):
    // let it play. Seeking within an ad they're already in keeps skipping on.
    const ads = useAnalysis.getState().ads;
    const target = adAt(ads, audio.currentTime);
    if (target && adAt(ads, lastTime.current) !== target) ignored.current.push(target);
    lastTime.current = audio.currentTime;
    usePlayback.setState({ currentTime: audio.currentTime });
  };

  const undoSkip = () => {
    if (!notice) return;
    releaseHold(false);
    ignored.current.push(notice.ad);
    programmaticSeek.current = true;
    usePlayer.getState().seek(notice.ad.start);
    lastTime.current = notice.ad.start;
    setNotice(null);
  };

  // --- Save progress --------------------------------------------------------------------
  useEffect(() => {
    const save = () => usePlayer.getState().savePosition();
    const interval = setInterval(() => {
      if (usePlayback.getState().playing) save();
    }, 5000);
    window.addEventListener("pagehide", save);
    return () => {
      clearInterval(interval);
      window.removeEventListener("pagehide", save);
    };
  }, []);

  // --- Sleep timer ------------------------------------------------------------------------
  const sleepAt = usePlayer((s) => s.sleepAt);
  useEffect(() => {
    if (sleepAt === null) return;
    const timer = setTimeout(() => {
      audioRef.current?.pause();
      usePlayer.getState().setSleep(null);
    }, Math.max(0, sleepAt - Date.now()));
    return () => clearTimeout(timer);
  }, [sleepAt]);

  useMediaSession();
  useKeyboardShortcuts();

  return (
    <>
      <audio
        ref={audioRef}
        preload="metadata"
        onTimeUpdate={onTimeUpdate}
        onSeeking={onSeeking}
        onPlay={() => {
          releaseHold(false);
          usePlayback.setState({ playing: true, error: null });
        }}
        onPause={() => {
          usePlayback.setState({ playing: false });
          usePlayer.getState().savePosition();
        }}
        onWaiting={() => usePlayback.setState({ buffering: true })}
        onPlaying={() => usePlayback.setState({ buffering: false })}
        onCanPlay={() => usePlayback.setState({ buffering: false })}
        onDurationChange={(e) => {
          const d = e.currentTarget.duration;
          if (Number.isFinite(d) && d > 0) usePlayback.setState({ duration: d });
        }}
        onEnded={() => {
          usePlayback.setState({ playing: false });
          usePlayer.getState().savePosition();
        }}
        onError={() => {
          const audio = audioRef.current;
          const current = usePlayer.getState().episode;
          if (!audio?.getAttribute("src") || !current) return;
          if (!repinned.current) {
            // Pinned links can expire (signed CDN URLs): pin a fresh one once and carry on.
            repinned.current = true;
            const resumeAt = lastTime.current;
            const wasPlaying = usePlayback.getState().playing;
            void fetch("/api/resolve", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ url: current.audioUrl, fresh: true }),
            })
              .then((res) => (res.ok ? res.json() : { url: current.audioUrl }))
              .catch(() => ({ url: current.audioUrl }))
              .then(({ url }: { url: string }) => {
                if (usePlayer.getState().episode?.id !== current.id) return;
                audio.addEventListener(
                  "loadedmetadata",
                  () => {
                    programmaticSeek.current = true;
                    audio.currentTime = resumeAt;
                    if (wasPlaying) void audio.play().catch(() => {});
                  },
                  { once: true },
                );
                usePlayback.setState({ source: url });
                audio.src = url;
              });
            return;
          }
          usePlayback.setState({
            playing: false,
            buffering: false,
            error: "This episode's audio couldn't be loaded.",
          });
        }}
      />
      {episode && (
        <div className="pointer-events-none fixed inset-x-0 bottom-0 z-50 px-2 pb-2 sm:px-4 sm:pb-4">
          <div className="pointer-events-auto">
            {notice && <SkipToast notice={notice} holding={holding} onUndo={undoSkip} onDismiss={dismissNotice} />}
            {panelOpen && <NowPlayingPanel />}
            <PlayerBar key={episode.id} />
          </div>
        </div>
      )}
    </>
  );
}

// --- Bar --------------------------------------------------------------------------------

function PlayerBar() {
  const episode = usePlayer((s) => s.episode)!;
  const { playing, buffering, holding, currentTime, duration, error } = usePlayback();
  const { toggle, skipBy, seek, stop } = usePlayer();
  const ads = useAnalysis((s) => s.ads);
  const windows = useAnalysis((s) => s.windows);
  // Started from a play button's burst: stay hidden until the sticks land here.
  const [materialize] = useState(burstInProgress);

  return (
    <div
      data-player-bar
      style={materialize ? { animationDelay: `${BAR_REVEAL_MS - 50}ms`, animationDuration: `${BAR_FADE_MS}ms` } : undefined}
      className={`mx-auto w-full max-w-[69rem] rounded-3xl bg-surface/80 px-3 pb-2 pt-3 shadow-float backdrop-blur-2xl backdrop-saturate-150 sm:px-5 ${
        materialize ? "animate-bar-materialize" : ""
      }`}
    >
      <div className="flex items-center gap-3">
        <Link href={`/podcast/${episode.podcastId}`} className="shrink-0" aria-label={`Go to ${episode.podcastTitle}`}>
          <Artwork src={episode.image} alt="" priority className="size-12 rounded-xl" />
        </Link>
        <div className="min-w-0 flex-1">
          <p className="truncate font-serif text-lg leading-tight">{episode.title}</p>
          <p className="truncate text-meta text-muted">
            {error ? <span className="text-danger">{error}</span> : episode.podcastTitle}
          </p>
        </div>

        <div className="flex items-center gap-0.5 sm:gap-1.5">
          <IconButton label={`Back ${BACK_SECONDS} seconds`} onClick={() => skipBy(-BACK_SECONDS)} className="max-sm:hidden">
            <RotateCcw className="size-[18px]" />
            <span className="absolute text-[8px] font-bold">{BACK_SECONDS}</span>
          </IconButton>
          <button
            onClick={toggle}
            aria-label={playing ? "Pause" : "Play"}
            className="hover-breathe grid size-12 place-items-center rounded-full bg-accent text-accent-text [--hover-scale:1.08]"
          >
            {(buffering && playing) || holding ? (
              <LoaderCircle className="size-5 animate-spin" />
            ) : playing ? (
              <Pause className="size-5 fill-current" />
            ) : (
              <Play className="ml-0.5 size-5 fill-current" />
            )}
          </button>
          <IconButton label={`Forward ${FORWARD_SECONDS} seconds`} onClick={() => skipBy(FORWARD_SECONDS)} className="max-sm:hidden">
            <RotateCw className="size-[18px]" />
            <span className="absolute text-[8px] font-bold">{FORWARD_SECONDS}</span>
          </IconButton>
        </div>

        <div className="hidden flex-1 items-center justify-end gap-1 md:flex">
          <SecondaryControls />
        </div>
        <IconButton label="Close player" onClick={stop}>
          <X className="size-4" />
        </IconButton>
      </div>

      <div className="mt-1.5">
        <Timeline currentTime={currentTime} duration={duration} ads={ads} windows={windows} onSeek={seek} />
      </div>

      <div className="flex items-center justify-between md:hidden">
        <IconButton label={`Back ${BACK_SECONDS} seconds`} onClick={() => skipBy(-BACK_SECONDS)} className="sm:hidden">
          <RotateCcw className="size-[18px]" />
          <span className="absolute text-[8px] font-bold">{BACK_SECONDS}</span>
        </IconButton>
        <SecondaryControls />
        <IconButton label={`Forward ${FORWARD_SECONDS} seconds`} onClick={() => skipBy(FORWARD_SECONDS)} className="sm:hidden">
          <RotateCw className="size-[18px]" />
          <span className="absolute text-[8px] font-bold">{FORWARD_SECONDS}</span>
        </IconButton>
      </div>
    </div>
  );
}

function SecondaryControls() {
  const { autoSkip, setAutoSkip, rate, setRate, sleepAt, setSleep, panelOpen, setPanelOpen, stats } = usePlayer();
  const adCount = useAnalysis((s) => s.ads.length);

  return (
    <>
      <button
        onClick={() => setAutoSkip(!autoSkip)}
        aria-pressed={autoSkip}
        title={autoSkip ? `Skipping ads · ${stats.adsSkipped} skipped so far` : "Ad skipping is off"}
        className={`hover-breathe flex h-8 shrink-0 items-center gap-1.5 whitespace-nowrap rounded-full px-2.5 text-xs font-medium [--hover-scale:1.04] ${
          autoSkip ? "bg-surface-2 text-text" : "text-muted hover:bg-surface-2"
        }`}
      >
        {autoSkip ? <ShieldCheck className="size-4 text-ad" /> : <ShieldOff className="size-4" />}
        <span>{autoSkip ? "Skipping ads" : "Ads on"}</span>
        {adCount > 0 && <span className="font-mono text-micro text-muted">{adCount}</span>}
      </button>

      <Popover label="Playback speed" trigger={<span className="font-mono">{rate}×</span>}>
        {(close) =>
          PLAYBACK_RATES.map((r) => (
            <MenuItem
              key={r}
              selected={r === rate}
              onSelect={() => {
                setRate(r);
                close();
              }}
            >
              {r}×
            </MenuItem>
          ))
        }
      </Popover>

      <Popover
        label="Sleep timer"
        trigger={
          <>
            <Moon className={`size-4 ${sleepAt ? "fill-current text-accent" : ""}`} />
            {sleepAt && <SleepCountdown until={sleepAt} />}
          </>
        }
      >
        {(close) => (
          <>
            <p className="px-3 pb-1 pt-1.5 text-xs text-faint">Pause after</p>
            {SLEEP_OPTIONS.map((m) => (
              <MenuItem
                key={m}
                onSelect={() => {
                  setSleep(m);
                  close();
                }}
              >
                {m} minutes
              </MenuItem>
            ))}
            {sleepAt && (
              <MenuItem
                onSelect={() => {
                  setSleep(null);
                  close();
                }}
              >
                Turn off
              </MenuItem>
            )}
          </>
        )}
      </Popover>

      <button
        onClick={() => setPanelOpen(!panelOpen)}
        aria-pressed={panelOpen}
        aria-label="Transcript and ads"
        title="Transcript (T)"
        className={`hover-breathe grid size-8 place-items-center rounded-full hover:bg-surface-2 ${panelOpen ? "bg-surface-2 text-accent" : ""}`}
      >
        <ScrollText className="size-4" />
      </button>

      <VolumeControl />
    </>
  );
}

function SleepCountdown({ until }: { until: number }) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);
  return <span className="font-mono text-accent">{formatClock((until - now) / 1000)}</span>;
}

function VolumeControl() {
  const { volume, muted, setVolume, toggleMute } = usePlayer();
  const Icon = muted || volume === 0 ? VolumeX : volume < 0.5 ? Volume1 : Volume2;
  return (
    <div className="hidden items-center gap-1 lg:flex">
      <IconButton label={muted ? "Unmute" : "Mute"} onClick={toggleMute}>
        <Icon className="size-4" />
      </IconButton>
      <input
        type="range"
        min={0}
        max={1}
        step={0.05}
        value={muted ? 0 : volume}
        onChange={(e) => setVolume(Number(e.target.value))}
        aria-label="Volume"
        className="h-1 w-20 cursor-pointer accent-[var(--accent)]"
      />
    </div>
  );
}

// --- System integration ---------------------------------------------------------------

/** Lock-screen / headphone / media-key controls. */
function useMediaSession() {
  const episode = usePlayer((s) => s.episode);
  const playing = usePlayback((s) => s.playing);

  useEffect(() => {
    if (!("mediaSession" in navigator)) return;
    const session = navigator.mediaSession;
    if (!episode) {
      session.metadata = null;
      return;
    }
    session.metadata = new MediaMetadata({
      title: episode.title,
      artist: episode.podcastTitle,
      album: "Podblock",
      artwork: episode.image ? [{ src: episode.image, sizes: "512x512" }] : [],
    });
    const { skipBy, seek } = usePlayer.getState();
    // Explicit play and pause: a toggle would start playback on a "pause" from headphones.
    const audio = () => usePlayback.getState().audio;
    const handlers: [MediaSessionAction, MediaSessionActionHandler][] = [
      ["play", () => void audio()?.play().catch(() => {})],
      ["pause", () => audio()?.pause()],
      ["seekbackward", (d) => skipBy(-(d.seekOffset ?? BACK_SECONDS))],
      ["seekforward", (d) => skipBy(d.seekOffset ?? FORWARD_SECONDS)],
      ["seekto", (d) => d.seekTime !== undefined && seek(d.seekTime)],
    ];
    for (const [action, handler] of handlers) {
      try {
        session.setActionHandler(action, handler);
      } catch {
        // Unsupported action in this browser.
      }
    }
  }, [episode]);

  useEffect(() => {
    if ("mediaSession" in navigator) navigator.mediaSession.playbackState = playing ? "playing" : "paused";
  }, [playing]);
}

/** Space/K play-pause, J/← back, L/→ forward, M mute, T transcript, S ad skipping. */
function useKeyboardShortcuts() {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.metaKey || e.ctrlKey || e.altKey || e.defaultPrevented) return;
      const target = e.target instanceof Element ? e.target : document.body;
      if (target.closest("input, textarea, select, [contenteditable], [role=slider]")) return;
      const player = usePlayer.getState();
      if (!player.episode) return;

      switch (e.key) {
        case " ":
          if (target.closest("button, a")) return; // let Space activate the focused control
          player.toggle();
          break;
        case "k":
          player.toggle();
          break;
        case "j":
        case "ArrowLeft":
          player.skipBy(-BACK_SECONDS);
          break;
        case "l":
        case "ArrowRight":
          player.skipBy(FORWARD_SECONDS);
          break;
        case "m":
          player.toggleMute();
          break;
        case "t":
          player.setPanelOpen(!player.panelOpen);
          break;
        case "s":
          player.setAutoSkip(!player.autoSkip);
          break;
        default:
          return;
      }
      e.preventDefault();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);
}
