/**
 * The player's waveform: the episode's loudness as bars, from the envelopes
 * the analyzer measures (lib/envelope.ts). Only analyzed windows have one, so
 * a bar can be unknown; the player draws those as a dotted baseline.
 */

import { WINDOW_SECONDS } from "@/lib/analysis";
import { ENVELOPE_BANDS, ENVELOPE_FRAME_SECONDS } from "@/lib/envelope";

/** Envelope bytes are dBFS over −60…0; speech sits between about −36 and −8 dBFS. */
const heightOf = (byte: number) => Math.min(1, Math.max(0, (byte - 100) / 120));

/**
 * `count` bars across `duration` seconds: each the average loudness of its
 * slice (so the rhythm of speech and pauses shows), 0–1, or null where
 * nothing in the slice has been measured.
 */
export function waveformBars(envelopes: Record<number, Uint8Array>, duration: number, count: number): Array<number | null> {
  const bars: Array<number | null> = new Array(Math.max(0, count)).fill(null);
  if (!(duration > 0) || count <= 0) return bars;
  const sums = new Float64Array(count);
  const frames = new Uint32Array(count);
  const slice = duration / count;
  for (const [start, envelope] of Object.entries(envelopes)) {
    const window = Number(start);
    const total = envelope.length / ENVELOPE_BANDS;
    for (let f = 0; f < total; f++) {
      const t = window + f * ENVELOPE_FRAME_SECONDS;
      if (t >= duration || t >= window + WINDOW_SECONDS) break;
      const bar = Math.min(count - 1, Math.floor(t / slice));
      sums[bar] += heightOf(envelope[f * ENVELOPE_BANDS]);
      frames[bar]++;
    }
  }
  for (let i = 0; i < count; i++) if (frames[i]) bars[i] = sums[i] / frames[i];
  return bars;
}
