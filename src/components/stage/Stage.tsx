"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { NowPlayingPanel } from "@/components/player/NowPlayingPanel";
import { SkipToast, type SkipNotice } from "@/components/player/SkipToast";
import { Waveform } from "@/components/player/Waveform";
import { formatClock } from "@/lib/text";
import type { TranscriptSegment } from "@/lib/types";
import { useAnalysis } from "@/store/analysis";
import { BACK_SECONDS, FORWARD_SECONDS, PLAYBACK_RATES, usePlayback, usePlayer } from "@/store/player";

/**
 * The Stage: a full-window Now Playing, where the Field draws at full
 * strength. Type and layout after physicsofbeauty.art: the show's name up
 * the left edge, words for controls, the title in an ink bar that fills as
 * the episode plays, and the words being spoken, large, in the middle.
 *
 * The drawing sits on top of everything with a difference blend, so strokes
 * turn light where they cross the ink bars and text.
 */
export function Stage({
  notice,
  holding,
  onUndo,
  onDismiss,
}: {
  notice: SkipNotice | null;
  holding: boolean;
  onUndo: () => void;
  onDismiss: () => void;
}) {
  const episode = usePlayer((s) => s.episode)!;
  const setStageOpen = usePlayer((s) => s.setStageOpen);
  const panelOpen = usePlayer((s) => s.panelOpen);
  const close = () => setStageOpen(false);
  const closeButton = useRef<HTMLButtonElement>(null);
  const touchStart = useRef<{ x: number; y: number } | null>(null);

  // A dialog: focus moves in, Escape closes it, the page behind doesn't scroll,
  // and focus goes back where it was.
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    closeButton.current?.focus();
    const root = document.documentElement;
    const overflow = root.style.overflow;
    root.style.overflow = "hidden";
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !usePlayer.getState().panelOpen) usePlayer.getState().setStageOpen(false);
    };
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("keydown", onKey);
      root.style.overflow = overflow;
      previous?.focus?.();
    };
  }, []);

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={`Now playing: ${episode.title}`}
      className="animate-stage-in fixed inset-0 z-[55] overflow-hidden bg-bg font-grotesk text-text"
      // Swipe down to close, on phones.
      onTouchStart={(e) => (touchStart.current = { x: e.touches[0].clientX, y: e.touches[0].clientY })}
      onTouchEnd={(e) => {
        const start = touchStart.current;
        touchStart.current = null;
        if (!start) return;
        const dx = e.changedTouches[0].clientX - start.x;
        const dy = e.changedTouches[0].clientY - start.y;
        if (dy > 90 && Math.abs(dy) > Math.abs(dx) * 2) close();
      }}
    >
      {/* The show, up the left edge. */}
      <Link
        href={`/podcast/${episode.podcastId}`}
        onClick={close}
        className="absolute bottom-24 left-2 top-3 z-0 max-h-[calc(100%-7rem)] truncate text-lg uppercase leading-none [writing-mode:vertical-rl] rotate-180 hover:line-through sm:left-3 sm:text-2xl"
      >
        {episode.podcastTitle}
      </Link>

      <TopWords close={close} closeButton={closeButton} />
      <SpokenLines />
      <StageWaveform />

      <div className="absolute inset-x-0 bottom-0 z-0 flex flex-col gap-3 p-2 pl-9 sm:flex-row sm:items-end sm:justify-between sm:p-3 sm:pl-12">
        <TitleBar />
        <Controls />
      </div>


      <div className="pointer-events-none absolute inset-x-0 bottom-24 z-20 px-4 sm:bottom-20">
        <div className="pointer-events-auto">
          {notice && <SkipToast notice={notice} holding={holding} onUndo={onUndo} onDismiss={onDismiss} />}
        </div>
      </div>
      {panelOpen && (
        <div className="absolute inset-x-2 bottom-2 top-16 z-30 flex flex-col justify-end font-sans sm:inset-x-auto sm:right-3 sm:top-14 sm:w-[30rem]">
          <NowPlayingPanel />
        </div>
      )}
    </div>
  );
}

const word = "uppercase leading-none hover:line-through focus-visible:line-through";

/** Settings along the top: ad skipping, speed, sleep, the drawing, transcript, close. */
function TopWords({ close, closeButton }: { close: () => void; closeButton: React.RefObject<HTMLButtonElement | null> }) {
  const { autoSkip, setAutoSkip, rate, setRate, sleepAt, setSleep, panelOpen, setPanelOpen } = usePlayer();
  const nextRate = PLAYBACK_RATES[(PLAYBACK_RATES.indexOf(rate as (typeof PLAYBACK_RATES)[number]) + 1) % PLAYBACK_RATES.length];
  const sleepSteps = [15, 30, 60];
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!sleepAt) return;
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, [sleepAt]);

  return (
    <div className="absolute right-2 top-2 z-0 flex flex-wrap items-baseline justify-end gap-x-4 gap-y-2 pl-10 text-base sm:right-3 sm:top-3 sm:gap-x-6 sm:text-2xl">
      <button className={word} onClick={() => setAutoSkip(!autoSkip)} aria-pressed={autoSkip}>
        Ads: {autoSkip ? "skip" : "play"}
      </button>
      <button className={word} onClick={() => setRate(nextRate)} aria-label={`Speed ${rate}×, change to ${nextRate}×`}>
        {rate}×
      </button>
      <button
        className={word}
        onClick={() => {
          // Off → 15 → 30 → 60 minutes → off.
          const left = sleepAt ? Math.round((sleepAt - Date.now()) / 60_000) : 0;
          const next = sleepSteps.find((m) => m > left);
          setSleep(sleepAt && !next ? null : (next ?? sleepSteps[0]));
        }}
      >
        Sleep{sleepAt ? ` ${formatClock((sleepAt - now) / 1000)}` : ""}
      </button>
      <button className={word} onClick={() => setPanelOpen(!panelOpen)} aria-pressed={panelOpen}>
        Transcript
      </button>
      <button ref={closeButton} className={word} onClick={close}>
        Close
      </button>
    </div>
  );
}

/** The episode's waveform, large, across the lower part of the window: it's also the seek bar. */
function StageWaveform() {
  const seek = usePlayer((s) => s.seek);
  const currentTime = usePlayback((s) => s.currentTime);
  const duration = usePlayback((s) => s.duration);
  const ads = useAnalysis((s) => s.ads);
  const windows = useAnalysis((s) => s.windows);
  const envelopes = useAnalysis((s) => s.envelopes);
  const segments = useAnalysis((s) => s.segments);
  return (
    <div className="absolute inset-x-10 bottom-28 z-0 font-sans sm:inset-x-24 sm:bottom-24">
      <Waveform
        size="lg"
        currentTime={currentTime}
        duration={duration}
        ads={ads}
        windows={windows}
        envelopes={envelopes}
        segments={segments}
        onSeek={seek}
      />
    </div>
  );
}

/** Index of the last line starting at or before `time`, or -1. */
function lineAt(segments: TranscriptSegment[], time: number): number {
  let low = 0;
  let high = segments.length - 1;
  let found = -1;
  while (low <= high) {
    const mid = (low + high) >> 1;
    if (segments[mid].start <= time) {
      found = mid;
      low = mid + 1;
    } else high = mid - 1;
  }
  return found;
}

/** What's being said, large, with the line before it fading above. */
function SpokenLines() {
  const segments = useAnalysis((s) => s.segments);
  const index = usePlayback((s) => lineAt(segments, s.currentTime));
  const inAd = useAnalysis((s) => {
    const line = segments[index];
    return line ? s.ads.some((ad) => line.start < ad.end && ad.start < line.end) : false;
  });
  const current = segments[index];
  const previous = segments[index - 1];

  return (
    <div className="absolute inset-x-0 top-[40%] z-0 -translate-y-1/2 px-10 sm:px-24" aria-live="off">
      {current ? (
        <>
          {previous && (
            <p key={`p${previous.start}`} className="mb-4 line-clamp-2 max-w-5xl text-lg leading-tight text-muted sm:text-2xl">
              {previous.text}
            </p>
          )}
          <p key={current.start} className="max-w-5xl text-balance text-[clamp(28px,5vw,64px)] leading-[1.02] tracking-[-0.01em]">
            <span className="wipe text-balance [--wipe-ms:700ms]">{current.text}</span>
          </p>
          {inAd && <p className="mt-4 text-base uppercase text-ad sm:text-xl">Ad</p>}
        </>
      ) : (
        <p className="text-[clamp(22px,3vw,40px)] uppercase leading-none text-muted">Listening ahead…</p>
      )}
    </div>
  );
}

/** The title in an ink bar that fills as the episode plays; click or drag to seek. */
function TitleBar() {
  const episode = usePlayer((s) => s.episode)!;
  const seek = usePlayer((s) => s.seek);
  const currentTime = usePlayback((s) => s.currentTime);
  const duration = usePlayback((s) => s.duration);
  const ads = useAnalysis((s) => s.ads);
  const bar = useRef<HTMLDivElement>(null);
  const [drag, setDrag] = useState<number | null>(null);
  const shown = drag ?? currentTime;
  const fraction = duration > 0 ? Math.min(1, Math.max(0, shown / duration)) : 0;
  const timeAt = (clientX: number) => {
    const rect = bar.current!.getBoundingClientRect();
    return Math.min(1, Math.max(0, (clientX - rect.left) / rect.width)) * duration;
  };

  return (
    <div className="flex min-w-0 items-end gap-3">
      <div className="min-w-0 max-w-[min(62vw,44rem)] flex-1 sm:flex-none">
        <div
          ref={bar}
          role="slider"
          tabIndex={0}
          aria-label="Seek"
          aria-valuemin={0}
          aria-valuemax={Math.round(duration)}
          aria-valuenow={Math.round(shown)}
          aria-valuetext={`${formatClock(shown)} of ${formatClock(duration)}`}
          onKeyDown={(e) => {
            const step = e.key === "ArrowLeft" ? -BACK_SECONDS : e.key === "ArrowRight" ? FORWARD_SECONDS : 0;
            if (!step) return;
            e.preventDefault();
            e.stopPropagation();
            seek(currentTime + step);
          }}
          onPointerDown={(e) => {
            if (!duration) return;
            e.currentTarget.setPointerCapture(e.pointerId);
            setDrag(timeAt(e.clientX));
          }}
          onPointerMove={(e) => drag !== null && setDrag(timeAt(e.clientX))}
          onPointerUp={(e) => {
            if (drag === null) return;
            seek(timeAt(e.clientX));
            setDrag(null);
          }}
          onPointerCancel={() => setDrag(null)}
          className="relative cursor-pointer touch-none select-none text-[clamp(20px,2.6vw,34px)] uppercase leading-none"
        >
          {/* The unplayed part: ink text on the ground. */}
          <span key={episode.id} className="wipe block truncate px-2 pb-1 pt-1.5">
            {episode.title}
          </span>
          {/* The played part: the same text, reversed out of an ink fill. */}
          <span
            aria-hidden="true"
            className="absolute inset-0 block truncate bg-text px-2 pb-1 pt-1.5 text-bg"
            style={{ clipPath: `inset(0 ${(1 - fraction) * 100}% 0 0)` }}
          >
            {episode.title}
          </span>
        </div>
        {/* Ads as notches under the bar. */}
        <div className="relative mt-1 h-1.5" aria-hidden="true">
          {duration > 0 &&
            ads.map((ad) => (
              <span
                key={`${ad.start}-${ad.end}`}
                className={`absolute inset-y-0 bg-ad ${ad.end <= shown ? "opacity-40" : ""}`}
                style={{ left: `${(ad.start / duration) * 100}%`, width: `${((ad.end - ad.start) / duration) * 100}%`, minWidth: 3 }}
              />
            ))}
        </div>
      </div>
      <span className="shrink-0 pb-3 font-mono text-sm tabular-nums sm:text-base">
        {duration > 0 ? `-${formatClock(Math.max(0, duration - shown))}` : "--:--"}
      </span>
    </div>
  );
}

/** Back, play/pause, forward and volume, as words. */
function Controls() {
  const { toggle, skipBy, volume, muted, setVolume, toggleMute } = usePlayer();
  const playing = usePlayback((s) => s.playing);
  const buffering = usePlayback((s) => s.buffering);
  const volumeBar = useRef<HTMLButtonElement>(null);
  const level = muted ? 0 : volume;
  const setFrom = (clientX: number) => {
    const rect = volumeBar.current!.getBoundingClientRect();
    setVolume(Math.round(Math.min(1, Math.max(0, (clientX - rect.left) / rect.width)) * 20) / 20);
  };

  return (
    <div className="flex items-center gap-3 text-[clamp(20px,2.6vw,34px)] uppercase leading-none sm:gap-4">
      <button className={word} onClick={() => skipBy(-BACK_SECONDS)} aria-label={`Back ${BACK_SECONDS} seconds`}>
        −{BACK_SECONDS}
      </button>
      <span aria-hidden="true">|</span>
      <button className={`${word} min-w-[3.6em] text-center`} onClick={toggle}>
        {buffering && !playing ? "…" : playing ? "Pause" : "Play"}
      </button>
      <span aria-hidden="true">|</span>
      <button className={word} onClick={() => skipBy(FORWARD_SECONDS)} aria-label={`Forward ${FORWARD_SECONDS} seconds`}>
        +{FORWARD_SECONDS}
      </button>
      {/* Volume: the word fills with ink to the level. Click to set, double-click to mute. */}
      <button
        ref={volumeBar}
        className="relative ml-2 hidden touch-none uppercase sm:block"
        aria-label={`Volume ${Math.round(level * 100)}%`}
        onPointerDown={(e) => {
          e.currentTarget.setPointerCapture(e.pointerId);
          setFrom(e.clientX);
        }}
        onPointerMove={(e) => e.buttons === 1 && setFrom(e.clientX)}
        onDoubleClick={toggleMute}
        onKeyDown={(e) => {
          const step = e.key === "ArrowRight" || e.key === "ArrowUp" ? 0.1 : e.key === "ArrowLeft" || e.key === "ArrowDown" ? -0.1 : 0;
          if (!step) return;
          e.preventDefault();
          e.stopPropagation();
          setVolume(Math.min(1, Math.max(0, Math.round((level + step) * 10) / 10)));
        }}
      >
        <span className="block px-2 pb-1 pt-1.5">Volume</span>
        <span
          aria-hidden="true"
          className="absolute inset-0 block bg-text px-2 pb-1 pt-1.5 text-bg"
          style={{ clipPath: `inset(0 ${(1 - level) * 100}% 0 0)` }}
        >
          Volume
        </span>
      </button>
    </div>
  );
}
