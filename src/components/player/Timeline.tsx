"use client";

import { useRef, useState } from "react";
import { advertiser } from "@/lib/ads/label";
import { WINDOW_SECONDS } from "@/lib/analysis";
import { formatClock } from "@/lib/text";
import type { AdRange, TranscriptSegment } from "@/lib/types";
import type { WindowStatus } from "@/store/analysis";
import { BACK_SECONDS, FINE_SECONDS, FORWARD_SECONDS } from "@/store/player";

interface Props {
  currentTime: number;
  duration: number;
  ads: AdRange[];
  windows: Record<number, WindowStatus>;
  /** Transcript, for previewing what's said at the point under the pointer. */
  segments?: TranscriptSegment[];
  onSeek: (time: number) => void;
}

/** Shortest an ad is drawn, so a 30-second ad in a long episode is still visible on a phone. */
const MIN_AD_PX = 3;

/** The transcript line spoken at `time`, if any. */
function lineAt(segments: TranscriptSegment[], time: number) {
  return segments.find((s) => time >= s.start && time < s.end);
}

/**
 * Seek bar that also shows which parts of the episode have been scanned and
 * where the ads are. Hovering or dragging previews the time, the ad and the
 * words at that point.
 */
export function Timeline({ currentTime, duration, ads, windows, segments = [], onSeek }: Props) {
  const track = useRef<HTMLDivElement>(null);
  const [drag, setDrag] = useState<number | null>(null);
  const [hover, setHover] = useState<number | null>(null);

  const known = duration > 0;
  const shown = drag ?? currentTime;
  const fraction = (t: number) => (known ? Math.min(1, Math.max(0, t / duration)) : 0);
  const pct = (t: number) => `${fraction(t) * 100}%`;

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

  const scanned = Object.entries(windows)
    .filter(([, status]) => status === "done")
    .map(([w]) => Number(w));
  const scanning = Object.entries(windows)
    .filter(([, status]) => status === "pending")
    .map(([w]) => Number(w));

  const previewAt = drag ?? hover;
  const previewAd = previewAt === null ? undefined : ads.find((ad) => previewAt >= ad.start && previewAt < ad.end);
  const previewLine = previewAt === null ? undefined : lineAt(segments, previewAt);
  const draggingIntoAd = drag !== null && previewAd !== undefined;

  return (
    <div className="flex items-center gap-3 font-mono text-micro text-muted">
      <span className="w-14 text-right tabular-nums">{formatClock(shown)}</span>
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
        className="group relative h-8 flex-1 cursor-pointer touch-none select-none"
      >
        <div className="absolute inset-x-0 top-1/2 h-1.5 -translate-y-1/2 overflow-hidden rounded-full bg-surface-2 pointer-coarse:h-2">
          {scanned.map((w) => (
            <div
              key={`s${w}`}
              className="absolute inset-y-0 bg-scanned"
              style={{ left: pct(w), width: pct(WINDOW_SECONDS) }}
            />
          ))}
          {scanning.map((w) => (
            <div
              key={`p${w}`}
              className="skeleton absolute inset-y-0 opacity-70"
              style={{ left: pct(w), width: pct(WINDOW_SECONDS) }}
            />
          ))}
          <div
            className={`absolute inset-y-0 left-0 bg-accent ${drag === null ? "transition-[width] duration-300 ease-linear" : ""}`}
            style={{ width: pct(shown) }}
          />
          {ads.map((ad) => (
            <div
              key={`${ad.start}-${ad.end}`}
              className={`absolute inset-y-0 rounded-sm bg-ad ${ad.end <= shown ? "opacity-50" : ""}`}
              style={{ left: pct(ad.start), width: pct(ad.end - ad.start), minWidth: MIN_AD_PX }}
            />
          ))}
        </div>
        {known && (
          <div
            className={`absolute top-1/2 size-3.5 -translate-x-1/2 -translate-y-1/2 rounded-full ring-2 ring-surface ${
              draggingIntoAd ? "scale-150 bg-ad" : drag !== null ? "scale-125 bg-accent" : "scale-75 bg-accent group-hover:scale-100 group-focus-visible:scale-100"
            } ${drag === null ? "transition-[left,scale] duration-300 ease-linear" : "transition-[scale,background-color] duration-150"}`}
            style={{ left: pct(shown) }}
          />
        )}
        {previewAt !== null && (
          // Anchored so it slides from left-aligned at the start to right-aligned at the end, never off the bar.
          <div
            className="pointer-events-none absolute bottom-full mb-1.5 w-max max-w-[min(20rem,80vw)] rounded-lg bg-text px-2 py-1 text-left text-micro text-bg shadow-float"
            style={{ left: pct(previewAt), translate: `-${fraction(previewAt) * 100}% 0` }}
          >
            <span className="tabular-nums">{formatClock(previewAt)}</span>
            {previewAd && (
              <span>
                {" · "}
                <span className="inline-block size-1.5 -translate-y-px rounded-full bg-ad align-middle" aria-hidden="true" /> Ad ·{" "}
                {advertiser(previewAd)}
              </span>
            )}
            {previewLine && (
              <span className="mt-0.5 line-clamp-2 block font-sans text-xs leading-snug opacity-80">{previewLine.text}</span>
            )}
          </div>
        )}
      </div>
      <span className="w-14 tabular-nums">{known ? `-${formatClock(Math.max(0, duration - shown))}` : "--:--"}</span>
    </div>
  );
}
