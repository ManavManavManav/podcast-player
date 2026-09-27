"use client";

import { useEffect, useRef } from "react";
import { startField } from "@/lib/field/renderer";
import { resolveFieldMode, usePlayer } from "@/store/player";

/**
 * The audio-reactive background behind the pages (lib/field): quiet, at low
 * contrast, behind the content. Cards stay opaque, so text is never drawn
 * over. Rests while the Stage is open, which draws its own.
 */
export function Field() {
  const canvas = useRef<HTMLCanvasElement>(null);

  useEffect(
    () =>
      startField(canvas.current!, "page", () => {
        const { episode, field, stageOpen } = usePlayer.getState();
        return Boolean(episode) && !stageOpen && resolveFieldMode(field) === "everywhere";
      }),
    [],
  );

  return <canvas ref={canvas} aria-hidden="true" data-field className="pointer-events-none fixed inset-0 -z-10 size-full" />;
}
