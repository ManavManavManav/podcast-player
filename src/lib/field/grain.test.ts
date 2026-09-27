import { describe, expect, it } from "vitest";
import { grainStrokes, layoutGrain, liveRipples, random, type Pointer } from "@/lib/field/grain";

const quiet = { level: 0, high: 0, onset: 0 };
const loud = { level: 1, high: 0, onset: 0 };
const away: Pointer = { x: 0, y: 0, presence: 0 };

function strokes(seed: number, signal = quiet, t = 1, pointer = away, ripples = [] as { x: number; y: number; born: number }[]) {
  const layout = layoutGrain(seed, 400, 300, 25);
  const out = new Float32Array(layout.cols * layout.rows * 4);
  const count = grainStrokes(layout, signal, t, pointer, ripples, out);
  return { layout, out, count };
}

const lengthOf = (out: Float32Array, k: number) => Math.hypot(out[k * 4 + 2] - out[k * 4], out[k * 4 + 3] - out[k * 4 + 1]);
const angleOf = (out: Float32Array, k: number) => Math.atan2(out[k * 4 + 3] - out[k * 4 + 1], out[k * 4 + 2] - out[k * 4]);
/** Index of the stroke nearest (x, y). */
function nearest(out: Float32Array, count: number, x: number, y: number) {
  let best = 0;
  let bestD = Infinity;
  for (let k = 0; k < count; k++) {
    const d = Math.hypot((out[k * 4] + out[k * 4 + 2]) / 2 - x, (out[k * 4 + 1] + out[k * 4 + 3]) / 2 - y);
    if (d < bestD) [best, bestD] = [k, d];
  }
  return best;
}

describe("random", () => {
  it("repeats for a seed and differs between seeds", () => {
    const a = random(7);
    const b = random(7);
    const c = random(8);
    const first = [a(), a(), a()];
    expect([b(), b(), b()]).toEqual(first);
    expect(c()).not.toBe(first[0]);
    expect(first.every((v) => v >= 0 && v < 1)).toBe(true);
  });
});

describe("grainStrokes", () => {
  it("covers the page with one stroke per lattice point", () => {
    const { layout, count } = strokes(1);
    expect(count).toBe(layout.cols * layout.rows);
    expect(layout.cols * 25).toBeGreaterThanOrEqual(400);
  });

  it("draws the same field for the same show, and a different one for another", () => {
    expect(strokes(42).out).toEqual(strokes(42).out);
    expect(strokes(42).out).not.toEqual(strokes(43).out);
  });

  it("lengthens strokes as the audio gets louder, within the lattice", () => {
    const soft = strokes(1, quiet);
    const hard = strokes(1, loud);
    expect(lengthOf(hard.out, 10)).toBeGreaterThan(lengthOf(soft.out, 10) * 2);
    expect(lengthOf(hard.out, 10)).toBeLessThanOrEqual(25 * 1.15 + 1e-3);
  });

  it("swirls strokes near the pointer and leaves far ones alone", () => {
    const pointer = { x: 360, y: 270, presence: 1 };
    const plain = strokes(1, quiet, 1);
    const swirled = strokes(1, quiet, 1, pointer);
    const near = nearest(plain.out, plain.count, 370, 270);
    const far = nearest(plain.out, plain.count, 5, 5);
    expect(angleOf(swirled.out, near)).not.toBeCloseTo(angleOf(plain.out, near), 2);
    expect(angleOf(swirled.out, far)).toBeCloseTo(angleOf(plain.out, far), 2);
  });

  it("bends strokes where a ripple's front has reached", () => {
    const ripple = { x: 0, y: 0, born: 0.5 };
    // At t = 1 the front is 210 px out.
    const plain = strokes(1, quiet, 1);
    const rippled = strokes(1, quiet, 1, away, [ripple]);
    const onFront = nearest(plain.out, plain.count, 150, 150);
    const inside = nearest(plain.out, plain.count, 25, 25);
    expect(lengthOf(rippled.out, onFront)).toBeGreaterThan(lengthOf(plain.out, onFront));
    expect(lengthOf(rippled.out, inside)).toBeCloseTo(lengthOf(plain.out, inside), 3);
  });

  it("forgets ripples once they fade", () => {
    expect(liveRipples([{ x: 0, y: 0, born: 0 }, { x: 0, y: 0, born: 5 }], 5.5)).toHaveLength(1);
  });
});
