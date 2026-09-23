import type { AdRange, TranscriptSegment } from "@/lib/types";

/** Ads closer together than this are treated as one ad break. */
export const POD_GAP = 20;

/** Sorts and merges ranges that overlap or sit within `gap` seconds. */
export function mergeRanges(ranges: AdRange[], gap = POD_GAP): AdRange[] {
  const merged: AdRange[] = [];
  for (const range of [...ranges].sort((a, b) => a.start - b.start)) {
    const last = merged.at(-1);
    if (last && range.start - last.end <= gap) {
      last.end = Math.max(last.end, range.end);
      last.confidence = Math.max(last.confidence, range.confidence);
      if (!last.reason.includes(range.reason)) {
        last.reason = [last.reason, range.reason].filter(Boolean).join("; ");
      }
    } else {
      merged.push({ ...range });
    }
  }
  return merged;
}

/**
 * Stretches each range's end over the quiet gap before the next line of
 * speech, so a skip lands where the show resumes rather than a beat early.
 */
export function snapToSpeech(ranges: AdRange[], segments: TranscriptSegment[], maxGap = 4): AdRange[] {
  const starts = segments.map((s) => s.start).sort((a, b) => a - b);
  return ranges.map((range) => {
    const next = starts.find((t) => t >= range.end - 0.01);
    return next !== undefined && next - range.end <= maxGap
      ? { ...range, end: Math.round(next * 100) / 100 }
      : range;
  });
}
