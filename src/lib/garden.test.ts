import { describe, expect, it } from "vitest";
import { growthAt, layoutGarden, plantProgress, pointOn, stages } from "@/lib/garden";

describe("growthAt", () => {
  it("maps the episode's length to the whole blossoming", () => {
    expect(growthAt(0, 3600)).toBe(0);
    expect(growthAt(1800, 3600)).toBe(0.5);
    expect(growthAt(3600, 3600)).toBe(1);
    expect(growthAt(600, 1200)).toBe(0.5); // a shorter episode blooms sooner
    expect(growthAt(-5, 3600)).toBe(0);
  });

  it("stays bare when the length isn't known", () => {
    expect(growthAt(600, 0)).toBe(0);
    expect(growthAt(600, Number.NaN)).toBe(0);
  });
});

describe("layoutGarden", () => {
  it("grows the same garden for the same show, and another for another show", () => {
    const a = layoutGarden(7, 1200, 360);
    expect(layoutGarden(7, 1200, 360).plants).toEqual(a.plants);
    expect(layoutGarden(8, 1200, 360).plants).not.toEqual(a.plants);
  });

  it("plants a few along the ground, rooted on it, within the strip", () => {
    const g = layoutGarden(3, 1200, 360);
    expect(g.plants.length).toBeGreaterThanOrEqual(3);
    for (const p of g.plants) {
      expect(p.stem.from.y).toBeCloseTo(g.groundAt(p.stem.from.x), 5);
      expect(p.stem.to.y).toBeGreaterThan(0);
      expect(p.start).toBeGreaterThanOrEqual(0);
      expect(p.end).toBeLessThanOrEqual(1);
      expect(p.end).toBeGreaterThan(p.start);
    }
  });

  it("has fewer plants on a phone", () => {
    expect(layoutGarden(3, 390, 300).plants.length).toBeLessThan(layoutGarden(3, 1440, 360).plants.length);
  });
});

describe("growing", () => {
  const g = layoutGarden(11, 1440, 360);
  const progress = (growth: number) => g.plants.map((p) => plantProgress(p, growth));

  it("is bare landscape at the start and in full bloom at the end", () => {
    expect(progress(0).every((p) => p === 0)).toBe(true);
    expect(progress(1).every((p) => p === 1)).toBe(true);
  });

  it("is part-way at the halfway mark: some plants up, none finished", () => {
    const half = progress(0.5);
    expect(half.some((p) => p > 0)).toBe(true);
    expect(half.some((p) => p < 1)).toBe(true);
  });

  it("only grows as the episode goes on", () => {
    let previous = progress(0);
    for (let growth = 0.05; growth <= 1; growth += 0.05) {
      const now = progress(growth);
      now.forEach((p, i) => expect(p).toBeGreaterThanOrEqual(previous[i]));
      previous = now;
    }
  });

  it("draws the stem, then unfolds leaves, then opens the flower", () => {
    expect(stages(0.3).stem).toBeCloseTo(0.5, 9);
    expect(stages(0.3).bloom).toBe(0);
    expect(stages(0.3).part(0.8)).toBe(0);
    expect(stages(0.9).stem).toBe(1);
    expect(stages(0.9).bloom).toBeCloseTo(0.5, 9);
    expect(stages(1).part(0.8)).toBe(1);
  });
});

describe("pointOn", () => {
  it("runs from the curve's start to its end", () => {
    const c = { from: { x: 0, y: 0 }, c1: { x: 0, y: 10 }, c2: { x: 10, y: 10 }, to: { x: 10, y: 0 } };
    expect(pointOn(c, 0)).toEqual({ x: 0, y: 0 });
    expect(pointOn(c, 1)).toEqual({ x: 10, y: 0 });
  });
});
