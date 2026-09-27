"use client";

import { LoaderCircle, RefreshCw } from "lucide-react";
import { memo, useEffect, useId, useRef, useState } from "react";
import { buttonStyles } from "@/components/ui/Button";
import { retryScanning } from "@/hooks/useAdScanner";
import { advertiser } from "@/lib/ads/label";
import { WINDOW_SECONDS } from "@/lib/analysis";
import { formatClock, formatDuration } from "@/lib/text";
import type { AdRange, TranscriptSegment } from "@/lib/types";
import { adAt, useAnalysis } from "@/store/analysis";
import { usePlayback, usePlayer } from "@/store/player";

type Tab = "transcript" | "ads";
const TABS: Tab[] = ["transcript", "ads"];

/** The tab last chosen, kept for the rest of the visit so reopening the panel doesn't reset it. */
let lastTab: Tab = "transcript";

export function NowPlayingPanel() {
  const [tab, setTabState] = useState<Tab>(lastTab);
  const setTab = (next: Tab) => {
    lastTab = next;
    setTabState(next);
  };
  const setPanelOpen = usePlayer((s) => s.setPanelOpen);
  const ads = useAnalysis((s) => s.ads);
  const id = useId();
  const tabId = (t: Tab) => `${id}-tab-${t}`;
  const panelId = `${id}-panel`;

  // Arrow keys move between tabs, as in any tab list.
  const onTabKey = (e: React.KeyboardEvent) => {
    const step = e.key === "ArrowRight" ? 1 : e.key === "ArrowLeft" ? -1 : 0;
    if (!step) return;
    e.preventDefault();
    e.stopPropagation();
    const next = TABS[(TABS.indexOf(tab) + step + TABS.length) % TABS.length];
    setTab(next);
    document.getElementById(tabId(next))?.focus();
  };

  return (
    <section
      aria-label="Transcript and ads"
      className="animate-toast-in mx-auto mb-2 flex max-h-[min(62dvh,36rem)] w-full max-w-[60rem] flex-col overflow-hidden border border-text bg-bg font-grotesk shadow-float"
    >
      {/* Phones: tabs and close on one row, scan status under them. Wider: all on one row. */}
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1.5 px-4 pb-2 pt-4 sm:flex-nowrap sm:px-5">
        <div role="tablist" aria-label="Panel" onKeyDown={onTabKey} className="flex shrink-0 gap-1">
          <TabButton id={tabId("transcript")} controls={panelId} active={tab === "transcript"} onClick={() => setTab("transcript")}>
            Transcript
          </TabButton>
          <TabButton id={tabId("ads")} controls={panelId} active={tab === "ads"} onClick={() => setTab("ads")}>
            <span aria-hidden="true" className="sm:hidden">
              Ads
            </span>
            <span className="max-sm:sr-only">Ad breaks</span>
            {ads.length > 0 && <span className="ml-1.5 font-mono text-xs opacity-70">{ads.length}</span>}
          </TabButton>
        </div>
        <div className="order-last min-w-0 basis-full sm:order-none sm:ml-auto sm:basis-auto">
          <ScanStatus />
        </div>
        <button
          onClick={() => setPanelOpen(false)}
          className={`${buttonStyles({ variant: "word", size: "sm" })} ml-auto sm:ml-0`}
          aria-label="Close panel"
        >
          Close
        </button>
      </div>
      <div id={panelId} role="tabpanel" aria-labelledby={tabId(tab)} className="flex min-h-0 flex-1 flex-col">
        {tab === "transcript" ? <Transcript /> : <AdList />}
      </div>
    </section>
  );
}

function TabButton({
  id,
  controls,
  active,
  onClick,
  children,
}: {
  id: string;
  controls: string;
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      id={id}
      role="tab"
      aria-selected={active}
      aria-controls={controls}
      tabIndex={active ? 0 : -1}
      onClick={onClick}
      className={`touch-target relative ${buttonStyles({ variant: "word", size: "sm" })}`}
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
      <div className="flex min-w-0 items-center gap-2 text-xs text-danger">
        <span className="truncate" title={error}>
          Ad detection paused: {error}
        </span>
        <button onClick={retryScanning} className="flex shrink-0 items-center gap-1 px-2 py-0.5 uppercase hover:line-through">
          <RefreshCw className="size-3" /> Retry
        </button>
      </div>
    );
  }

  return (
    <p className="flex items-center gap-1.5 truncate font-mono text-xs text-faint sm:justify-end">
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
          className={`absolute bottom-3 left-1/2 -translate-x-1/2 ${buttonStyles({ size: "sm" })}`}
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
      aria-current={active || undefined}
      onClick={() => onSeek(segment.start)}
      className={`hover-tint relative flex w-full gap-4 px-3 py-1.5 text-left text-body leading-relaxed ${
        ad ? "bg-ad-soft" : active ? "bg-surface-2" : ""
      } ${active ? "font-medium text-text" : ad || past ? "text-muted" : "text-text"} ${
        // The current line always carries an ink bar, even inside an ad, so you can see where you are.
        active ? "before:absolute before:inset-y-2 before:left-1 before:w-[3px] before:bg-text" : ""
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
                className="flex h-full w-full flex-col gap-1.5 overflow-hidden border-l-2 border-ad bg-ad-soft px-4 py-3.5 text-left"
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
