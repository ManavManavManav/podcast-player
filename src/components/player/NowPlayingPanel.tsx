"use client";

import { LoaderCircle, RefreshCw, X } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { retryScanning } from "@/hooks/useAdScanner";
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
      className="animate-toast-in mx-auto mb-2 flex max-h-[min(60dvh,32rem)] w-full max-w-4xl flex-col overflow-hidden rounded-2xl border border-border bg-surface shadow-card"
    >
      <div className="flex items-center gap-1 border-b border-border px-2 py-1.5">
        <div role="tablist" className="flex gap-1">
          <TabButton active={tab === "transcript"} onClick={() => setTab("transcript")}>
            Transcript
          </TabButton>
          <TabButton active={tab === "ads"} onClick={() => setTab("ads")}>
            Ads found{ads.length > 0 && <span className="ml-1.5 rounded-full bg-ad-soft px-1.5 text-ad-text">{ads.length}</span>}
          </TabButton>
        </div>
        <ScanStatus />
        <button
          onClick={() => setPanelOpen(false)}
          className="rounded-full p-1.5 text-muted hover:bg-surface-2 hover:text-text"
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
      className={`flex items-center rounded-full px-3 py-1 text-sm font-medium transition ${
        active ? "bg-surface-2 text-text" : "text-muted hover:text-text"
      }`}
    >
      {children}
    </button>
  );
}

function ScanStatus() {
  const windows = useAnalysis((s) => s.windows);
  const error = useAnalysis((s) => s.error);
  const detector = useAnalysis((s) => s.detector);
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
    <p className="ml-auto flex items-center gap-1.5 truncate text-xs text-faint">
      {scanning && <LoaderCircle className="size-3 animate-spin" aria-hidden="true" />}
      {scanning ? "Listening ahead…" : done ? `${done} min analyzed` : ""}
      {detector && <span className="hidden sm:inline">· {detector === "claude" ? "Claude" : "on-device"} detection</span>}
    </p>
  );
}

function Transcript() {
  const segments = useAnalysis((s) => s.segments);
  const ads = useAnalysis((s) => s.ads);
  const currentTime = usePlayback((s) => s.currentTime);
  const seek = usePlayer((s) => s.seek);
  const container = useRef<HTMLDivElement>(null);
  const [follow, setFollow] = useState(true);

  const activeIndex = useMemo(() => {
    let index = -1;
    for (let i = 0; i < segments.length && segments[i].start <= currentTime; i++) index = i;
    return index;
  }, [segments, currentTime]);

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
          <LoaderCircle className="size-4 animate-spin" aria-hidden="true" /> Transcribing the first minute…
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
        className="relative min-h-0 flex-1 space-y-0.5 overflow-y-auto overscroll-contain px-3 py-3"
      >
        {segments.map((segment, i) => (
          <TranscriptLine
            key={segment.start}
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
          className="absolute bottom-3 left-1/2 -translate-x-1/2 rounded-full bg-text px-3 py-1 text-xs font-medium text-bg shadow-card"
        >
          Jump to now
        </button>
      )}
    </div>
  );
}

function TranscriptLine({
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
      className={`flex w-full gap-3 rounded-lg px-2 py-1 text-left text-[15px] leading-relaxed transition ${
        active ? "bg-accent-soft text-text" : past ? "text-muted" : "text-text"
      } ${ad ? "border-l-2 border-ad bg-ad-soft/60" : "hover:bg-surface-2"}`}
    >
      <span className="w-11 shrink-0 pt-0.5 text-right text-xs tabular-nums text-faint">{formatClock(segment.start)}</span>
      <span className="min-w-0 flex-1">{segment.text}</span>
    </button>
  );
}

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
    <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain p-3">
      <p className="mb-2 px-2 text-xs text-muted">
        {ads.length} ad {ads.length === 1 ? "break" : "breaks"} · {formatDuration(total)} total
      </p>
      <ul className="space-y-1.5">
        {ads.map((ad) => {
          const preview = segments
            .filter((s) => s.end > ad.start && s.start < ad.end)
            .map((s) => s.text)
            .join(" ");
          const status = currentTime >= ad.end ? "Passed" : currentTime >= ad.start ? "Playing" : "Upcoming";
          return (
            <li key={ad.start}>
              <button
                onClick={() => seek(ad.start)}
                className="w-full rounded-xl border border-border px-3 py-2.5 text-left transition hover:bg-surface-2"
              >
                <div className="flex items-center gap-2 text-xs">
                  <span className="font-medium tabular-nums">
                    {formatClock(ad.start)} – {formatClock(ad.end)}
                  </span>
                  <span className="rounded-full bg-ad-soft px-1.5 py-px text-ad-text">{formatDuration(ad.end - ad.start)}</span>
                  <span className="ml-auto text-faint">{status}</span>
                </div>
                <p className="mt-1 line-clamp-2 text-sm text-muted">{preview}</p>
                {ad.reason && <p className="mt-1 text-[11px] text-faint">Why: {ad.reason}</p>}
              </button>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
