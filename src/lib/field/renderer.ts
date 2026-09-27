/**
 * The Field's animation loop, shared by the quiet background behind the pages
 * and the bold drawing on the Stage. It runs outside React and reads the
 * stores directly, so playback never re-renders anything.
 *
 * The loop sleeps when the tab is hidden or the field isn't wanted, and with
 * reduced motion draws a still that changes every ten seconds.
 */

import { createPrinciple, principleFor, type DrawStyle, type Frame, type Principle } from "@/lib/field/principles";
import { createSignal } from "@/lib/field/signal";
import type { Pointer } from "@/lib/field/grain";
import { useAnalysis } from "@/store/analysis";
import { usePlayback, usePlayer } from "@/store/player";

export type FieldVariant = "page" | "stage";

const STILL_MS = 10_000;
/** After this long without the pointer moving, the drawing wanders on its own. */
const IDLE_MS = 10_000;

const ease = (value: number, target: number, tau: number, dt: number) => value + (target - value) * (1 - Math.exp(-dt / tau));

/** A stable number for a show, so each show's field looks like itself. */
export function seedFor(podcastId: number) {
  return Math.imul(podcastId ^ 0x9e3779b9, 0x85ebca6b) >>> 0;
}

function readColors() {
  const style = getComputedStyle(document.documentElement);
  return {
    ink: style.getPropertyValue("--text").trim() || "#0b0b0b",
    ad: style.getPropertyValue("--ad").trim() || "#d9480f",
  };
}

/**
 * Starts drawing on `canvas` whenever `wanted()` is true. Returns a function
 * that stops it and removes its listeners.
 */
export function startField(canvas: HTMLCanvasElement, variant: FieldVariant, wanted: () => boolean): () => void {
  const ctx = canvas.getContext("2d");
  if (!ctx) return () => {};
  const stage = variant === "stage";
  const frameMs = stage ? 0 : 33; // the background runs at 30 fps, the Stage as fast as it can
  const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)");
  const darkMode = window.matchMedia("(prefers-color-scheme: dark)");

  const signal = createSignal();
  let colors = readColors();
  let width = 0;
  let height = 0;
  let dpr = 1;
  let principle: Principle | null = null;
  let key = "";
  const pointer: Pointer = { x: 0, y: 0, presence: 0 };
  const target = { x: 0, y: 0, presence: 0 };
  let lastMove = -Infinity;
  let shown = 0;
  let lastFrame = 0;
  let handle: number | null = null;
  let timer: ReturnType<typeof setTimeout> | null = null;

  const resize = () => {
    dpr = Math.min(window.devicePixelRatio || 1, window.innerWidth < 768 ? 1.5 : 2);
    width = window.innerWidth;
    height = window.innerHeight;
    canvas.width = Math.round(width * dpr);
    canvas.height = Math.round(height * dpr);
    key = ""; // re-lay the drawing out for the new size
  };

  const draw = (now: number, dt: number) => {
    const { episode, fieldIntensity, fieldStyle } = usePlayer.getState();
    const { audio, playing, currentTime } = usePlayback.getState();
    const { envelopes, segments, ads } = useAnalysis.getState();
    const t = now / 1000;

    const seed = seedFor(episode?.podcastId ?? 0);
    const kind = principleFor(seed, fieldStyle);
    const nextKey = `${kind}:${seed}:${width}x${height}`;
    if (nextKey !== key) {
      key = nextKey;
      principle = createPrinciple(kind, seed, width, height, stage);
    }

    // The media clock is exact when read; timeupdate only fires four times a second.
    const time = audio && !Number.isNaN(audio.currentTime) ? audio.currentTime : currentTime;
    const s = signal.step({ time, playing, envelopes, segments, ads }, dt);

    if (now - lastMove > IDLE_MS) {
      target.x = width * (0.5 + 0.32 * Math.sin(t * 0.11));
      target.y = height * (0.5 + 0.3 * Math.sin(t * 0.07 + 1.3));
      target.presence = 0.55;
    }
    pointer.x = ease(pointer.x, target.x, 0.25, dt);
    pointer.y = ease(pointer.y, target.y, 0.25, dt);
    pointer.presence = ease(pointer.presence, target.presence, 0.6, dt);

    const frame: Frame = { t, dt, signal: s, pointer, width, height, intensity: 0.5 + fieldIntensity };
    principle!.step(frame);
    // For checking the drawing from dev tools and the UI scripts: window.__field.
    if (process.env.NODE_ENV !== "production") Object.assign(window, { [`__field_${variant}`]: { kind: principle!.kind, signal: s, dt, time } });

    let style: DrawStyle;
    if (stage) {
      // White through a difference blend: dark strokes on a light ground, light over the ink
      // text bars, and the same in dark mode. In an ad, plain orange: the one colour.
      canvas.style.mixBlendMode = s.inAd ? "normal" : "difference";
      style = { ink: s.inAd ? colors.ad : "#ffffff", alpha: shown, weight: 1.6 + 1.6 * fieldIntensity };
    } else {
      style = {
        ink: s.inAd ? colors.ad : colors.ink,
        alpha: shown * (0.06 + (0.08 + 0.12 * s.level) * (0.4 + fieldIntensity)),
        weight: 1,
      };
    }
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, width, height);
    principle!.draw(ctx, style, frame);
  };

  const tick = (now: number) => {
    handle = null;
    if (document.hidden) return;
    const dt = Math.min(0.1, (now - lastFrame) / 1000);
    if (!reducedMotion.matches && now - lastFrame < frameMs) {
      handle = requestAnimationFrame(tick);
      return;
    }
    lastFrame = now;
    const on = wanted();
    shown = reducedMotion.matches ? Number(on) : ease(shown, on ? 1 : 0, stage ? 0.25 : 0.4, dt);
    if (!on && shown < 0.01) {
      shown = 0;
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      return; // Asleep until something wakes it.
    }
    draw(now, reducedMotion.matches ? 1 / 30 : dt);
    if (reducedMotion.matches) timer = setTimeout(() => wake(true), STILL_MS);
    else handle = requestAnimationFrame(tick);
  };

  const wake = (force = false) => {
    if (handle !== null || document.hidden) return;
    if (timer !== null && !force) return;
    if (timer !== null) clearTimeout(timer);
    timer = null;
    lastFrame = performance.now() - 33;
    handle = requestAnimationFrame(tick);
  };

  const onPointerMove = (e: PointerEvent) => {
    if (e.pointerType === "touch") return;
    target.x = e.clientX;
    target.y = e.clientY;
    target.presence = 1;
    lastMove = performance.now();
  };
  const onPointerOut = (e: PointerEvent) => {
    if (!e.relatedTarget) target.presence = 0;
  };
  // A tap or click pokes the drawing (a ripple, a ring, a new column…).
  const onPointerDown = (e: PointerEvent) => {
    if (handle === null || !principle) return;
    if (e.pointerType !== "touch" && !stage) return;
    principle.poke(e.clientX, e.clientY, performance.now() / 1000);
  };
  const onColorScheme = () => {
    colors = readColors();
    wake(true);
  };
  const onWake = () => wake(true);
  const onResize = () => {
    resize();
    wake(true);
  };

  resize();
  target.x = pointer.x = width / 2;
  target.y = pointer.y = height / 2;
  const unsubscribe = [
    usePlayer.subscribe(() => wake()),
    usePlayback.subscribe((s, prev) => {
      if (s.playing !== prev.playing || s.source !== prev.source) wake();
    }),
  ];
  window.addEventListener("resize", onResize);
  window.addEventListener("pointermove", onPointerMove, { passive: true });
  window.addEventListener("pointerdown", onPointerDown, { passive: true });
  document.addEventListener("pointerout", onPointerOut);
  document.addEventListener("visibilitychange", onWake);
  darkMode.addEventListener("change", onColorScheme);
  reducedMotion.addEventListener("change", onWake);
  wake();

  return () => {
    unsubscribe.forEach((u) => u());
    if (handle !== null) cancelAnimationFrame(handle);
    if (timer !== null) clearTimeout(timer);
    window.removeEventListener("resize", onResize);
    window.removeEventListener("pointermove", onPointerMove);
    window.removeEventListener("pointerdown", onPointerDown);
    document.removeEventListener("pointerout", onPointerOut);
    document.removeEventListener("visibilitychange", onWake);
    darkMode.removeEventListener("change", onColorScheme);
    reducedMotion.removeEventListener("change", onWake);
  };
}
