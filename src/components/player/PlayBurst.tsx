"use client";

import { useEffect, useRef } from "react";

/**
 * The "play" flourish, a genie effect: fine sticks pour out of the play
 * button in a narrow stream that flares open and assembles into a scaffold of
 * the player bar (a lattice of short strokes with the odd diagonal brace),
 * which fades in where the sticks land.
 *
 * Each stick heads toward the bar at once but only moves sideways late in its
 * trip, so near the button every stick is squeezed into one neck and the
 * stream widens as it arrives, like a window restoring from the Dock. In
 * flight a stick points the way it's travelling; landing, it swivels into its
 * place in the lattice.
 *
 * The scaffold goes up like a real one: from the ground level upward, posts
 * before the ledgers that tie them together and braces last, with each bay
 * (a few cells wide) run by its own crew at its own pace, so it rises unevenly.
 *
 * Drawn on one full-screen canvas that ignores the pointer; skipped entirely
 * when the user prefers reduced motion.
 */

const EVENT = "podblock:play-burst";
/** Each stick's trip from the button, and the time over which sticks set off (the build). */
const TRIP_MS = 450;
const BUILD_MS = 700;
/** When the scaffold is finished and the bar should appear (ms after the burst). */
export const BAR_REVEAL_MS = BUILD_MS + TRIP_MS + 50;
/** Once the scaffold stands, the bar swaps in quickly: the scaffold is the reveal. */
export const BAR_FADE_MS = 300;
const TOTAL_MS = BAR_REVEAL_MS + BAR_FADE_MS + 100;
/** Lattice cell size, and the gap left at each end of a stick. */
const CELL = 14;
const GAP = 1.5;

let lastBurstAt = 0;
/** Whether a player bar was already on screen when the burst started. */
let barWasShown = false;

/**
 * True right after a burst that brings the player bar in, so the new bar waits
 * for the sticks before appearing. When a bar is already on screen (switching
 * episodes), the sticks rebuild it in place and it never disappears.
 */
export function barShouldMaterialize() {
  return Date.now() - lastBurstAt < 400 && !barWasShown;
}

/** Starts the flourish from the center of `origin` (the play button that was pressed). */
export function playBurst(origin: Element | null) {
  if (!origin || window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
  const rect = origin.getBoundingClientRect();
  lastBurstAt = Date.now();
  barWasShown = document.querySelector("[data-player-bar]") !== null;
  window.dispatchEvent(
    new CustomEvent(EVENT, { detail: { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 } }),
  );
}

const clamp01 = (t: number) => Math.min(1, Math.max(0, t));
const easeInOut = (t: number) => (t < 0.5 ? 4 * t ** 3 : 1 - (-2 * t + 2) ** 3 / 2);
const smoothstep = (t: number) => t * t * (3 - 2 * t);

/** The smallest rotation from `from` to `to`. Sticks have no front, so a half turn is as good as none. */
function shortestTurn(from: number, to: number) {
  let turn = (to - from) % Math.PI;
  if (turn > Math.PI / 2) turn -= Math.PI;
  if (turn < -Math.PI / 2) turn += Math.PI;
  return turn;
}

interface Stick {
  /** Its place in the scaffold: center, angle (radians) and length. */
  tx: number;
  ty: number;
  angle: number;
  length: number;
  /** When it leaves the button (ms after the click). */
  delay: number;
  accent: boolean;
}

/** Where the bar is (or will be): measured if it's on the page, else where it will mount. */
function barRect(): DOMRect {
  const bar = document.querySelector("[data-player-bar]");
  if (bar) return bar.getBoundingClientRect();
  const w = Math.min(window.innerWidth - (window.innerWidth >= 640 ? 32 : 16), 1104);
  const h = window.innerWidth >= 768 ? 92 : 132;
  return new DOMRect((window.innerWidth - w) / 2, window.innerHeight - h - (window.innerWidth >= 640 ? 16 : 8), w, h);
}

interface Member {
  x: number;
  y: number;
  angle: number;
  length: number;
  kind: "post" | "ledger" | "brace";
  /** 0 = ground level (the bar's bottom row of cells). */
  level: number;
  /** Which bay (a run of a few columns) builds it. */
  bay: number;
}

const BAY_CELLS = 4;

/** A scaffold filling a rounded rectangle: posts, the ledgers across them, and the odd diagonal brace. */
function scaffold(rect: DOMRect, radius: number): { members: Member[]; levels: number; bays: number } {
  const inside = (x: number, y: number) => {
    const dx = Math.max(rect.left + radius - x, x - (rect.right - radius), 0);
    const dy = Math.max(rect.top + radius - y, y - (rect.bottom - radius), 0);
    return dx * dx + dy * dy <= radius * radius;
  };
  const cols = Math.max(1, Math.round(rect.width / CELL));
  const rows = Math.max(1, Math.round(rect.height / CELL));
  const w = rect.width / cols;
  const h = rect.height / rows;
  const members: Member[] = [];
  for (let r = 0; r <= rows; r++) {
    for (let c = 0; c <= cols; c++) {
      const x = rect.left + c * w;
      const y = rect.top + r * h;
      const bay = Math.floor(Math.min(c, cols - 1) / BAY_CELLS);
      const cellLevel = rows - 1 - Math.min(r, rows - 1);
      // A ledger along the top of this cell, a post down its left side.
      if (c < cols && inside(x + w / 2, y)) {
        members.push({ x: x + w / 2, y, angle: 0, length: w - GAP * 2, kind: "ledger", level: Math.min(rows - r, rows - 1), bay });
      }
      if (r < rows && inside(x, y + h / 2)) {
        members.push({ x, y: y + h / 2, angle: Math.PI / 2, length: h - GAP * 2, kind: "post", level: cellLevel, bay });
      }
      if (r < rows && c < cols && Math.random() < 0.05 && inside(x + w / 2, y + h / 2)) {
        const angle = (Math.random() < 0.5 ? 1 : -1) * Math.atan2(h, w);
        members.push({ x: x + w / 2, y: y + h / 2, angle, length: Math.hypot(w, h) - GAP * 3, kind: "brace", level: cellLevel, bay });
      }
    }
  }
  return { members, levels: rows, bays: Math.ceil(cols / BAY_CELLS) };
}

/** Where in its level each kind of member goes in, as a fraction of a level's time. */
const STAGE = { post: 0, ledger: 0.45, brace: 0.85 } as const;

function makeSticks(target: DOMRect): Stick[] {
  const { members, levels, bays } = scaffold(target, 24);
  // Each bay's crew starts at its own time and works at its own pace.
  const crews = Array.from({ length: bays }, () => ({ start: Math.random() * 0.25, pace: 0.75 + Math.random() * 0.5 }));
  const raw = members.map((m) => {
    const crew = crews[m.bay];
    return crew.start + ((m.level + STAGE[m.kind]) / levels) * crew.pace + Math.random() * 0.06;
  });
  const last = Math.max(...raw, 1e-6);
  return members.map((m, i) => ({
    tx: m.x,
    ty: m.y,
    angle: m.angle,
    length: m.length,
    delay: (raw[i] / last) * BUILD_MS,
    accent: Math.random() < 0.06,
  }));
}

/**
 * A stick's position `p` (0–1) of the way from the button to its spot. Height
 * follows the eased progress; width lags well behind it (cubed), which pinches
 * the stream into a neck near the button and flares it open at the bar.
 */
function genie(ox: number, oy: number, d: Stick, p: number): [number, number] {
  const along = easeInOut(p);
  const spread = along ** 3;
  return [ox + (d.tx - ox) * spread, oy + (d.ty - oy) * along];
}

export function PlayBurst() {
  const canvas = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    let frame = 0;
    const onBurst = (e: Event) => {
      const el = canvas.current;
      if (!el) return;
      cancelAnimationFrame(frame);
      const { x: ox, y: oy } = (e as CustomEvent<{ x: number; y: number }>).detail;
      const dpr = window.devicePixelRatio || 1;
      el.width = window.innerWidth * dpr;
      el.height = window.innerHeight * dpr;
      const ctx = el.getContext("2d")!;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

      const style = getComputedStyle(document.documentElement);
      const ink = style.getPropertyValue("--text").trim() || "#0b0b0b";
      const ad = style.getPropertyValue("--ad").trim() || "#d9480f";

      const start = performance.now();
      let target = barRect();
      let sticks = makeSticks(target);
      let measured = false;

      const draw = (now: number) => {
        const t = now - start;
        // The bar mounts after the click; once it's on the page, aim for where it really is.
        if (!measured && t > 200) {
          measured = true;
          const rect = barRect();
          if (rect.top !== target.top || rect.left !== target.left || rect.width !== target.width) {
            target = rect;
            const fresh = scaffold(rect, 24).members;
            sticks = sticks.slice(0, fresh.length);
            sticks.forEach((d, i) => {
              ({ x: d.tx, y: d.ty, angle: d.angle, length: d.length } = fresh[i]);
            });
          }
        }

        ctx.clearRect(0, 0, window.innerWidth, window.innerHeight);
        ctx.lineWidth = 1;
        ctx.lineCap = "round";
        for (const d of sticks) {
          const p = clamp01((t - d.delay) / TRIP_MS);
          if (p <= 0) continue;
          const [x, y] = genie(ox, oy, d, p);
          // Point along the path while travelling, then swivel into the lattice on landing.
          const [ax, ay] = genie(ox, oy, d, Math.min(1, p + 0.02));
          const heading = ax === x && ay === y ? d.angle : Math.atan2(ay - y, ax - x);
          const settle = smoothstep(clamp01((p - 0.55) / 0.45));
          const angle = heading + shortestTurn(heading, d.angle) * settle;
          // Streaks stretch a little mid-flight and shrink to their lattice length.
          const length = d.length * (0.6 + 0.4 * settle) + (1 - settle) * 6 * Math.sin(Math.PI * p);

          // Appear as they leave the button; dissolve while the real bar fades in underneath.
          const alpha = clamp01(p * 6) * (1 - clamp01((t - BAR_REVEAL_MS) / BAR_FADE_MS));
          if (alpha <= 0) continue;
          ctx.globalAlpha = alpha * (d.accent ? 0.9 : 0.55);
          ctx.strokeStyle = d.accent ? ad : ink;
          const dx = (Math.cos(angle) * length) / 2;
          const dy = (Math.sin(angle) * length) / 2;
          ctx.beginPath();
          ctx.moveTo(x - dx, y - dy);
          ctx.lineTo(x + dx, y + dy);
          ctx.stroke();
        }
        if (t < TOTAL_MS) frame = requestAnimationFrame(draw);
        else ctx.clearRect(0, 0, window.innerWidth, window.innerHeight);
      };
      frame = requestAnimationFrame(draw);
    };

    window.addEventListener(EVENT, onBurst);
    return () => {
      window.removeEventListener(EVENT, onBurst);
      cancelAnimationFrame(frame);
    };
  }, []);

  return <canvas ref={canvas} aria-hidden="true" className="pointer-events-none fixed inset-0 z-[60] size-full" />;
}
