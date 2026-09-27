"use client";

import { LoaderCircle, X } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { Artwork } from "@/components/Artwork";
import { NowPlayingPanel } from "@/components/player/NowPlayingPanel";
import { BAR_FADE_MS, BAR_REVEAL_MS, barShouldMaterialize } from "@/components/player/PlayBurst";
import { SkipToast, type SkipNotice } from "@/components/player/SkipToast";
import { Waveform } from "@/components/player/Waveform";
import { Stage } from "@/components/stage/Stage";
import { IconButton } from "@/components/ui/IconButton";
import { useAdScanner } from "@/hooks/useAdScanner";
import { WINDOW_SECONDS, windowStartFor } from "@/lib/analysis";
import { formatClock, formatDuration } from "@/lib/text";
import type { AdRange } from "@/lib/types";
import { adAt, useAnalysis } from "@/store/analysis";
import { BACK_SECONDS, FORWARD_SECONDS, PLAYBACK_RATES, usePlayback, usePlayer } from "@/store/player";

/** Don't bother skipping the last sliver of an ad. */
const MIN_REMAINING = 1.5;
/** Longest we'll wait at the end of an ad break to learn whether it continues. */
const MAX_HOLD_MS = 15_000;
/** How long "Up next" counts down before the next episode starts. */
export const UP_NEXT_DELAY_MS = 5_000;

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
  const stageOpen = usePlayer((s) => s.stageOpen);
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
  const reloadToken = usePlayback((s) => s.reloadToken);

  // --- Load a new episode ---------------------------------------------------------
  useEffect(() => {
    const audio = audioRef.current;
    if (!audio) return;
    ignored.current = [];
    skipped.current = [];
    repinned.current = false;
    releaseHold(false);
    setNotice(null);
    usePlayback.setState({ ended: false, upNext: null, upNextAt: null, episodeSkips: { count: 0, seconds: 0 } });
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
    // reloadToken: Retry after an error loads the same episode again.
  }, [episode, reloadToken, releaseHold]);

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
    usePlayback.setState(({ episodeSkips }) => ({
      episodeSkips: { count: episodeSkips.count + (firstHop ? 1 : 0), seconds: episodeSkips.seconds + (ad.end - t) },
    }));
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

  // --- Up next ---------------------------------------------------------------------------
  const upNextAt = usePlayback((s) => s.upNextAt);
  useEffect(() => {
    if (upNextAt === null) return;
    const timer = setTimeout(playUpNext, Math.max(0, upNextAt - Date.now()));
    return () => clearTimeout(timer);
  }, [upNextAt]);

  useMediaSession();
  useKeyboardShortcuts();
  const dock = usePlayerSpace(Boolean(episode) && !stageOpen);

  return (
    <>
      <audio
        ref={audioRef}
        preload="metadata"
        onTimeUpdate={onTimeUpdate}
        onSeeking={onSeeking}
        onPlay={() => {
          releaseHold(false);
          usePlayback.setState({ playing: true, error: null, ended: false, upNext: null, upNextAt: null });
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
          const player = usePlayer.getState();
          player.savePosition();
          const next = player.episode && player.autoNext ? player.nextAfter(player.episode) : null;
          usePlayback.setState({
            playing: false,
            ended: true,
            upNext: next,
            upNextAt: next ? Date.now() + UP_NEXT_DELAY_MS : null,
          });
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
      {episode && stageOpen && <Stage notice={notice} holding={holding} onUndo={undoSkip} onDismiss={dismissNotice} />}
      {episode && !stageOpen && (
        <div
          ref={dock}
          className="pointer-events-none fixed inset-x-0 bottom-0 z-50 px-[max(0.5rem,env(safe-area-inset-left))] pb-[max(0.5rem,env(safe-area-inset-bottom))] sm:px-4 sm:pb-[max(1rem,env(safe-area-inset-bottom))]"
        >
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

/** Starts the episode counted down to, carrying its neighbours over so the one after can follow. */
function playUpNext() {
  const { upNext } = usePlayback.getState();
  const player = usePlayer.getState();
  if (!upNext || !player.episode) return;
  const around = player.following[String(player.episode.id)];
  player.play(upNext, around ? [...around.newer, player.episode, ...around.older] : undefined);
}

// --- Bar --------------------------------------------------------------------------------

/** Word buttons, as on the Stage: uppercase, struck through on hover, an ink block when on. */
const word =
  "touch-target relative inline-flex h-7 items-center px-1.5 uppercase leading-none whitespace-nowrap hover:line-through focus-visible:line-through aria-pressed:bg-text aria-pressed:text-bg aria-pressed:no-underline";

/**
 * The player: a box floating over the page with the episode's waveform along
 * its top. Compact, it holds play, the title and the time; on hover (or MORE,
 * on phones) it widens and opens a row of controls as words.
 */
function PlayerBar() {
  const episode = usePlayer((s) => s.episode)!;
  const { playing, buffering, holding, currentTime, duration } = usePlayback();
  const { toggle, seek, stop, setStageOpen, panelOpen } = usePlayer();
  const ads = useAnalysis((s) => s.ads);
  const windows = useAnalysis((s) => s.windows);
  const segments = useAnalysis((s) => s.segments);
  const envelopes = useAnalysis((s) => s.envelopes);
  // Started from a play button's burst: stay hidden until the sticks land here.
  const [materialize] = useState(barShouldMaterialize);
  const [hovered, setHovered] = useState(false);
  const [pinned, setPinned] = useState(false);
  const leave = useRef<ReturnType<typeof setTimeout> | null>(null);
  const open = hovered || pinned || panelOpen;

  return (
    <div
      data-player-bar
      onPointerEnter={(e) => {
        if (e.pointerType !== "mouse") return;
        if (leave.current) clearTimeout(leave.current);
        setHovered(true);
      }}
      onPointerLeave={(e) => {
        if (e.pointerType !== "mouse") return;
        // A moment's grace, so brushing past the edge doesn't snap it shut.
        leave.current = setTimeout(() => setHovered(false), 350);
      }}
      style={materialize ? { animationDelay: `${BAR_REVEAL_MS - 50}ms`, animationDuration: `${BAR_FADE_MS}ms` } : undefined}
      className={`mx-auto w-full border border-text bg-bg font-grotesk shadow-float transition-[max-width] duration-300 ease-soft ${
        open ? "max-w-[60rem]" : "max-w-[36rem]"
      } ${materialize ? "animate-bar-materialize" : ""}`}
    >
      <div className="px-3 pt-2.5">
        <Waveform
          currentTime={currentTime}
          duration={duration}
          ads={ads}
          windows={windows}
          envelopes={envelopes}
          segments={segments}
          onSeek={seek}
        />
      </div>

      <div className="flex items-center gap-3 px-3 pb-2.5 pt-2">
        <button
          onClick={toggle}
          aria-label={playing ? "Pause" : "Play"}
          className="grid h-9 min-w-[4.75rem] shrink-0 place-items-center bg-text px-3 text-sm uppercase text-bg hover:line-through"
        >
          {/* Loading (buffering before the first play), buffering mid-play, or holding at an ad break. */}
          {buffering || holding ? <LoaderCircle className="size-4 animate-spin" aria-hidden="true" /> : playing ? "Pause" : "Play"}
        </button>
        <button onClick={() => setStageOpen(true)} className="shrink-0" aria-label="Open Now Playing">
          <Artwork src={episode.image} alt="" priority className="size-9" />
        </button>
        <div className="min-w-0 flex-1">
          <button
            onClick={() => setStageOpen(true)}
            className="block max-w-full truncate text-left text-sm font-medium leading-tight hover:line-through"
            title="Open Now Playing (F)"
          >
            {episode.title}
          </button>
          <StatusLine podcastTitle={episode.podcastTitle} />
        </div>
        <span className="shrink-0 font-mono text-micro tabular-nums text-muted max-sm:hidden">
          {formatClock(currentTime)} / {duration > 0 ? formatClock(duration) : "--:--"}
        </span>
        <button className={`${word} shrink-0 text-xs`} aria-expanded={open} onClick={() => setPinned(!pinned)}>
          {open ? "Less" : "More"}
        </button>
        <IconButton label="Close player" onClick={stop} size="sm" className="rounded-none">
          <X className="size-4" />
        </IconButton>
      </div>

      {/* The rest of the controls, as words. Grows open on hover or MORE. */}
      <div className={`grid transition-[grid-template-rows] duration-300 ease-soft ${open ? "grid-rows-[1fr]" : "grid-rows-[0fr]"}`}>
        <div className="min-h-0 overflow-hidden" inert={!open}>
          <div className="flex flex-wrap items-center gap-x-2 gap-y-1 border-t border-text/15 px-2 py-2 text-xs">
            <Controls />
          </div>
        </div>
      </div>
    </div>
  );
}

/**
 * The line under the title: the show's name, or what the player is doing
 * when that matters more (loading, waiting on an ad break, an error, the
 * end of the episode).
 */
function StatusLine({ podcastTitle }: { podcastTitle: string }) {
  const source = usePlayback((s) => s.source);
  const playing = usePlayback((s) => s.playing);
  const buffering = usePlayback((s) => s.buffering);
  const holding = usePlayback((s) => s.holding);
  const error = usePlayback((s) => s.error);
  const ended = usePlayback((s) => s.ended);
  const upNext = usePlayback((s) => s.upNext);
  const upNextAt = usePlayback((s) => s.upNextAt);
  const skips = usePlayback((s) => s.episodeSkips);

  const action = "shrink-0 font-medium text-text underline underline-offset-2 hover:text-muted";
  let content: React.ReactNode;
  if (error) {
    content = (
      <>
        <span className="truncate text-danger">Couldn&apos;t load this episode&apos;s audio.</span>
        <button
          className={action}
          onClick={() => {
            usePlayer.setState({ autoplay: true });
            usePlayback.setState((s) => ({ error: null, reloadToken: s.reloadToken + 1 }));
          }}
        >
          Retry
        </button>
      </>
    );
  } else if (ended && upNext && upNextAt) {
    content = (
      <>
        <span className="truncate">
          Up next in <Countdown until={upNextAt} />: {upNext.title}
        </span>
        <button className={action} onClick={playUpNext}>
          Play now
        </button>
        <button className={action} onClick={() => usePlayback.setState({ upNext: null, upNextAt: null })}>
          Cancel
        </button>
      </>
    );
  } else if (ended) {
    content = (
      <>
        <span className="truncate">
          Finished
          {skips.count > 0 &&
            ` · skipped ${skips.count} ${skips.count === 1 ? "ad" : "ads"}, ${formatDuration(skips.seconds)}`}
        </span>
        <button
          className={action}
          onClick={() => {
            usePlayer.getState().seek(0);
            void usePlayback.getState().audio?.play().catch(() => {});
          }}
        >
          Replay
        </button>
      </>
    );
  } else if (holding || !source || buffering) {
    content = (
      <>
        <LoaderCircle className="size-3 shrink-0 animate-spin" aria-hidden="true" />
        <span className="truncate">
          {holding ? "Waiting for the rest of this ad break…" : playing ? "Buffering…" : "Loading…"}
        </span>
      </>
    );
  } else {
    content = <span className="truncate">{podcastTitle}</span>;
  }

  return (
    <p role="status" aria-live="polite" className="flex min-w-0 items-center gap-2 text-meta text-muted">
      {content}
    </p>
  );
}

/** Whole seconds left until `until`, ticking. */
function Countdown({ until }: { until: number }) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 250);
    return () => clearInterval(t);
  }, []);
  return <span className="font-mono tabular-nums">{Math.max(0, Math.ceil((until - now) / 1000))}</span>;
}

/** The expanded row: skipping, ads, speed, sleep, transcript, Now Playing and volume. */
function Controls() {
  const { skipBy, autoSkip, setAutoSkip, rate, setRate, sleepAt, setSleep, panelOpen, setPanelOpen, setStageOpen } = usePlayer();
  const adCount = useAnalysis((s) => s.ads.length);
  const nextRate = PLAYBACK_RATES[(PLAYBACK_RATES.indexOf(rate as (typeof PLAYBACK_RATES)[number]) + 1) % PLAYBACK_RATES.length];
  const sleepSteps = [15, 30, 60];

  return (
    <>
      <button className={word} onClick={() => skipBy(-BACK_SECONDS)} aria-label={`Back ${BACK_SECONDS} seconds`}>
        −{BACK_SECONDS}
      </button>
      <button className={word} onClick={() => skipBy(FORWARD_SECONDS)} aria-label={`Forward ${FORWARD_SECONDS} seconds`}>
        +{FORWARD_SECONDS}
      </button>
      <span aria-hidden="true" className="text-faint">
        |
      </span>
      <button
        className={word}
        onClick={() => setAutoSkip(!autoSkip)}
        aria-pressed={autoSkip}
        title={autoSkip ? "Skipping ads (S)" : "Ad skipping is off (S)"}
      >
        {autoSkip ? "Skipping ads" : "Ads on"}
        {adCount > 0 && <span className="ml-1.5 font-mono opacity-70">{adCount}</span>}
      </button>
      <button className={word} onClick={() => setRate(nextRate)} aria-label={`Speed ${rate}×, change to ${nextRate}×`}>
        <span className="font-mono normal-case">{rate}×</span>
      </button>
      <button
        className={word}
        aria-pressed={sleepAt !== null}
        onClick={() => {
          // Off → 15 → 30 → 60 minutes → off.
          const left = sleepAt ? Math.round((sleepAt - Date.now()) / 60_000) : 0;
          const next = sleepSteps.find((m) => m > left);
          setSleep(sleepAt && !next ? null : (next ?? sleepSteps[0]));
        }}
        title="Sleep timer: 15, 30 or 60 minutes"
      >
        Sleep{sleepAt && <SleepCountdown until={sleepAt} />}
      </button>
      <span aria-hidden="true" className="text-faint">
        |
      </span>
      <button className={word} onClick={() => setPanelOpen(!panelOpen)} aria-pressed={panelOpen} title="Transcript (T)">
        Transcript
      </button>
      <button className={word} onClick={() => setStageOpen(true)} title="Now Playing (F)">
        Now Playing
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
  return <span className="ml-1.5 font-mono normal-case">{formatClock((until - now) / 1000)}</span>;
}

/** The word VOLUME, filled with ink to the level. Click or drag to set; double-click mutes. */
function VolumeControl() {
  const { volume, muted, setVolume, toggleMute } = usePlayer();
  const level = muted ? 0 : volume;
  const set = (el: HTMLElement, clientX: number) => {
    const rect = el.getBoundingClientRect();
    setVolume(Math.round(Math.min(1, Math.max(0, (clientX - rect.left) / rect.width)) * 20) / 20);
  };
  return (
    <button
      className="relative ml-auto hidden h-7 touch-none px-1.5 uppercase leading-none lg:block"
      aria-label={`Volume ${Math.round(level * 100)}%`}
      onPointerDown={(e) => {
        e.currentTarget.setPointerCapture(e.pointerId);
        set(e.currentTarget, e.clientX);
      }}
      onPointerMove={(e) => e.buttons === 1 && set(e.currentTarget, e.clientX)}
      onDoubleClick={toggleMute}
      onKeyDown={(e) => {
        const step = e.key === "ArrowRight" || e.key === "ArrowUp" ? 0.1 : e.key === "ArrowLeft" || e.key === "ArrowDown" ? -0.1 : 0;
        if (!step) return;
        e.preventDefault();
        e.stopPropagation();
        setVolume(Math.min(1, Math.max(0, Math.round((level + step) * 10) / 10)));
      }}
    >
      <span className="block">Volume</span>
      <span aria-hidden="true" className="absolute inset-0 grid place-items-center bg-text px-1.5 text-bg" style={{ clipPath: `inset(0 ${(1 - level) * 100}% 0 0)` }}>
        Volume
      </span>
    </button>
  );
}

// --- System integration ---------------------------------------------------------------

/**
 * Publishes the docked player's height as --player-space, so the page can
 * leave exactly enough room under its content.
 */
function usePlayerSpace(visible: boolean) {
  const dock = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const root = document.documentElement.style;
    const el = dock.current;
    if (!visible || !el) {
      root.removeProperty("--player-space");
      return;
    }
    const observer = new ResizeObserver(() => root.setProperty("--player-space", `${Math.ceil(el.offsetHeight)}px`));
    observer.observe(el);
    return () => {
      observer.disconnect();
      root.removeProperty("--player-space");
    };
  }, [visible]);
  return dock;
}

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

/** Space/K play-pause, J/← back, L/→ forward, M mute, T transcript, S ad skipping, F Now Playing. */
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
        case "f":
          player.setStageOpen(!player.stageOpen);
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
