"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { advertiser } from "@/lib/ads/label";
import { windowStartFor } from "@/lib/analysis";
import { formatClock } from "@/lib/text";
import type { AdRange, TranscriptSegment } from "@/lib/types";
import { waveformBars } from "@/lib/waveform";
import type { WindowStatus } from "@/store/analysis";
import { BACK_SECONDS, FINE_SECONDS, FORWARD_SECONDS } from "@/store/player";

interface Props {
  currentTime: number;
  duration: number;
  ads: AdRange[];
  windows: Record<number, WindowStatus>;
  /** Loudness envelopes by window start (lib/envelope.ts). */
  envelopes: Record<number, Uint8Array>;
  /** Transcript, for previewing what's said at the point under the pointer. */
  segments?: TranscriptSegment[];
  onSeek: (time: number) => void;
  size?: "sm" | "lg";
}

/** Bar pitch (bar plus gap), px. */
const PITCH = { sm: 4, lg: 6 } as const;

/** The transcript line spoken at `time`, if any. */
function lineAt(segments: TranscriptSegment[], time: number) {
  return segments.find((s) => time >= s.start && time < s.end);
}

/**
 * The seek bar, drawn as the episode's waveform: played bars in ink, the
 * rest faint, ads in orange, and a dotted baseline where the episode hasn't
 * been measured yet (shimmering while it's being analyzed). Hovering or
 * dragging previews the time, any ad, and the words at that point.
 */
export function Waveform({ currentTime, duration, ads, windows, envelopes, segments = [], onSeek, size = "sm" }: Props) {
  const track = useRef<HTMLDivElement>(null);
  const [count, setCount] = useState(0);
  const [drag, setDrag] = useState<number | null>(null);
  const [hover, setHover] = useState<number | null>(null);

  // As many bars as fit.
  useEffect(() => {
    const el = track.current!;
    const measure = () => setCount(Math.max(24, Math.floor(el.clientWidth / PITCH[size])));
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(el);
    return () => observer.disconnect();
  }, [size]);

  const known = duration > 0;
  const shown = drag ?? currentTime;
  const fraction = (t: number) => (known ? Math.min(1, Math.max(0, t / duration)) : 0);
  const pct = (t: number) => `${fraction(t) * 100}%`;
  const slice = known && count ? duration / count : 0;

  const heights = useMemo(() => waveformBars(envelopes, duration, count), [envelopes, duration, count]);
  const inAd = useMemo(
    () => heights.map((_, i) => ads.some((ad) => (i + 0.5) * slice >= ad.start && (i + 0.5) * slice < ad.end)),
    [heights, ads, slice],
  );

  const timeAt = (clientX: number) => {
    const rect = track.current!.getBoundingClientRect();
    return Math.min(1, Math.max(0, (clientX - rect.left) / rect.width)) * duration;
  };

  // The same jumps as the player's buttons and global shortcuts; Shift for a fine step.
  const onKeyDown = (e: React.KeyboardEvent) => {
    const back = e.shiftKey ? -FINE_SECONDS : -BACK_SECONDS;
    const forward = e.shiftKey ? FINE_SECONDS : FORWARD_SECONDS;
    const steps: Record<string, number> = {
      ArrowLeft: back,
      ArrowDown: back,
      ArrowRight: forward,
      ArrowUp: forward,
      PageDown: -60,
      PageUp: 60,
    };
    if (e.key in steps) onSeek(currentTime + steps[e.key]);
    else if (e.key === "Home") onSeek(0);
    else if (e.key === "End") onSeek(duration - 1);
    else return;
    e.preventDefault();
    e.stopPropagation();
  };

  const previewAt = drag ?? hover;
  const previewAd = previewAt === null ? undefined : ads.find((ad) => previewAt >= ad.start && previewAt < ad.end);
  const previewLine = previewAt === null ? undefined : lineAt(segments, previewAt);
  const lg = size === "lg";

  return (
    <div
      ref={track}
      role="slider"
      tabIndex={known ? 0 : -1}
      aria-label="Seek"
      aria-valuemin={0}
      aria-valuemax={Math.round(duration)}
      aria-valuenow={Math.round(shown)}
      aria-valuetext={`${formatClock(shown)} of ${formatClock(duration)}`}
      onKeyDown={onKeyDown}
      onPointerDown={(e) => {
        if (!known) return;
        e.currentTarget.setPointerCapture(e.pointerId);
        setDrag(timeAt(e.clientX));
      }}
      onPointerMove={(e) => {
        if (!known) return;
        const t = timeAt(e.clientX);
        if (e.pointerType === "mouse") setHover(t);
        if (drag !== null) setDrag(t);
      }}
      onPointerUp={(e) => {
        if (drag === null) return;
        onSeek(timeAt(e.clientX));
        setDrag(null);
      }}
      onPointerCancel={() => setDrag(null)}
      onPointerLeave={() => setHover(null)}
      className={`group relative w-full cursor-pointer touch-none select-none ${lg ? "h-28" : "h-9"}`}
    >
      <div className="absolute inset-0 flex items-center justify-between" aria-hidden="true">
        {heights.map((h, i) => {
          const played = (i + 1) * slice <= shown;
          const scanning = h === null && windows[windowStartFor(i * slice)] === "pending";
          const color = inAd[i]
            ? played
              ? "bg-ad/45"
              : "bg-ad"
            : h === null
              ? "bg-text/20"
              : played
                ? "bg-text"
                : "bg-text/25";
          return (
            <span
              key={i}
              data-bar
              className={`block shrink-0 ${lg ? "w-[3px]" : "w-[2px]"} ${color} ${scanning ? "animate-pulse" : ""}`}
              style={h === null ? { height: 2 } : { height: `${Math.round(h * 100)}%`, minHeight: 3 }}
            />
          );
        })}
      </div>
      {known && (
        <span
          aria-hidden="true"
          className={`pointer-events-none absolute inset-y-0 w-px bg-text ${drag === null ? "transition-[left] duration-300 ease-linear" : ""}`}
          style={{ left: pct(shown) }}
        />
      )}
      {previewAt !== null && (
        // Anchored so it slides from left-aligned at the start to right-aligned at the end, never off the bar.
        <div
          className="pointer-events-none absolute bottom-full z-10 mb-2 w-max max-w-[min(20rem,80vw)] bg-text px-2 py-1 text-left font-mono text-micro text-bg"
          style={{ left: pct(previewAt), translate: `-${fraction(previewAt) * 100}% 0` }}
        >
          <span className="tabular-nums">{formatClock(previewAt)}</span>
          {previewAd && (
            <span>
              {" · "}
              <span className="inline-block size-1.5 -translate-y-px bg-ad align-middle" aria-hidden="true" /> Ad ·{" "}
              {advertiser(previewAd)}
            </span>
          )}
          {previewLine && <span className="mt-0.5 line-clamp-2 block font-sans text-xs leading-snug opacity-80">{previewLine.text}</span>}
        </div>
      )}
    </div>
  );
}
