"use client";

import { LoaderCircle, RefreshCw, X } from "lucide-react";
import { memo, useEffect, useRef, useState } from "react";
import { retryScanning } from "@/hooks/useAdScanner";
import { WINDOW_SECONDS } from "@/lib/analysis";
import { formatClock, formatDuration } from "@/lib/text";
import type { AdRange, TranscriptSegment } from "@/lib/types";
import { adAt, useAnalysis } from "@/store/analysis";
import { usePlayback, usePlayer } from "@/store/player";

type Tab = "transcript" | "ads";

export function NowPlayingPanel() {
  const [tab, setTab] = useState<Tab>("transcript");
  const setPanelOpen = usePlayer((s) => s.setPanelOpen);
  const ads = useAnalysis((s) => s.ads);

  return (
    <section
      aria-label="Transcript and ads"
      className="animate-toast-in mx-auto mb-2 flex max-h-[min(62dvh,36rem)] w-full max-w-[69rem] flex-col overflow-hidden rounded-3xl bg-surface shadow-float"
    >
      <div className="flex items-center gap-2 px-4 pb-2 pt-4 sm:px-5">
        <div role="tablist" className="flex gap-2">
          <TabButton active={tab === "transcript"} onClick={() => setTab("transcript")}>
            Transcript
          </TabButton>
          <TabButton active={tab === "ads"} onClick={() => setTab("ads")}>
            Ad breaks{ads.length > 0 && <span className="ml-1.5 font-mono text-xs opacity-70">{ads.length}</span>}
          </TabButton>
        </div>
        <ScanStatus />
        <button
          onClick={() => setPanelOpen(false)}
          className="hover-breathe rounded-full p-1.5 text-muted hover:bg-surface-2 hover:text-text"
          aria-label="Close panel"
        >
          <X className="size-4" />
        </button>
      </div>
      {tab === "transcript" ? <Transcript /> : <AdList />}
    </section>
  );
}

function TabButton({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      role="tab"
      aria-selected={active}
      onClick={onClick}
      className={`hover-breathe flex h-9 items-center rounded-full px-4 text-sm font-medium [--hover-scale:1.04] ${
        active ? "bg-accent text-accent-text" : "bg-surface-2 text-text"
      }`}
    >
      {children}
    </button>
  );
}

function ScanStatus() {
  const windows = useAnalysis((s) => s.windows);
  const error = useAnalysis((s) => s.error);
  const scanning = Object.values(windows).includes("pending");
  const done = Object.values(windows).filter((s) => s === "done").length;

  if (error) {
    return (
      <div className="ml-auto flex min-w-0 items-center gap-2 text-xs text-danger">
        <span className="truncate" title={error}>
          Ad detection paused: {error}
        </span>
        <button onClick={retryScanning} className="flex shrink-0 items-center gap-1 rounded-full px-2 py-0.5 hover:bg-surface-2">
          <RefreshCw className="size-3" /> Retry
        </button>
      </div>
    );
  }

  return (
    <p className="ml-auto flex items-center gap-1.5 truncate font-mono text-xs text-faint">
      {scanning && <LoaderCircle className="size-3 animate-spin" aria-hidden="true" />}
      {scanning ? "Listening ahead…" : done ? `${(done * WINDOW_SECONDS) / 60} min analyzed` : ""}
    </p>
  );
}

/** Index of the last line starting at or before `time` (lines are sorted), or -1. */
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

function Transcript() {
  const segments = useAnalysis((s) => s.segments);
  const ads = useAnalysis((s) => s.ads);
  // The current line, not the time: playback ticks ~4×/s, lines change every few seconds.
  const activeIndex = usePlayback((s) => lineAt(segments, s.currentTime));
  const seek = usePlayer((s) => s.seek);
  const container = useRef<HTMLDivElement>(null);
  const [follow, setFollow] = useState(true);

  // Keep the current line in view unless the listener has scrolled away.
  useEffect(() => {
    if (!follow || activeIndex < 0) return;
    const box = container.current;
    const el = box?.querySelector<HTMLElement>(`[data-index="${activeIndex}"]`);
    // Scroll only this list; scrollIntoView would also scroll the page.
    if (box && el) box.scrollTo({ top: el.offsetTop - box.clientHeight / 2 + el.clientHeight / 2, behavior: "smooth" });
  }, [activeIndex, follow]);

  if (segments.length === 0) {
    return (
      <div className="grid flex-1 place-items-center p-10 text-center text-sm text-muted">
        <div className="flex items-center gap-2">
          <LoaderCircle className="size-4 animate-spin" aria-hidden="true" /> Transcribing…
        </div>
      </div>
    );
  }

  return (
    <div className="relative flex min-h-0 flex-1 flex-col">
      <div
        ref={container}
        onWheel={() => setFollow(false)}
        onTouchMove={() => setFollow(false)}
        className="relative min-h-0 flex-1 space-y-0.5 overflow-y-auto overscroll-contain px-3 pb-4 pt-2 sm:px-4"
      >
        {segments.map((segment, i) => (
          <TranscriptLine
            key={`${segment.start}-${segment.end}`}
            index={i}
            segment={segment}
            active={i === activeIndex}
            past={i < activeIndex}
            ad={adAt(ads, (segment.start + segment.end) / 2)}
            onSeek={seek}
          />
        ))}
      </div>
      {!follow && (
        <button
          onClick={() => setFollow(true)}
          className="absolute bottom-3 left-1/2 -translate-x-1/2 rounded-full bg-accent px-3.5 py-1.5 text-xs font-medium text-accent-text"
        >
          Jump to now
        </button>
      )}
    </div>
  );
}

/** Memoized: in a long transcript only the lines whose state changed re-render. */
const TranscriptLine = memo(function TranscriptLine({
  segment,
  index,
  active,
  past,
  ad,
  onSeek,
}: {
  segment: TranscriptSegment;
  index: number;
  active: boolean;
  past: boolean;
  ad: AdRange | undefined;
  onSeek: (t: number) => void;
}) {
  return (
    <button
      data-index={index}
      onClick={() => onSeek(segment.start)}
      className={`hover-fill flex w-full gap-4 rounded-xl px-3 py-1.5 text-left text-body leading-relaxed ${
        ad ? "bg-ad-soft text-muted" : active ? "bg-surface-2 font-medium text-text" : past ? "text-muted" : "text-text"
      }`}
    >
      <span className={`w-14 shrink-0 pt-0.5 font-mono text-xs ${ad ? "text-ad-text" : active ? "text-text" : "text-faint"}`}>
        {formatClock(segment.start)}
      </span>
      <span className="min-w-0 flex-1">{segment.text}</span>
    </button>
  );
});

function AdList() {
  const ads = useAnalysis((s) => s.ads);
  const segments = useAnalysis((s) => s.segments);
  const currentTime = usePlayback((s) => s.currentTime);
  const seek = usePlayer((s) => s.seek);

  if (ads.length === 0) {
    return (
      <p className="p-10 text-center text-sm text-muted">
        No ads found yet. Podblock scans a few minutes ahead of where you&apos;re listening.
      </p>
    );
  }

  const total = ads.reduce((sum, ad) => sum + (ad.end - ad.start), 0);
  return (
    <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-4 pb-4 pt-2 sm:px-5">
      <p className="mb-3 font-mono text-xs text-faint">
        {ads.length} ad {ads.length === 1 ? "break" : "breaks"} · {formatDuration(total)} total
      </p>
      <ul className="grid gap-3 md:grid-cols-2">
        {ads.map((ad) => {
          const preview = segments
            .filter((s) => s.end > ad.start && s.start < ad.end)
            .map((s) => s.text)
            .join(" ");
          const status = currentTime >= ad.end ? "Passed" : currentTime >= ad.start ? "Playing" : "Upcoming";
          return (
            <li key={`${ad.start}-${ad.end}`}>
              <button
                onClick={() => seek(ad.start)}
                className="hover-wave flex h-full w-full flex-col gap-1.5 overflow-hidden rounded-2xl bg-ad-soft px-4 py-3.5 text-left"
              >
                <div className="flex items-baseline justify-between gap-3">
                  <span className="truncate font-serif text-xl">{advertiser(ad)}</span>
                  <span className="shrink-0 font-mono text-xs text-ad-text">{status}</span>
                </div>
                <span className="font-mono text-xs text-muted">
                  {formatClock(ad.start)} – {formatClock(ad.end)} · {formatDuration(ad.end - ad.start)}
                </span>
                {preview && <p className="line-clamp-2 text-sm text-muted">{preview}</p>}
              </button>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

/** "Ad: Sierra" → "Sierra"; several merged ads read "Ad: A; Ad: B" → "A, B". */
function advertiser(ad: AdRange): string {
  const names = ad.reason
    .split(";")
    .map((part) => part.trim().replace(/^Ad:?\s*/i, ""))
    .filter(Boolean);
  return names.length ? [...new Set(names)].join(", ") : "Ad";
}
