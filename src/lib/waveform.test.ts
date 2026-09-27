import { describe, expect, it } from "vitest";
import { waveformBars } from "@/lib/waveform";

/** A five-minute window's envelope with every frame at `level` (a byte). */
const flat = (level: number) => new Uint8Array(6000 * 3).fill(level);

describe("waveformBars", () => {
  it("leaves unmeasured parts unknown", () => {
    const bars = waveformBars({ 0: flat(220) }, 600, 10);
    expect(bars.slice(0, 5)).toEqual([1, 1, 1, 1, 1]);
    expect(bars.slice(5)).toEqual([null, null, null, null, null]);
  });

  it("averages each bar, so pauses pull it down", () => {
    const env = flat(160); // 0.5 throughout
    env.fill(100, 600 * 3, 900 * 3); // 30–45 s: silence, half of the second bar
    const bars = waveformBars({ 0: env }, 300, 10);
    expect(bars[0]).toBeCloseTo(0.5, 5);
    expect(bars[1]).toBeCloseTo(0.25, 5);
  });

  it("places later windows by their start", () => {
    const bars = waveformBars({ 300: flat(160) }, 600, 4);
    expect(bars).toEqual([null, null, 0.5, 0.5]);
  });

  it("stops at the episode's end, even if the window runs past it", () => {
    const bars = waveformBars({ 0: flat(220) }, 120, 4);
    expect(bars).toEqual([1, 1, 1, 1]);
  });

  it("is empty without a duration", () => {
    expect(waveformBars({ 0: flat(220) }, 0, 4)).toEqual([null, null, null, null]);
  });
});
