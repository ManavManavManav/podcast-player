import { spawn } from "node:child_process";
import { ffmpegPath } from "@/lib/server/audio";
import { ENVELOPE_FRAME_SECONDS, ENVELOPE_SAMPLE_RATE } from "@/lib/envelope";

/**
 * A loudness envelope of one analysis window, for the audio-reactive
 * background. It's measured here because the browser often can't read a
 * podcast host's audio (no CORS), while the analyzer already has the window
 * decoded.
 *
 * Per 50 ms frame, three bytes: overall level, low band (under ~250 Hz: voice
 * body, music bass) and high band (over ~2 kHz: sibilance, brightness), each
 * as dBFS mapped from −60…0 to 0…255. Base64 in storage and responses; about
 * 24 KB for a five-minute window.
 */

const FLOOR_DB = -60;
const LOW_CUTOFF_HZ = 250;
const HIGH_CUTOFF_HZ = 2000;

/** RMS of a signal (full scale = 1) → 0–255 over −60…0 dBFS. */
function toByte(sumSquares: number, count: number): number {
  if (count === 0 || sumSquares <= 0) return 0;
  const db = 10 * Math.log10(sumSquares / count);
  return Math.round(Math.min(1, Math.max(0, (db - FLOOR_DB) / -FLOOR_DB)) * 255);
}

/** Per-frame level, low and high bands of mono 16-bit PCM, interleaved. */
export function computeEnvelope(pcm: Int16Array, sampleRate = ENVELOPE_SAMPLE_RATE): Uint8Array {
  const frame = Math.round(sampleRate * ENVELOPE_FRAME_SECONDS);
  const frames = Math.ceil(pcm.length / frame);
  const out = new Uint8Array(frames * 3);
  // One-pole filters: cheap, and plenty for "how bassy / how bright" at 20 frames a second.
  const lowK = 1 - Math.exp((-2 * Math.PI * LOW_CUTOFF_HZ) / sampleRate);
  const highK = 1 - Math.exp((-2 * Math.PI * HIGH_CUTOFF_HZ) / sampleRate);
  let low = 0;
  let belowHigh = 0;
  for (let f = 0; f < frames; f++) {
    let all = 0;
    let lows = 0;
    let highs = 0;
    const end = Math.min(pcm.length, (f + 1) * frame);
    for (let i = f * frame; i < end; i++) {
      const x = pcm[i] / 32768;
      low += lowK * (x - low);
      belowHigh += highK * (x - belowHigh);
      const high = x - belowHigh;
      all += x * x;
      lows += low * low;
      highs += high * high;
    }
    const n = end - f * frame;
    out[f * 3] = toByte(all, n);
    out[f * 3 + 1] = toByte(lows, n);
    out[f * 3 + 2] = toByte(highs, n);
  }
  return out;
}

/** Decodes a window's FLAC (as extracted for transcription) to mono 16-bit PCM. */
export function decodeToPcm(flac: Buffer, signal?: AbortSignal): Promise<Int16Array> {
  return new Promise((resolve, reject) => {
    const args = ["-hide_banner", "-loglevel", "error", "-i", "pipe:0", "-ac", "1", "-ar", String(ENVELOPE_SAMPLE_RATE), "-f", "s16le", "pipe:1"];
    // The binary ships via outputFileTracingIncludes (next.config.ts); don't trace the spawn itself.
    const ffmpeg = spawn(/*turbopackIgnore: true*/ ffmpegPath, args, { stdio: ["pipe", "pipe", "pipe"], signal });
    const chunks: Buffer[] = [];
    let stderr = "";
    ffmpeg.stdout.on("data", (chunk: Buffer) => chunks.push(chunk));
    ffmpeg.stderr.on("data", (chunk) => (stderr += chunk));
    ffmpeg.on("error", reject);
    ffmpeg.on("close", (code) => {
      if (code !== 0) return reject(new Error(`ffmpeg couldn't decode the window (exit ${code}): ${stderr.trim()}`));
      const bytes = Buffer.concat(chunks);
      // Copy into an aligned buffer: Buffer.concat may return a view at an odd offset.
      const pcm = new Int16Array(bytes.length >> 1);
      for (let i = 0; i < pcm.length; i++) pcm[i] = bytes.readInt16LE(i * 2);
      resolve(pcm);
    });
    ffmpeg.stdin.on("error", () => {}); // ffmpeg may exit before reading everything; "close" reports it.
    ffmpeg.stdin.end(flac);
  });
}

/** The window's envelope, base64, or null if it couldn't be measured (never fails the analysis). */
export async function envelopeFor(flac: Buffer, signal?: AbortSignal): Promise<string | null> {
  try {
    return Buffer.from(computeEnvelope(await decodeToPcm(flac, signal))).toString("base64");
  } catch {
    return null;
  }
}
