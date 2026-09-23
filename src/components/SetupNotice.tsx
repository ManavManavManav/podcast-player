"use client";

import { TriangleAlert, X } from "lucide-react";
import { useEffect, useState } from "react";
import type { HealthResponse } from "@/lib/types";

/** Explains, once, what's missing when ad detection can't run on this machine. */
export function SetupNotice() {
  const [health, setHealth] = useState<HealthResponse | null>(null);
  const [dismissed, setDismissed] = useState(false);

  useEffect(() => {
    let cancelled = false;
    fetch("/api/health")
      .then((r) => r.json())
      .then((h: HealthResponse) => !cancelled && setHealth(h))
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, []);

  if (!health || dismissed) return null;
  const problems: string[] = [];
  if (!health.podcastIndex) problems.push("Podcast Index API keys are missing from .env.local, so search won't work.");
  if (!health.ffmpeg) problems.push("ffmpeg isn't installed (brew install ffmpeg), so ads can't be detected.");
  if (!health.whisper.ok) problems.push(`Whisper isn't available (${health.whisper.error ?? "unknown error"}), so ads can't be detected.`);
  if (problems.length === 0) return null;

  return (
    <div role="status" className="border-b border-ad/30 bg-ad-soft text-ad-text">
      <div className="mx-auto flex max-w-6xl items-start gap-3 px-4 py-2.5 text-sm sm:px-6">
        <TriangleAlert className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
        <ul className="flex-1 space-y-0.5">
          {problems.map((p) => (
            <li key={p}>{p}</li>
          ))}
        </ul>
        <button onClick={() => setDismissed(true)} className="rounded p-0.5 hover:bg-ad/15" aria-label="Dismiss">
          <X className="size-4" />
        </button>
      </div>
    </div>
  );
}
