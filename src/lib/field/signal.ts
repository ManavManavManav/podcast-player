/**
 * What the background field listens to: the episode's loudness at the
 * playhead, smoothed so strokes move like a meter rather than a strobe.
 *
 * Sources, best first: the window's loudness envelope (measured on the
 * server); else the transcript (speaking or not, and how fast); else a slow
 * idle breath. Pure apart from the state it carries between frames, so it's
 * testable without a canvas or an audio element.
 */

import { WINDOW_SECONDS, windowStartFor } from "@/lib/analysis";
import { ENVELOPE_BANDS, ENVELOPE_FRAME_SECONDS } from "@/lib/envelope";
import type { AdRange, TranscriptSegment } from "@/lib/types";

export interface SignalInput {
  /** Playhead, seconds. */
  time: number;
  playing: boolean;
  envelopes: Record<number, Uint8Array>;
  segments: TranscriptSegment[];
  ads: AdRange[];
}

export interface Signal {
  /** Overall loudness, 0–1. */
  level: number;
  /** Bass / voice body, 0–1. */
  low: number;
  /** Brightness / sibilance, 0–1. */
  high: number;
  /** A new phrase or stressed syllable: jumps to 1 and decays. */
  onset: number;
  speaking: boolean;
  inAd: boolean;
  /** Eases from 0 to 1 over ~1.5 s after a pause, and back on play. */
  rest: number;
  source: "envelope" | "transcript" | "idle" | "live";
}

/** Loudness at one instant, before smoothing: what a source (envelope, transcript, live audio) provides. */
export interface Raw {
  level: number;
  low: number;
  high: number;
  speaking: boolean;
  source: Signal["source"];
}

/**
 * Envelope bytes are dBFS over −60…0. Speech mostly sits between −36 and
 * −8 dBFS, so that span becomes 0–1; quieter is silence, louder saturates.
 */
const byteToUnit = (b: number) => Math.min(1, Math.max(0, (b - 100) / 120));

/** dBFS → the same 0–1 scale, for sources measured live (−36 dBFS and below is silence, −8 and up is full). */
export const unitFromDb = (db: number) => byteToUnit(((db + 60) / 60) * 255);

/** The segment spoken at `time` (segments are sorted by start). */
function segmentAt(segments: TranscriptSegment[], time: number): TranscriptSegment | undefined {
  let low = 0;
  let high = segments.length - 1;
  while (low <= high) {
    const mid = (low + high) >> 1;
    const s = segments[mid];
    if (time < s.start) high = mid - 1;
    else if (time >= s.end) low = mid + 1;
    else return s;
  }
  return undefined;
}

/** Unsmoothed values at `time`, from the best source available. */
export function rawAt(input: Pick<SignalInput, "time" | "envelopes" | "segments">): Raw {
  const { time, envelopes, segments } = input;
  const window = windowStartFor(time);
  const envelope = envelopes[window];
  if (envelope) {
    const frames = envelope.length / ENVELOPE_BANDS;
    const position = Math.min(frames - 1, Math.max(0, (time - window) / ENVELOPE_FRAME_SECONDS));
    const f = Math.floor(position);
    const next = Math.min(frames - 1, f + 1);
    const mix = position - f;
    const band = (b: number) => byteToUnit(envelope[f * 3 + b] * (1 - mix) + envelope[next * 3 + b] * mix);
    const level = band(0);
    return { level, low: band(1), high: band(2), speaking: level > 0.15, source: "envelope" };
  }
  const segment = segmentAt(segments, time);
  if (segment) {
    // Syllables come at about 1.4 per word; pulse at that rate so speech looks like speech.
    const words = segment.text.split(/\s+/).filter(Boolean).length;
    const rate = Math.max(2, Math.min(7, (words * 1.4) / Math.max(0.5, segment.end - segment.start)));
    const pulse = Math.abs(Math.sin(Math.PI * rate * time));
    const level = 0.35 + 0.35 * pulse;
    return { level, low: level * 0.8, high: 0.2 + 0.3 * pulse, speaking: true, source: "transcript" };
  }
  if (segments.length > 0 && time < segments[segments.length - 1].end + WINDOW_SECONDS) {
    // A gap in a transcribed stretch: a pause in the conversation.
    return { level: 0.04, low: 0.04, high: 0.02, speaking: false, source: "transcript" };
  }
  const breath = 0.12 + 0.06 * Math.sin(time * 0.6);
  return { level: breath, low: breath, high: 0.05, speaking: false, source: "idle" };
}

/** Approach `target` with a time constant of `tau` seconds. */
const ease = (value: number, target: number, tau: number, dt: number) => value + (target - value) * (1 - Math.exp(-dt / tau));

const ATTACK = 0.03;
const RELEASE = 0.25;
/** A rise this far above the recent average counts as an onset, if the level is still climbing. */
const ONSET_RISE = 0.12;
const ONSET_DECAY = 0.15;
/** No two onsets closer than this. */
const ONSET_GAP = 0.12;

/** Carries smoothing between frames. Call `step` once per animation frame. */
export function createSignal() {
  let level = 0;
  let low = 0;
  let high = 0;
  let average = 0;
  let previous = 0;
  let onset = 0;
  let sinceOnset = Infinity;
  let rest = 1;

  const step = (raw: Raw, playing: boolean, inAd: boolean, dt: number): Signal => {
    const follow = (value: number, target: number) => ease(value, target, target > value ? ATTACK : RELEASE, dt);
    level = follow(level, raw.level);
    low = follow(low, raw.low);
    high = follow(high, raw.high);

    sinceOnset += dt;
    onset *= Math.exp(-dt / ONSET_DECAY);
    // Only while climbing: a loud stretch that stays loud is one onset, not one every ONSET_GAP.
    const climbing = raw.level > previous + 0.01;
    if (playing && climbing && raw.level - average > ONSET_RISE && sinceOnset > ONSET_GAP) {
      onset = 1;
      sinceOnset = 0;
    }
    previous = raw.level;
    average = ease(average, raw.level, 0.4, dt);

    rest = ease(rest, playing ? 0 : 1, 0.5, dt);
    // Paused, everything settles to a quarter, never quite still.
    const damp = 1 - 0.75 * rest;
    return {
      level: level * damp,
      low: low * damp,
      high: high * damp,
      onset: onset * damp,
      speaking: raw.speaking && playing,
      inAd,
      rest,
      source: raw.source,
    };
  };

  return {
    /** From the episode: its envelope, else its transcript, else an idle breath. */
    step(input: SignalInput, dt: number): Signal {
      const inAd = input.ads.some((ad) => input.time >= ad.start && input.time < ad.end);
      return step(rawAt(input), input.playing, inAd, dt);
    },
    /** From values measured some other way (live audio in the field lab). */
    stepRaw(raw: Raw, playing: boolean, dt: number): Signal {
      return step(raw, playing, false, dt);
    },
  };
}
