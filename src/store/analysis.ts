"use client";

import { create } from "zustand";
import { WINDOW_SECONDS } from "@/lib/analysis";
import { decodeEnvelope } from "@/lib/envelope";
import type { AdRange, CachedAnalysis, TranscriptSegment } from "@/lib/types";

export type WindowStatus = "pending" | "done" | "error";

interface AnalysisState {
  /** Audio URL the state below belongs to. */
  url: string | null;
  windows: Record<number, WindowStatus>;
  segments: TranscriptSegment[];
  ads: AdRange[];
  /** Loudness envelopes by window start (lib/envelope.ts), for the windows that have one. */
  envelopes: Record<number, Uint8Array>;
  /** Set when analysis keeps failing and the scanner has backed off. */
  error: string | null;

  reset: (url: string | null) => void;
  setStatus: (window: number, status: WindowStatus) => void;
  /** Forget a window's status so the scanner can request it again. */
  clearStatus: (window: number) => void;
  addWindow: (window: number, segments: TranscriptSegment[], ads: AdRange[], envelope?: string) => void;
  setError: (error: string | null) => void;
  /** Merges previously analyzed windows fetched from the server cache. */
  restore: (cached: CachedAnalysis) => void;
}

export const useAnalysis = create<AnalysisState>()((set) => ({
  url: null,
  windows: {},
  segments: [],
  ads: [],
  envelopes: {},
  error: null,

  reset: (url) => set({ url, windows: {}, segments: [], ads: [], envelopes: {}, error: null }),

  setStatus: (window, status) => set((s) => ({ windows: { ...s.windows, [window]: status } })),

  clearStatus: (window) =>
    set((s) => {
      const windows = { ...s.windows };
      delete windows[window];
      return { windows };
    }),

  addWindow: (window, segments, ads, envelope) =>
    set((s) => ({
      envelopes: envelope ? { ...s.envelopes, [window]: decodeEnvelope(envelope) } : s.envelopes,
      windows: { ...s.windows, [window]: "done" },
      segments: [...s.segments.filter((seg) => seg.start < window || seg.start >= window + WINDOW_SECONDS), ...segments].sort(
        (a, b) => a.start - b.start,
      ),
      ads,
      error: null,
    })),

  setError: (error) => set({ error }),

  restore: (cached) =>
    set((s) => {
      const windows = { ...s.windows };
      for (const w of cached.windows) windows[w] = "done";
      const known = new Set(s.segments.map((seg) => seg.start));
      const envelopes = { ...s.envelopes };
      for (const [w, envelope] of Object.entries(cached.envelopes ?? {})) envelopes[Number(w)] ??= decodeEnvelope(envelope);
      return {
        windows,
        envelopes,
        segments: [...s.segments, ...cached.segments.filter((seg) => !known.has(seg.start))].sort(
          (a, b) => a.start - b.start,
        ),
        // Newer results from in-flight windows win over the snapshot.
        ads: s.ads.length ? s.ads : cached.ads,
      };
    }),
}));

/** The ad range containing `time`, if any. */
export function adAt(ads: AdRange[], time: number): AdRange | undefined {
  return ads.find((ad) => time >= ad.start && time < ad.end);
}
