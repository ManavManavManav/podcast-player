/**
 * Field studies: full-window drawings that move with an episode's sound.
 *
 * Each is one clear idea carried across the whole window, moving smoothly
 * and deterministically: nothing follows the pointer, nothing appears at
 * random. The sound decides how much, never where.
 *
 * - Filings:      short strokes along broad, slow waves; each new phrase sends
 *                 a gust across the page that turns them as it passes.
 * - Growth:       tree rings. While someone speaks, rings leave the centre at
 *                 a steady speed, each as heavy as the voice was loud, so the
 *                 window holds the last few seconds; pauses are gaps.
 * - Ledger:       columns of dashes rising at a steady pace, each as heavy as
 *                 the speech; a pause starts the next column.
 * - Pendulums:    a pendulum wave: each has a slightly different period, so
 *                 together they drift through travelling waves and realign.
 *                 The voice gives them energy.
 * - Moiré:        two families of fine concentric circles; the voice pulls
 *                 their centres apart and interference fringes flow.
 * - Harmonograph: the curve a pair of damped pendulums trace, slowly changing
 *                 shape and swelling with the voice.
 *
 * `step` advances a study; `draw` strokes it in the given ink. `build`
 * (0–1) is how far it has come in, for transitions between studies.
 */

import { random } from "@/lib/field/grain";
import type { Signal } from "@/lib/field/signal";

export const STUDIES = ["filings", "growth", "ledger", "pendulums", "moire", "harmonograph"] as const;
export type StudyKind = (typeof STUDIES)[number];

export const STUDY_NAMES: Record<StudyKind, string> = {
  filings: "Filings",
  growth: "Growth",
  ledger: "Ledger",
  pendulums: "Pendulums",
  moire: "Moiré",
  harmonograph: "Harmonograph",
};

export interface StudyFrame {
  /** Seconds, continuous. */
  t: number;
  dt: number;
  signal: Signal;
  width: number;
  height: number;
  /** 0.5–1.5: the strength setting. */
  intensity: number;
  /** 0–1: how far the study has come in. */
  build: number;
}

export interface StudyStyle {
  ink: string;
  alpha: number;
  /** Stroke weight scale: about 1 faint behind a page, 2–3 bold on the Stage. */
  weight: number;
}

export interface Study {
  kind: StudyKind;
  step(frame: StudyFrame): void;
  draw(ctx: CanvasRenderingContext2D, style: StudyStyle, frame: StudyFrame): void;
}

/** The study for a show, from its seed. */
export function studyFor(seed: number): StudyKind {
  return STUDIES[seed % STUDIES.length];
}

/** `bold` is the Stage: larger, heavier marks. */
export function createStudy(kind: StudyKind, seed: number, width: number, height: number, bold = false): Study {
  switch (kind) {
    case "filings":
      return filings(seed, width, height, bold);
    case "growth":
      return growth(width, height, bold);
    case "ledger":
      return ledger(width, height, bold);
    case "pendulums":
      return pendulums(width, height);
    case "moire":
      return moire(seed, width, height, bold);
    case "harmonograph":
      return harmonograph(seed, width, height);
  }
}

const ease = (value: number, target: number, tau: number, dt: number) => value + (target - value) * (1 - Math.exp(-dt / tau));
const clamp01 = (x: number) => Math.min(1, Math.max(0, x));
const smooth = (x: number) => {
  const c = clamp01(x);
  return c * c * (3 - 2 * c);
};

/** True on the frame an onset arrives. */
function onsets() {
  let armed = true;
  return (onset: number) => {
    if (onset > 0.95 && armed) {
      armed = false;
      return true;
    }
    if (onset < 0.5) armed = true;
    return false;
  };
}

// --- Filings ---------------------------------------------------------------------------

function filings(seed: number, width: number, height: number, bold: boolean): Study {
  const rand = random(seed ^ 0xf11e);
  const spacing = bold ? (width < 768 ? 30 : 38) : width < 768 ? 30 : 32;
  const cols = Math.ceil(width / spacing) + 1;
  const rows = Math.ceil(height / spacing) + 1;
  // Two broad waves across the window, drifting slowly.
  const w1 = { fx: 0.5 + rand() * 0.7, fy: 0.3 + rand() * 0.6, speed: 0.08 + rand() * 0.06, phase: rand() * 6.28 };
  const w2 = { fx: 0.3 + rand() * 0.6, fy: 0.5 + rand() * 0.7, speed: 0.05 + rand() * 0.05, phase: rand() * 6.28 };
  const base = rand() * Math.PI;
  const GUST_SPEED = Math.max(500, width * 0.6); // px/s
  const GUST_WIDTH = 140;
  const gusts: Array<{ born: number; fromLeft: boolean }> = [];
  let fromLeft = rand() < 0.5;
  let level = 0;
  let low = 0;
  const onset = onsets();
  const segments = new Float32Array(cols * rows * 4);
  let count = 0;

  return {
    kind: "filings",
    step({ t, dt, signal, build }) {
      level = ease(level, signal.level, 0.08, dt);
      low = ease(low, signal.low, 0.15, dt);
      if (onset(signal.onset)) {
        gusts.push({ born: t, fromLeft });
        fromLeft = !fromLeft; // the next gust comes from the other side
      }
      while (gusts.length && (t - gusts[0].born) * GUST_SPEED > width + GUST_WIDTH * 4) gusts.shift();

      const length = spacing * (0.2 + 0.62 * level);
      count = 0;
      for (let j = 0; j < rows; j++) {
        const y = j * spacing;
        const offset = j % 2 ? spacing / 2 : 0;
        for (let i = 0; i < cols; i++) {
          const x = i * spacing + offset - spacing / 2;
          const u = x / width;
          const v = y / height;
          // Build in from the left, a column at a time.
          const shown = smooth((build * 1.3 - u) * 4);
          if (shown <= 0) continue;
          let angle =
            base +
            0.9 * Math.sin(Math.PI * 2 * (w1.fx * u + w1.fy * v) + w1.speed * t + w1.phase) +
            0.5 * Math.sin(Math.PI * 2 * (w2.fx * u - w2.fy * v) - w2.speed * t + w2.phase);
          let l = length;
          for (const gust of gusts) {
            const front = (t - gust.born) * GUST_SPEED - GUST_WIDTH;
            const d = (gust.fromLeft ? x : width - x) - front;
            const pulse = Math.exp(-(d * d) / (GUST_WIDTH * GUST_WIDTH));
            angle += pulse * Math.PI * 0.5;
            l += pulse * spacing * 0.3;
          }
          l = Math.min(l, spacing * 1.1) * shown;
          const cx = (Math.cos(angle) * l) / 2;
          const cy = (Math.sin(angle) * l) / 2;
          segments[count++] = x - cx;
          segments[count++] = y - cy;
          segments[count++] = x + cx;
          segments[count++] = y + cy;
        }
      }
    },
    draw(ctx, style, { intensity }) {
      ctx.globalAlpha = style.alpha;
      ctx.strokeStyle = style.ink;
      ctx.lineCap = "round";
      ctx.lineWidth = Math.min(spacing * 0.18, style.weight * (0.9 + low * 1.2 * intensity));
      ctx.beginPath();
      for (let k = 0; k < count; k += 4) {
        ctx.moveTo(segments[k], segments[k + 1]);
        ctx.lineTo(segments[k + 2], segments[k + 3]);
      }
      ctx.stroke();
    },
  };
}

// --- Growth ----------------------------------------------------------------------------

function growth(width: number, height: number, bold: boolean): Study {
  const cx = width / 2;
  const cy = height / 2;
  const reach = Math.hypot(width, height) / 2;
  const speed = Math.min(width, height) / 11; // px/s: about six seconds to the edge
  const EVERY = 0.24;
  const rings: Array<{ born: number; loud: number }> = [];
  let since = EVERY;
  const onset = onsets();
  const gap = speed * EVERY;

  return {
    kind: "growth",
    step({ t, dt, signal }) {
      since += dt;
      const fresh = onset(signal.onset);
      if ((signal.speaking && since >= EVERY) || fresh) {
        rings.push({ born: t, loud: Math.max(signal.level, fresh ? 0.6 : 0) });
        since = 0;
      }
      while (rings.length && (t - rings[0].born) * speed > reach) rings.shift();
    },
    draw(ctx, style, { t, build }) {
      ctx.strokeStyle = style.ink;
      for (const ring of rings) {
        const r = (t - ring.born) * speed;
        if (r > reach * build + 1) continue;
        // Heavier the louder the moment was; never so heavy that neighbours merge.
        const weight = Math.min(gap * (bold ? 0.55 : 0.4), style.weight * (0.4 + ring.loud ** 1.6 * (bold ? 5 : 3)));
        ctx.globalAlpha = style.alpha * (1 - smooth((r / reach - 0.75) * 4));
        ctx.lineWidth = weight;
        ctx.beginPath();
        ctx.arc(cx, cy, Math.max(0.5, r), 0, Math.PI * 2);
        ctx.stroke();
      }
    },
  };
}

// --- Ledger ----------------------------------------------------------------------------

function ledger(width: number, height: number, bold: boolean): Study {
  const columns = width < 768 ? 4 : 7;
  // Inset from the edges, where the Stage keeps the show's name and the title.
  const left = width * 0.1;
  const gap = (width * 0.82) / columns;
  const dashWidth = gap * 0.42;
  const RISE = 70; // px/s: steady, so spacing reads as time
  const EVERY = 0.12;
  const cols: Array<Array<{ born: number; loud: number }>> = Array.from({ length: columns }, () => []);
  let active = 0;
  let since = EVERY;
  let silence = 0;

  return {
    kind: "ledger",
    step({ t, dt, signal }) {
      if (signal.speaking) {
        if (silence > 1.2) active = (active + 1) % columns; // a new paragraph
        silence = 0;
      } else silence += dt;
      since += dt;
      if (since >= EVERY && signal.level > 0.06 && signal.rest < 0.5) {
        cols[active].push({ born: t, loud: signal.level });
        since = 0;
      }
      for (const col of cols) while (col.length && (t - col[0].born) * RISE > height + 20) col.shift();
    },
    draw(ctx, style, { t, build }) {
      ctx.globalAlpha = style.alpha;
      ctx.strokeStyle = style.ink;
      ctx.lineCap = "butt";
      const maxWeight = RISE * EVERY * 0.85;
      for (let c = 0; c < columns; c++) {
        const x = left + gap * c + (gap - dashWidth) / 2;
        const shown = smooth((build * 1.4 - c / columns) * 3);
        for (const dash of cols[c]) {
          const y = height + 10 - (t - dash.born) * RISE;
          ctx.lineWidth = Math.min(maxWeight, style.weight * (0.4 + dash.loud ** 1.6 * (bold ? 5 : 2.5)));
          ctx.beginPath();
          ctx.moveTo(x, y);
          ctx.lineTo(x + dashWidth * shown, y);
          ctx.stroke();
        }
      }
    },
  };
}

// --- Pendulums -------------------------------------------------------------------------

function pendulums(width: number, height: number): Study {
  const count = width < 768 ? 13 : 21;
  const margin = width * 0.1;
  const step = (width - margin * 2) / (count - 1);
  const top = height * 0.12;
  const length = height * 0.62;
  // All realign every CYCLE seconds of swing time: pendulum i makes (BASE + i) swings per cycle.
  const CYCLE = 60;
  const BASE = 36;
  let swing = 0; // swing time: runs faster while someone speaks
  let amplitude = 0.08;
  let level = 0;
  let low = 0;
  const onset = onsets();

  return {
    kind: "pendulums",
    step({ dt, signal }) {
      level = ease(level, signal.level, 0.1, dt);
      low = ease(low, signal.low, 0.2, dt);
      swing += dt * (0.7 + 0.6 * level);
      amplitude = ease(amplitude, 0.1 + 0.5 * level, 0.8, dt);
      if (onset(signal.onset)) amplitude = Math.min(0.75, amplitude + 0.08);
    },
    draw(ctx, style, { build }) {
      const drop = smooth(build * 1.2);
      ctx.globalAlpha = style.alpha;
      ctx.strokeStyle = style.ink;
      ctx.fillStyle = style.ink;
      ctx.lineCap = "round";
      ctx.lineWidth = style.weight * 0.8;
      ctx.beginPath();
      ctx.moveTo(margin - step / 2, top);
      ctx.lineTo(width - margin + step / 2, top);
      ctx.stroke();
      ctx.lineWidth = style.weight * (1.2 + low * 2.5);
      for (let i = 0; i < count; i++) {
        const x = margin + i * step;
        const angle = amplitude * Math.sin((Math.PI * 2 * (BASE + i) * swing) / CYCLE);
        const l = length * drop;
        const bx = x + Math.sin(angle) * l;
        const by = top + Math.cos(angle) * l;
        ctx.beginPath();
        ctx.moveTo(x, top);
        ctx.lineTo(bx, by);
        ctx.stroke();
        ctx.beginPath();
        ctx.arc(bx, by, style.weight * (3 + level * 5), 0, Math.PI * 2);
        ctx.fill();
      }
    },
  };
}

// --- Moiré -----------------------------------------------------------------------------

function moire(seed: number, width: number, height: number, bold: boolean): Study {
  const rand = random(seed ^ 0x3017);
  const spacing = bold ? 10 : 14;
  const reach = Math.hypot(width, height) * 0.6;
  let axis = rand() * Math.PI;
  const turn = (rand() < 0.5 ? -1 : 1) * (0.03 + rand() * 0.03);
  let apart = 20;

  return {
    kind: "moire",
    step({ dt, signal }) {
      axis += turn * dt;
      apart = ease(apart, 16 + signal.level * 150 + signal.low * 40, 0.25, dt);
    },
    draw(ctx, style, { build }) {
      const cx = width / 2;
      const cy = height / 2;
      const dx = (Math.cos(axis) * apart) / 2;
      const dy = (Math.sin(axis) * apart) / 2;
      const r = reach * smooth(build);
      ctx.globalAlpha = style.alpha;
      ctx.strokeStyle = style.ink;
      // Hairlines: interference needs fine lines, whatever the weight.
      ctx.lineWidth = Math.min(1.25, 0.5 + style.weight * 0.2);
      for (const [x, y] of [
        [cx - dx, cy - dy],
        [cx + dx, cy + dy],
      ]) {
        ctx.beginPath();
        for (let ring = spacing; ring < r; ring += spacing) {
          ctx.moveTo(x + ring, y);
          ctx.arc(x, y, ring, 0, Math.PI * 2);
        }
        ctx.stroke();
      }
    },
  };
}

// --- Harmonograph ----------------------------------------------------------------------

function harmonograph(seed: number, width: number, height: number): Study {
  const rand = random(seed ^ 0x4a4d);
  // Near-simple ratios, slightly detuned: the figure slowly turns inside out.
  const ratios = [
    [2, 3],
    [3, 4],
    [1, 2],
    [2, 5],
  ][Math.floor(rand() * 4)];
  const phases = [rand() * 6.28, rand() * 6.28, rand() * 6.28, rand() * 6.28];
  const POINTS = 1400;
  const TURNS = 60;
  const DAMP = 0.018;
  const points = new Float32Array(POINTS * 2);
  let detune = 0;
  let size = 0.5;
  let low = 0;

  return {
    kind: "harmonograph",
    step({ t, dt, signal }) {
      detune = 0.006 * Math.sin(t * 0.02) + 0.004;
      size = ease(size, 0.55 + 0.45 * signal.level, 0.2, dt);
      low = ease(low, signal.low, 0.2, dt);
      const scale = Math.min(width, height) * 0.46 * size;
      const [a, b] = ratios;
      const drift = t * 0.05;
      for (let k = 0; k < POINTS; k++) {
        const s = (k / POINTS) * TURNS;
        const decay = Math.exp(-DAMP * s);
        points[k * 2] =
          width / 2 + scale * decay * (0.6 * Math.sin(a * s + phases[0] + drift) + 0.4 * Math.sin((b + detune) * s + phases[1]));
        points[k * 2 + 1] =
          height / 2 + scale * decay * (0.6 * Math.sin(b * s + phases[2]) + 0.4 * Math.sin((a + detune) * s + phases[3] - drift));
      }
    },
    draw(ctx, style, { build }) {
      const shown = Math.max(2, Math.floor(POINTS * smooth(build)));
      ctx.globalAlpha = style.alpha;
      ctx.strokeStyle = style.ink;
      ctx.lineWidth = style.weight * (0.55 + low * 0.9);
      ctx.lineJoin = "round";
      ctx.beginPath();
      ctx.moveTo(points[0], points[1]);
      for (let k = 1; k < shown; k++) ctx.lineTo(points[k * 2], points[k * 2 + 1]);
      ctx.stroke();
    },
  };
}
