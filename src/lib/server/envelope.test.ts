import { execFileSync } from "node:child_process";
import { describe, expect, it } from "vitest";
import { ffmpegPath } from "@/lib/server/audio";
import { computeEnvelope, decodeToPcm, envelopeFor } from "@/lib/server/envelope";
import { decodeEnvelope, ENVELOPE_SAMPLE_RATE } from "@/lib/envelope";

const RATE = ENVELOPE_SAMPLE_RATE;

/** `seconds` of a sine at `hz`, amplitude `amp` (full scale = 1), as 16-bit PCM. */
function tone(hz: number, seconds: number, amp = 0.5): Int16Array {
  return Int16Array.from({ length: Math.round(RATE * seconds) }, (_, i) => Math.round(amp * 32767 * Math.sin((2 * Math.PI * hz * i) / RATE)));
}

/** [level, low, high] of frame `f`. */
const frame = (env: Uint8Array, f: number) => [env[f * 3], env[f * 3 + 1], env[f * 3 + 2]];

describe("computeEnvelope", () => {
  it("gives 20 frames a second, three bytes each", () => {
    expect(computeEnvelope(tone(440, 1)).length).toBe(20 * 3);
  });

  it("reads silence as zero", () => {
    expect([...computeEnvelope(new Int16Array(RATE))].every((b) => b === 0)).toBe(true);
  });

  it("puts a half-scale tone near the top of the range (−9 dBFS)", () => {
    const [level] = frame(computeEnvelope(tone(440, 1)), 10);
    // RMS of a 0.5 sine is −9 dBFS: (60 − 9) / 60 × 255 ≈ 217.
    expect(level).toBeGreaterThan(205);
    expect(level).toBeLessThan(225);
  });

  it("is louder for a louder tone", () => {
    const quiet = frame(computeEnvelope(tone(440, 1, 0.05)), 10)[0];
    const loud = frame(computeEnvelope(tone(440, 1, 0.5)), 10)[0];
    expect(loud - quiet).toBeGreaterThan(70); // 20 dB is 85 steps
  });

  it("tells bass from brightness", () => {
    const [, bassLow, bassHigh] = frame(computeEnvelope(tone(80, 1)), 10);
    const [, trebleLow, trebleHigh] = frame(computeEnvelope(tone(5000, 1)), 10);
    expect(bassLow).toBeGreaterThan(bassHigh + 40);
    expect(trebleHigh).toBeGreaterThan(trebleLow + 40);
  });

  it("follows a burst in time", () => {
    const pcm = new Int16Array(RATE);
    pcm.set(tone(440, 0.25), RATE / 2); // 0.5–0.75 s
    const env = computeEnvelope(pcm);
    expect(frame(env, 5)[0]).toBe(0);
    expect(frame(env, 12)[0]).toBeGreaterThan(200);
    expect(frame(env, 18)[0]).toBe(0);
  });
});

describe("decoding a window", () => {
  // The same kind of audio the analyzer extracts: 16 kHz mono FLAC.
  const flac = execFileSync(ffmpegPath, [
    "-v", "error", "-f", "lavfi", "-i", "sine=frequency=440:duration=2", "-ac", "1", "-ar", "16000", "-c:a", "flac", "-f", "flac", "pipe:1",
  ]);

  it("decodes FLAC to mono PCM at the envelope's rate", async () => {
    const pcm = await decodeToPcm(flac);
    expect(pcm.length).toBeGreaterThan(RATE * 1.9);
    expect(pcm.length).toBeLessThan(RATE * 2.1);
  });

  it("round-trips through base64 to the browser's decoder", async () => {
    const encoded = await envelopeFor(flac);
    const bytes = decodeEnvelope(encoded!);
    expect(bytes.length).toBe(40 * 3);
    expect(frame(bytes, 20)[0]).toBeGreaterThan(150);
  });

  it("returns null for audio it can't decode, instead of failing the analysis", async () => {
    expect(await envelopeFor(Buffer.from("not audio"))).toBeNull();
  });
});
