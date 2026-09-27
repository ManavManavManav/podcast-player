"use client";

import { TriangleAlert, X } from "lucide-react";
import { useEffect, useState } from "react";
import type { HealthResponse } from "@/lib/types";

/** Explains, once, what the server is missing. Configuration details are only shown to the admin. */
export function SetupNotice({ isAdmin }: { isAdmin: boolean }) {
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

  if (!health || health.ok || dismissed) return null;
  const problems: string[] = [];
  if (isAdmin) {
    if (!health.podcastIndex) problems.push("PODCAST_INDEX_API_KEY / _SECRET aren't set, so search won't work.");
    if (!health.transcription) problems.push("TRANSCRIBE_API_KEY isn't set, so episodes can't be transcribed.");
    if (!health.detection) problems.push("DETECT_API_KEY isn't set, so ads can't be detected.");
  } else {
    problems.push("This server isn't fully set up yet, so search or ad skipping may not work. Let its owner know.");
  }

  return (
    <div role="status" className="border-b border-ad/30 bg-ad-soft text-ad-text">
      <div className="mx-auto flex max-w-6xl items-start gap-3 px-4 py-2.5 text-sm sm:px-6">
        <TriangleAlert className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
        <ul className="flex-1 space-y-0.5">
          {problems.map((p) => (
            <li key={p}>{p}</li>
          ))}
        </ul>
        <button onClick={() => setDismissed(true)} className="touch-target relative rounded p-0.5 hover:bg-ad/15" aria-label="Dismiss">
          <X className="size-4" />
        </button>
      </div>
    </div>
  );
}
