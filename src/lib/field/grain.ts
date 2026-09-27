/**
 * Grain: a lattice of short strokes lying along a slowly turning flow, like
 * filings in a field. Louder audio makes them longer, bright audio makes them
 * shiver, onsets send a ripple through them, and they swirl around the
 * pointer.
 *
 * `grainStrokes` is pure: it writes line segments into a buffer, so the
 * renderer only has to stroke them and tests can inspect them.
 */

import type { Signal } from "@/lib/field/signal";

/** A small, fast seeded random generator (mulberry32). */
export function random(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Three drifting waves that make up the flow's direction. */
interface Wave {
  fx: number;
  fy: number;
  speed: number;
  phase: number;
  weight: number;
}

export interface GrainLayout {
  width: number;
  height: number;
  spacing: number;
  cols: number;
  rows: number;
  waves: Wave[];
  /** Radians per second the whole field turns. */
  spin: number;
}

/** A ripple from an onset or a tap. */
export interface Ripple {
  x: number;
  y: number;
  /** Field time (seconds) it started. */
  born: number;
}

export interface Pointer {
  x: number;
  y: number;
  /** 0 when the pointer is away, 1 when it's on the page. */
  presence: number;
}

const RIPPLE_SPEED = 420; // px/s
const RIPPLE_LIFE = 1.6; // s
const RIPPLE_WIDTH = 28; // px

export function layoutGrain(seed: number, width: number, height: number, spacing: number): GrainLayout {
  const rand = random(seed);
  const scale = 1 / Math.max(width, height);
  const waves = Array.from({ length: 3 }, (_, i) => ({
    fx: (1.5 + rand() * 3) * Math.PI * scale * (i + 1),
    fy: (1.5 + rand() * 3) * Math.PI * scale * (i + 1),
    speed: (rand() - 0.5) * 0.3,
    phase: rand() * Math.PI * 2,
    weight: 1.1 / (i + 1),
  }));
  return {
    width,
    height,
    spacing,
    cols: Math.ceil(width / spacing) + 1,
    rows: Math.ceil(height / spacing) + 1,
    waves,
    spin: (rand() - 0.5) * 0.08,
  };
}

/** The flow's direction at a point. */
function flowAngle(layout: GrainLayout, x: number, y: number, t: number): number {
  let angle = layout.spin * t;
  for (const w of layout.waves) angle += w.weight * Math.sin(w.fx * x + w.fy * y + w.speed * t + w.phase);
  return angle;
}

/**
 * Writes one segment per lattice point into `out` (x1, y1, x2, y2 each) and
 * returns how many were written. `out` must hold cols × rows × 4 numbers.
 */
export function grainStrokes(
  layout: GrainLayout,
  signal: Pick<Signal, "level" | "high" | "onset">,
  t: number,
  pointer: Pointer,
  ripples: Ripple[],
  out: Float32Array,
  intensity = 1,
): number {
  const { spacing, cols, rows } = layout;
  const reach = Math.max(120, Math.min(layout.width, layout.height) * 0.22);
  const base = spacing * (0.22 + (0.55 * signal.level + 0.12 * signal.onset) * intensity);
  const shiver = signal.high * 0.45 * intensity;
  let n = 0;
  for (let j = 0; j < rows; j++) {
    // Every other row is offset half a step, so the lattice reads as a field rather than a grid.
    const y = j * spacing;
    const offset = j % 2 ? spacing / 2 : 0;
    for (let i = 0; i < cols; i++) {
      const x = i * spacing + offset - spacing / 2;
      let angle = flowAngle(layout, x, y, t);
      let length = base;

      if (shiver > 0) angle += shiver * Math.sin(i * 12.9898 + j * 78.233 + t * 11);

      if (pointer.presence > 0) {
        const dx = x - pointer.x;
        const dy = y - pointer.y;
        const pull = pointer.presence * Math.exp(-(dx * dx + dy * dy) / (reach * reach));
        if (pull > 0.01) {
          // Turn toward the tangent of a circle around the pointer: a gentle swirl.
          const tangent = Math.atan2(dy, dx) + Math.PI / 2;
          let turn = (tangent - angle) % Math.PI;
          if (turn > Math.PI / 2) turn -= Math.PI;
          if (turn < -Math.PI / 2) turn += Math.PI;
          angle += turn * pull * 0.85;
          length *= 1 + pull * 0.5;
        }
      }

      for (const r of ripples) {
        const age = t - r.born;
        if (age < 0 || age > RIPPLE_LIFE) continue;
        const d = Math.hypot(x - r.x, y - r.y) - age * RIPPLE_SPEED;
        if (Math.abs(d) > RIPPLE_WIDTH * 3) continue;
        const band = Math.exp(-(d * d) / (RIPPLE_WIDTH * RIPPLE_WIDTH)) * (1 - age / RIPPLE_LIFE);
        angle += band * 0.9;
        length += band * spacing * 0.35;
      }

      length = Math.min(length, spacing * 1.15);
      const cx = (Math.cos(angle) * length) / 2;
      const cy = (Math.sin(angle) * length) / 2;
      out[n++] = x - cx;
      out[n++] = y - cy;
      out[n++] = x + cx;
      out[n++] = y + cy;
    }
  }
  return n / 4;
}

/** Drops ripples that have faded. */
export function liveRipples(ripples: Ripple[], t: number): Ripple[] {
  return ripples.filter((r) => t - r.born <= RIPPLE_LIFE);
}
