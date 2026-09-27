"use client";

import { useSyncExternalStore } from "react";
import { resolveFieldMode, usePlayer, type FieldMode } from "@/store/player";

const MODES: Array<{ mode: Exclude<FieldMode, "auto">; label: string; hint: string }> = [
  { mode: "off", label: "Off", hint: "No background drawing." },
  { mode: "stage", label: "Now Playing only", hint: "Only in the full-window player. Saves battery on phones." },
  { mode: "everywhere", label: "Everywhere", hint: "Faintly behind every page while an episode is loaded." },
];

/** Where the audio-reactive background shows, and how strongly. */
export function BackgroundSettings() {
  const field = usePlayer((s) => s.field);
  const intensity = usePlayer((s) => s.fieldIntensity);
  const setField = usePlayer((s) => s.setField);
  const setIntensity = usePlayer((s) => s.setFieldIntensity);
  // "auto" depends on the device, which the server can't know: resolve it after mounting.
  const mounted = useSyncExternalStore(
    () => () => {},
    () => true,
    () => false,
  );
  const current = mounted ? resolveFieldMode(field) : null;

  return (
    <section className="rounded-3xl bg-surface p-6 sm:p-8">
      <h2 className="font-serif text-3xl">Background</h2>
      <p className="mt-2 text-sm text-muted">
        A drawing that moves with the episode&apos;s sound. Press <kbd className="font-mono">V</kbd> to turn it on or off.
      </p>
      <fieldset className="mt-5 grid gap-2">
        <legend className="sr-only">Show the background</legend>
        {MODES.map(({ mode, label, hint }) => (
          <label
            key={mode}
            className={`flex cursor-pointer items-start gap-3 rounded-2xl px-4 py-3 transition-colors ${
              current === mode ? "bg-surface-2" : "hover:bg-surface-2/60"
            }`}
          >
            <input
              type="radio"
              name="field"
              value={mode}
              checked={current === mode}
              onChange={() => setField(mode)}
              className="mt-1 accent-[var(--accent)]"
            />
            <span>
              <span className="block text-sm font-medium">
                {label}
                {field === "auto" && current === mode && <span className="ml-2 text-xs font-normal text-faint">default here</span>}
              </span>
              <span className="block text-xs text-muted">{hint}</span>
            </span>
          </label>
        ))}
      </fieldset>
      <label className="mt-5 grid max-w-sm gap-2 text-sm font-medium">
        Strength
        <input
          type="range"
          min={0}
          max={1}
          step={0.05}
          value={intensity}
          onChange={(e) => setIntensity(Number(e.target.value))}
          disabled={current === "off"}
          className="accent-[var(--accent)] disabled:opacity-40"
        />
      </label>
    </section>
  );
}
