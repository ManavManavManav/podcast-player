import { describe, expect, it } from "vitest";
import { createSignal, rawAt, type SignalInput } from "@/lib/field/signal";

/** An envelope of `frames` frames, every frame [level, low, high]. */
function envelope(frames: number, level: number, low = level, high = level): Uint8Array {
  const bytes = new Uint8Array(frames * 3);
  for (let f = 0; f < frames; f++) bytes.set([level, low, high], f * 3);
  return bytes;
}

const base: SignalInput = { time: 0, playing: true, envelopes: {}, segments: [], ads: [] };

describe("rawAt", () => {
  it("reads the window's envelope at the playhead", () => {
    const env = envelope(6000, 100);
    env.set([220, 220, 100], 200 * 3); // frame 200 = 10 s into the window
    const raw = rawAt({ ...base, time: 310, envelopes: { 300: env } });
    expect(raw.source).toBe("envelope");
    expect(raw.level).toBe(1);
    expect(raw.high).toBe(0);
    expect(raw.speaking).toBe(true);
  });

  it("interpolates between frames", () => {
    const env = envelope(4, 100);
    env.set([160, 160, 160], 3); // frame 1
    expect(rawAt({ ...base, time: 0.025, envelopes: { 0: env } }).level).toBeCloseTo(0.25, 5);
  });

  it("reads quiet as silence", () => {
    const raw = rawAt({ ...base, time: 1, envelopes: { 0: envelope(6000, 60) } });
    expect(raw.level).toBe(0);
    expect(raw.speaking).toBe(false);
  });

  it("falls back to the transcript: speaking inside a line, a pause between lines", () => {
    const segments = [
      { start: 0, end: 4, text: "one two three four five six seven eight" },
      { start: 6, end: 9, text: "and more" },
    ];
    const speaking = rawAt({ ...base, time: 2.1, segments });
    expect(speaking).toMatchObject({ source: "transcript", speaking: true });
    expect(speaking.level).toBeGreaterThan(0.3);
    expect(rawAt({ ...base, time: 5, segments })).toMatchObject({ source: "transcript", speaking: false });
  });

  it("breathes slowly with nothing to go on", () => {
    const idle = rawAt({ ...base, time: 1000 });
    expect(idle.source).toBe("idle");
    expect(idle.level).toBeGreaterThan(0.05);
    expect(idle.level).toBeLessThan(0.2);
  });
});

describe("createSignal", () => {
  const loud = { 0: envelope(6000, 220) };
  const quiet = { 0: envelope(6000, 60) };
  const run = (signal: ReturnType<typeof createSignal>, input: SignalInput, seconds: number) => {
    let out = signal.step(input, 1 / 60);
    for (let t = 1 / 60; t < seconds; t += 1 / 60) out = signal.step(input, 1 / 60);
    return out;
  };

  it("wakes over about a second when playback starts", () => {
    const signal = createSignal();
    expect(signal.step({ ...base, envelopes: loud }, 1 / 60).rest).toBeGreaterThan(0.9);
    expect(run(signal, { ...base, envelopes: loud }, 1.5).rest).toBeLessThan(0.1);
  });

  it("rises fast and falls slowly", () => {
    const signal = createSignal();
    run(signal, { ...base, envelopes: quiet }, 3); // awake
    expect(run(signal, { ...base, envelopes: loud }, 0.1).level).toBeGreaterThan(0.9);
    const falling = run(signal, { ...base, envelopes: quiet }, 0.1);
    expect(falling.level).toBeGreaterThan(0.5);
    expect(run(signal, { ...base, envelopes: quiet }, 1.5).level).toBeLessThan(0.05);
  });

  it("fires an onset when the level jumps, then lets it decay", () => {
    const signal = createSignal();
    run(signal, { ...base, envelopes: quiet }, 1);
    const jump = signal.step({ ...base, envelopes: loud }, 1 / 60);
    expect(jump.onset).toBeGreaterThan(0.9);
    expect(run(signal, { ...base, envelopes: loud }, 1).onset).toBeLessThan(0.01);
  });

  it("settles to a quarter when paused, never quite still", () => {
    const signal = createSignal();
    run(signal, { ...base, envelopes: loud }, 1);
    const paused = run(signal, { ...base, envelopes: loud, playing: false }, 3);
    expect(paused.rest).toBeGreaterThan(0.99);
    expect(paused.level).toBeGreaterThan(0.2);
    expect(paused.level).toBeLessThan(0.3);
    expect(paused.onset).toBeLessThan(0.001);
  });

  it("knows when it's in an ad", () => {
    const signal = createSignal();
    const ads = [{ start: 20, end: 50, confidence: 1, reason: "Ad" }];
    expect(signal.step({ ...base, time: 30, ads }, 1 / 60).inAd).toBe(true);
    expect(signal.step({ ...base, time: 50, ads }, 1 / 60).inAd).toBe(false);
  });
});
