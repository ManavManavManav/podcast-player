"use client";

import { useRef, useState } from "react";
import { WINDOW_SECONDS } from "@/lib/analysis";
import { formatClock } from "@/lib/text";
import type { AdRange } from "@/lib/types";
import type { WindowStatus } from "@/store/analysis";

interface Props {
  currentTime: number;
  duration: number;
  ads: AdRange[];
  windows: Record<number, WindowStatus>;
  onSeek: (time: number) => void;
}

/**
 * Seek bar that also shows which parts of the episode have been scanned and
 * where the ads are.
 */
export function Timeline({ currentTime, duration, ads, windows, onSeek }: Props) {
  const track = useRef<HTMLDivElement>(null);
  const [drag, setDrag] = useState<number | null>(null);
  const [hover, setHover] = useState<number | null>(null);

  const known = duration > 0;
  const shown = drag ?? currentTime;
  const pct = (t: number) => (known ? `${Math.min(100, Math.max(0, (t / duration) * 100))}%` : "0%");

  const timeAt = (clientX: number) => {
    const rect = track.current!.getBoundingClientRect();
    return Math.min(1, Math.max(0, (clientX - rect.left) / rect.width)) * duration;
  };

  const onKeyDown = (e: React.KeyboardEvent) => {
    const steps: Record<string, number> = {
      ArrowLeft: -5,
      ArrowRight: 5,
      ArrowDown: -5,
      ArrowUp: 5,
      PageDown: -30,
      PageUp: 30,
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

  return (
    <div className="flex items-center gap-3 text-[11px] tabular-nums text-muted">
      <span className="w-12 text-right">{formatClock(shown)}</span>
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
          setHover(t);
          if (drag !== null) setDrag(t);
        }}
        onPointerUp={(e) => {
          if (drag === null) return;
          onSeek(timeAt(e.clientX));
          setDrag(null);
        }}
        onPointerCancel={() => setDrag(null)}
        onPointerLeave={() => setHover(null)}
        className="group relative h-6 flex-1 cursor-pointer touch-none select-none"
      >
        <div className="absolute inset-x-0 top-1/2 h-1.5 -translate-y-1/2 overflow-hidden rounded-full bg-surface-2">
          {scanned.map((w) => (
            <div
              key={`s${w}`}
              className="absolute inset-y-0 bg-border"
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
              key={ad.start}
              className={`absolute inset-y-0 bg-ad ${ad.end <= shown ? "opacity-50" : ""}`}
              style={{ left: pct(ad.start), width: pct(ad.end - ad.start) }}
              title={`Ad · ${formatClock(ad.start)}–${formatClock(ad.end)}`}
            />
          ))}
        </div>
        <div
          className={`absolute top-1/2 size-3.5 -translate-x-1/2 -translate-y-1/2 rounded-full bg-accent shadow ring-2 ring-surface transition-transform ${
            drag !== null ? "scale-125" : "scale-0 group-hover:scale-100 group-focus-visible:scale-100"
          } ${drag === null ? "transition-[left] duration-300 ease-linear" : ""}`}
          style={{ left: pct(shown) }}
        />
        {hover !== null && drag === null && (
          <div
            className="pointer-events-none absolute -top-7 -translate-x-1/2 rounded-md bg-text px-1.5 py-0.5 text-[11px] text-bg shadow"
            style={{ left: pct(hover) }}
          >
            {formatClock(hover)}
            {ads.some((ad) => hover >= ad.start && hover < ad.end) && " · ad"}
          </div>
        )}
      </div>
      <span className="w-12">{known ? `-${formatClock(Math.max(0, duration - shown))}` : "--:--"}</span>
    </div>
  );
}
