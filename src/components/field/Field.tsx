"use client";

import { useEffect, useRef } from "react";
import { grainStrokes, layoutGrain, liveRipples, random, type GrainLayout, type Pointer, type Ripple } from "@/lib/field/grain";
import { createSignal } from "@/lib/field/signal";
import { useAnalysis } from "@/store/analysis";
import { resolveFieldMode, usePlayback, usePlayer } from "@/store/player";

/**
 * The audio-reactive background: a canvas behind the page that draws the
 * episode's loudness (lib/field). Quiet here, behind the content, at low
 * contrast; cards stay opaque so text is never drawn over.
 *
 * It runs its own animation loop outside React and reads the stores directly,
 * so playback ticks never re-render anything. The loop stops when the tab is
 * hidden, nothing is loaded, or the field is off; with reduced motion it
 * draws a still that changes every ten seconds.
 */

/** Frames at most every 33 ms here (30 fps): it's a background. */
const FRAME_MS = 33;
const STILL_MS = 10_000;
/** After this long without the pointer moving, the drawing wanders on its own. */
const IDLE_MS = 10_000;
const MAX_RIPPLES = 6;

function readColors() {
  const style = getComputedStyle(document.documentElement);
  return {
    ink: style.getPropertyValue("--text").trim() || "#0b0b0b",
    ad: style.getPropertyValue("--ad").trim() || "#d9480f",
  };
}

/** A stable number for a show, so each show's field looks like itself. */
function seedFor(podcastId: number) {
  return Math.imul(podcastId ^ 0x9e3779b9, 0x85ebca6b) >>> 0;
}

const ease = (value: number, target: number, tau: number, dt: number) => value + (target - value) * (1 - Math.exp(-dt / tau));

export function Field() {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current!;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)");
    const darkMode = window.matchMedia("(prefers-color-scheme: dark)");

    const signal = createSignal();
    let colors = readColors();
    let width = 0;
    let height = 0;
    let dpr = 1;
    let layout: GrainLayout | null = null;
    let buffer = new Float32Array(0);
    let seed = -1;
    let rand = random(1);
    let ripples: Ripple[] = [];
    const pointer: Pointer = { x: 0, y: 0, presence: 0 };
    const target = { x: 0, y: 0, presence: 0 };
    let lastMove = -Infinity;
    /** Fades the whole drawing in and out (0–1). */
    let shown = 0;
    let lastFrame = 0;
    let handle: number | null = null;
    let timer: ReturnType<typeof setTimeout> | null = null;
    let lastOnset = 0;

    const wanted = () => {
      const { episode, field } = usePlayer.getState();
      return Boolean(episode) && resolveFieldMode(field) === "everywhere";
    };

    const resize = () => {
      dpr = Math.min(window.devicePixelRatio || 1, window.innerWidth < 768 ? 1.5 : 2);
      width = window.innerWidth;
      height = window.innerHeight;
      canvas.width = Math.round(width * dpr);
      canvas.height = Math.round(height * dpr);
      layout = null;
    };

    const draw = (now: number, dt: number) => {
      const episode = usePlayer.getState().episode;
      const intensity = usePlayer.getState().fieldIntensity;
      const { audio, playing, currentTime } = usePlayback.getState();
      const { envelopes, segments, ads } = useAnalysis.getState();
      const t = now / 1000;

      if (episode && seedFor(episode.podcastId) !== seed) {
        seed = seedFor(episode.podcastId);
        rand = random(seed);
        layout = null;
      }
      if (!layout) {
        layout = layoutGrain(seed, width, height, width < 768 ? 28 : 24);
        buffer = new Float32Array(layout.cols * layout.rows * 4);
      }

      // The media clock is exact when read; timeupdate only fires four times a second.
      const time = audio && !Number.isNaN(audio.currentTime) ? audio.currentTime : currentTime;
      const s = signal.step({ time, playing, envelopes, segments, ads }, dt);

      // Idle: let the "pointer" wander, as if someone were drawing slowly.
      if (now - lastMove > IDLE_MS) {
        target.x = width * (0.5 + 0.32 * Math.sin(t * 0.11));
        target.y = height * (0.5 + 0.3 * Math.sin(t * 0.07 + 1.3));
        target.presence = 0.55;
      }
      pointer.x = ease(pointer.x, target.x, 0.25, dt);
      pointer.y = ease(pointer.y, target.y, 0.25, dt);
      pointer.presence = ease(pointer.presence, target.presence, 0.6, dt);

      // Each new phrase sends a ripple out, from the pointer or somewhere in the field.
      if (s.onset > 0.95 && t - lastOnset > 0.3) {
        lastOnset = t;
        const fromPointer = pointer.presence > 0.3 && rand() < 0.6;
        ripples.push({
          x: fromPointer ? pointer.x : width * (0.15 + 0.7 * rand()),
          y: fromPointer ? pointer.y : height * (0.15 + 0.7 * rand()),
          born: t,
        });
        if (ripples.length > MAX_RIPPLES) ripples.shift();
      }
      ripples = liveRipples(ripples, t);

      const count = grainStrokes(layout, s, t, pointer, ripples, buffer, 0.5 + intensity);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, width, height);
      ctx.globalAlpha = shown * (0.06 + (0.08 + 0.12 * s.level) * (0.4 + intensity));
      ctx.strokeStyle = s.inAd ? colors.ad : colors.ink;
      ctx.lineWidth = 1 + s.low * 1.2 * intensity;
      ctx.lineCap = "round";
      ctx.beginPath();
      for (let k = 0; k < count; k++) {
        ctx.moveTo(buffer[k * 4], buffer[k * 4 + 1]);
        ctx.lineTo(buffer[k * 4 + 2], buffer[k * 4 + 3]);
      }
      ctx.stroke();
    };

    const tick = (now: number) => {
      handle = null;
      if (document.hidden) return;
      const dt = Math.min(0.1, (now - lastFrame) / 1000);
      if (!reducedMotion.matches && now - lastFrame < FRAME_MS) {
        handle = requestAnimationFrame(tick);
        return;
      }
      lastFrame = now;
      const on = wanted();
      shown = reducedMotion.matches ? Number(on) : ease(shown, on ? 1 : 0, 0.4, dt);
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
      lastFrame = performance.now() - FRAME_MS;
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
    // No hover on touch: a tap sends a ripple out instead.
    const onPointerDown = (e: PointerEvent) => {
      if (e.pointerType !== "touch" || !handle) return;
      ripples.push({ x: e.clientX, y: e.clientY, born: performance.now() / 1000 });
    };
    const onColorScheme = () => {
      colors = readColors();
      wake(true);
    };
    const onVisibility = () => wake(true);
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
    document.addEventListener("visibilitychange", onVisibility);
    darkMode.addEventListener("change", onColorScheme);
    reducedMotion.addEventListener("change", onVisibility);
    wake();

    return () => {
      unsubscribe.forEach((u) => u());
      if (handle !== null) cancelAnimationFrame(handle);
      if (timer !== null) clearTimeout(timer);
      window.removeEventListener("resize", onResize);
      window.removeEventListener("pointermove", onPointerMove);
      window.removeEventListener("pointerdown", onPointerDown);
      document.removeEventListener("pointerout", onPointerOut);
      document.removeEventListener("visibilitychange", onVisibility);
      darkMode.removeEventListener("change", onColorScheme);
      reducedMotion.removeEventListener("change", onVisibility);
    };
  }, []);

  return <canvas ref={canvasRef} aria-hidden="true" data-field className="pointer-events-none fixed inset-0 -z-10 size-full" />;
}
