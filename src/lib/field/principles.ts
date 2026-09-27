/**
 * The Field's drawings ("principles"). Each show gets one, picked from its id,
 * so a show always looks like itself:
 *
 * - Grain:  short strokes along a turning flow (lib/field/grain.ts).
 * - Rings:  every new phrase sends a ring out from a centre that drifts
 *           toward the pointer; rings grow faster the further they get.
 * - Ledger: columns of dashes rising up the page, each as heavy as the
 *           speech was loud; a long pause starts a new column, so the page
 *           reads like a written record of the conversation.
 * - Sticks: long bars swaying with the voice's body, joined end to end by
 *           links that flicker on each new phrase.
 *
 * Each keeps its own state; `step` advances it and `draw` strokes it with
 * the given ink, so the same drawing works faintly behind a page and boldly
 * on the Stage.
 */

import { grainStrokes, layoutGrain, liveRipples, random, type GrainLayout, type Pointer, type Ripple } from "@/lib/field/grain";
import type { Signal } from "@/lib/field/signal";

export const PRINCIPLES = ["grain", "rings", "ledger", "sticks"] as const;
export type PrincipleKind = (typeof PRINCIPLES)[number];

export interface Frame {
  /** Field time, seconds (keeps running while paused, for slow drift). */
  t: number;
  dt: number;
  signal: Signal;
  pointer: Pointer;
  width: number;
  height: number;
  /** 0–1.5: the user's strength setting, plus headroom. */
  intensity: number;
}

export interface DrawStyle {
  ink: string;
  /** Overall opacity. */
  alpha: number;
  /** Stroke weight scale: about 1 behind a page, 3 on the Stage. */
  weight: number;
}

export interface Principle {
  kind: PrincipleKind;
  step(frame: Frame): void;
  draw(ctx: CanvasRenderingContext2D, style: DrawStyle, frame: Frame): void;
  /** A tap or click at a point: each principle answers in its own way. */
  poke(x: number, y: number, t: number): void;
}

/** The principle for a show, from its seed. */
export function principleFor(seed: number, override: number | null = null): PrincipleKind {
  const index = override ?? seed % PRINCIPLES.length;
  return PRINCIPLES[((index % PRINCIPLES.length) + PRINCIPLES.length) % PRINCIPLES.length];
}

/** `bold` is the Stage: fewer, heavier marks, so the words in the middle stay readable. */
export function createPrinciple(kind: PrincipleKind, seed: number, width: number, height: number, bold = false): Principle {
  switch (kind) {
    case "grain":
      return createGrain(seed, width, height, bold);
    case "rings":
      return createRings(seed, width, height);
    case "ledger":
      return createLedger(seed, width, height);
    case "sticks":
      return createSticks(seed, width, height);
  }
}

const ease = (value: number, target: number, tau: number, dt: number) => value + (target - value) * (1 - Math.exp(-dt / tau));

/** Fires once per onset: true on the frame the onset crosses the threshold. */
function onsetEdge() {
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

// --- Grain ------------------------------------------------------------------------------

function createGrain(seed: number, width: number, height: number, bold: boolean): Principle {
  const rand = random(seed ^ 0x51ed);
  const spacing = bold ? (width < 768 ? 34 : 40) : width < 768 ? 28 : 24;
  const layout: GrainLayout = layoutGrain(seed, width, height, spacing);
  const buffer = new Float32Array(layout.cols * layout.rows * 4);
  let ripples: Ripple[] = [];
  let count = 0;
  const edge = onsetEdge();

  return {
    kind: "grain",
    step({ t, signal, pointer, intensity }) {
      if (edge(signal.onset)) {
        const fromPointer = pointer.presence > 0.3 && rand() < 0.6;
        ripples.push({
          x: fromPointer ? pointer.x : width * (0.15 + 0.7 * rand()),
          y: fromPointer ? pointer.y : height * (0.15 + 0.7 * rand()),
          born: t,
        });
        if (ripples.length > 6) ripples.shift();
      }
      ripples = liveRipples(ripples, t);
      count = grainStrokes(layout, signal, t, pointer, ripples, buffer, 0.5 + intensity);
    },
    draw(ctx, style, { signal, intensity }) {
      ctx.globalAlpha = style.alpha;
      ctx.strokeStyle = style.ink;
      ctx.lineWidth = Math.min(spacing * 0.22, style.weight * (0.8 + signal.low * 1.2 * intensity));
      ctx.lineCap = "round";
      ctx.beginPath();
      for (let k = 0; k < count; k++) {
        ctx.moveTo(buffer[k * 4], buffer[k * 4 + 1]);
        ctx.lineTo(buffer[k * 4 + 2], buffer[k * 4 + 3]);
      }
      ctx.stroke();
    },
    poke(x, y, t) {
      ripples.push({ x, y, born: t });
    },
  };
}

// --- Rings ------------------------------------------------------------------------------

interface Ring {
  r: number;
  /** How loud the phrase that sent it was: its weight. */
  loud: number;
  x: number;
  y: number;
}

function createRings(seed: number, width: number, height: number): Principle {
  const rand = random(seed ^ 0x2a11);
  const reach = Math.hypot(width, height) * 0.75;
  const growth = 0.35 + rand() * 0.3;
  let rings: Ring[] = [];
  const centre = { x: width / 2, y: height / 2 };
  let sinceRing = 0;
  let pulse = 0;
  const edge = onsetEdge();

  const send = (loud: number, x = centre.x, y = centre.y) => {
    rings.push({ r: 4, loud, x, y });
    if (rings.length > 48) rings.shift();
    sinceRing = 0;
  };

  return {
    kind: "rings",
    step({ dt, signal, pointer }) {
      // The centre drifts toward the pointer, slowly, and home again when it leaves.
      const target = pointer.presence > 0.2 ? pointer : { x: width / 2, y: height / 2 };
      centre.x = ease(centre.x, target.x, 2.5, dt);
      centre.y = ease(centre.y, target.y, 2.5, dt);
      pulse = ease(pulse, signal.level, 0.08, dt);

      sinceRing += dt;
      if (edge(signal.onset)) send(0.4 + 0.6 * signal.level);
      // Steady speech keeps a slow train of rings going between phrases.
      else if (signal.speaking && sinceRing > 0.7) send(0.25 + 0.5 * signal.level);

      for (const ring of rings) ring.r += (ring.r * growth + 30 + 90 * signal.level) * dt;
      rings = rings.filter((ring) => ring.r < reach);
    },
    draw(ctx, style) {
      ctx.globalAlpha = style.alpha;
      ctx.strokeStyle = style.ink;
      ctx.fillStyle = style.ink;
      for (const ring of rings) {
        const fade = 1 - ring.r / reach;
        ctx.lineWidth = style.weight * (0.8 + ring.loud * 5) * (0.35 + 0.65 * fade);
        ctx.beginPath();
        ctx.arc(ring.x, ring.y, ring.r, 0, Math.PI * 2);
        ctx.stroke();
      }
      // The source: a dot that swells with the voice.
      ctx.beginPath();
      ctx.arc(centre.x, centre.y, style.weight * (2 + pulse * 10), 0, Math.PI * 2);
      ctx.fill();
    },
    poke(x, y) {
      rings.push({ r: 4, loud: 0.8, x, y });
    },
  };
}

// --- Ledger -----------------------------------------------------------------------------

interface Dash {
  y: number;
  loud: number;
}

function createLedger(seed: number, width: number, height: number): Principle {
  const rand = random(seed ^ 0x1ed9);
  const columns = Math.max(3, Math.min(9, Math.floor(width / 150)));
  const gap = width / columns;
  const dashWidth = Math.min(90, gap * 0.5);
  const cols: Dash[][] = Array.from({ length: columns }, () => []);
  let active = Math.floor(rand() * columns);
  let sinceDash = 0;
  let silence = 0;
  const every = 0.15 + rand() * 0.05;

  return {
    kind: "ledger",
    step({ dt, signal }) {
      const rise = (60 + 90 * signal.level) * dt;
      for (const col of cols) {
        for (const dash of col) dash.y -= rise;
        while (col.length && col[0].y < -20) col.shift();
      }
      if (signal.speaking) {
        // Back from a long pause: move on to the next column, like a new paragraph.
        if (silence > 1.4) active = (active + 1 + Math.floor(rand() * (columns - 1))) % columns;
        silence = 0;
      } else silence += dt;

      sinceDash += dt;
      if (sinceDash >= every && signal.level > 0.08 && signal.rest < 0.5) {
        sinceDash = 0;
        cols[active].push({ y: height + 10, loud: signal.level });
      }
    },
    draw(ctx, style) {
      ctx.globalAlpha = style.alpha;
      ctx.strokeStyle = style.ink;
      ctx.lineCap = "butt";
      for (let c = 0; c < columns; c++) {
        const x = gap * c + gap / 2 - dashWidth / 2;
        for (const dash of cols[c]) {
          // Never thicker than the gap between dashes, so a column stays a column of dashes.
          ctx.lineWidth = Math.min(12, style.weight * (0.5 + dash.loud * dash.loud * 3.5));
          ctx.beginPath();
          ctx.moveTo(x, dash.y);
          ctx.lineTo(x + dashWidth, dash.y);
          ctx.stroke();
        }
      }
    },
    poke(x) {
      active = Math.max(0, Math.min(columns - 1, Math.floor(x / gap)));
    },
  };
}

// --- Sticks -----------------------------------------------------------------------------

interface Stick {
  x: number;
  y: number;
  length: number;
  angle: number;
  sway: number;
  speed: number;
  phase: number;
  /** Whether the link from this stick to the next shows. */
  linked: boolean;
}

function createSticks(seed: number, width: number, height: number): Principle {
  const rand = random(seed ^ 0x57c4);
  const count = Math.round(Math.max(10, Math.min(28, (width * height) / 60_000)));
  const unit = Math.min(width, height);
  const sticks: Stick[] = Array.from({ length: count }, () => ({
    x: width * (0.08 + 0.84 * rand()),
    y: height * (0.08 + 0.84 * rand()),
    length: unit * (0.08 + 0.16 * rand()),
    angle: rand() * Math.PI,
    sway: 0.2 + rand() * 0.5,
    speed: 0.3 + rand() * 0.9,
    phase: rand() * Math.PI * 2,
    linked: rand() < 0.5,
  }));
  let body = 0;
  let level = 0;
  const ends = new Float32Array(count * 4);
  const edge = onsetEdge();

  return {
    kind: "sticks",
    step({ t, dt, signal, pointer }) {
      body = ease(body, signal.low, 0.12, dt);
      level = ease(level, signal.level, 0.05, dt);
      // Each new phrase flips some of the links on or off.
      if (edge(signal.onset)) for (const stick of sticks) if (rand() < 0.3) stick.linked = !stick.linked;
      sticks.forEach((s, i) => {
        let angle = s.angle + Math.sin(t * s.speed + s.phase) * s.sway * (0.3 + 1.6 * body);
        if (pointer.presence > 0) {
          // Sticks near the pointer turn to face it.
          const d = Math.hypot(pointer.x - s.x, pointer.y - s.y);
          const pull = pointer.presence * Math.exp(-(d * d) / (unit * unit * 0.08));
          angle += (Math.atan2(pointer.y - s.y, pointer.x - s.x) - angle) * pull * 0.5;
        }
        const half = (s.length * (0.85 + 0.3 * level)) / 2;
        ends[i * 4] = s.x - Math.cos(angle) * half;
        ends[i * 4 + 1] = s.y - Math.sin(angle) * half;
        ends[i * 4 + 2] = s.x + Math.cos(angle) * half;
        ends[i * 4 + 3] = s.y + Math.sin(angle) * half;
      });
    },
    draw(ctx, style) {
      ctx.globalAlpha = style.alpha;
      ctx.strokeStyle = style.ink;
      ctx.lineCap = "butt";
      ctx.lineWidth = style.weight * (1 + level * 7);
      ctx.beginPath();
      for (let i = 0; i < count; i++) {
        ctx.moveTo(ends[i * 4], ends[i * 4 + 1]);
        ctx.lineTo(ends[i * 4 + 2], ends[i * 4 + 3]);
      }
      ctx.stroke();
      ctx.lineWidth = style.weight * 0.6;
      ctx.beginPath();
      for (let i = 0; i < count - 1; i++) {
        if (!sticks[i].linked) continue;
        ctx.moveTo(ends[i * 4 + 2], ends[i * 4 + 3]);
        ctx.lineTo(ends[(i + 1) * 4], ends[(i + 1) * 4 + 1]);
      }
      ctx.stroke();
    },
    poke() {
      for (const stick of sticks) stick.linked = !stick.linked;
    },
  };
}
