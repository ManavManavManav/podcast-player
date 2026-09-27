import { windowStartFor } from "@/lib/analysis";
import type { TranscriptSegment } from "@/lib/types";

/** A pause this long after a line still shows that line; longer, and nothing is "being said". */
const PAUSE_SECONDS = 4;

/** Index of the last line starting at or before `time` (lines are sorted), or -1. */
export function lastStartedBy(segments: TranscriptSegment[], time: number): number {
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

/**
 * The line being spoken at `time`, or -1. Only a line that contains the
 * playhead counts, or one that ended moments ago in a pause of transcribed
 * audio: after a jump to a part that hasn't been transcribed yet there's no
 * current line, rather than a stale one from before the jump.
 *
 * `transcribed(window)` says whether the window starting at `window` has been
 * transcribed (so a gap there is a pause, not missing text).
 */
export function currentLine(
  segments: TranscriptSegment[],
  time: number,
  transcribed: (window: number) => boolean = () => false,
): number {
  const index = lastStartedBy(segments, time);
  if (index < 0) return -1;
  const line = segments[index];
  if (time < line.end) return index;
  const pause = time - line.end;
  return pause <= PAUSE_SECONDS && transcribed(windowStartFor(time)) ? index : -1;
}
