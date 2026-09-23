"use client";

import { FastForward, LoaderCircle } from "lucide-react";
import { useEffect } from "react";
import { formatDuration } from "@/lib/text";
import type { AdRange } from "@/lib/types";

export interface SkipNotice {
  ad: AdRange;
  /** Seconds skipped so far in this ad break (a long break can take several hops). */
  seconds: number;
  at: number;
}

const VISIBLE_MS = 6000;

export function SkipToast({
  notice,
  holding,
  onUndo,
  onDismiss,
}: {
  notice: SkipNotice;
  /** Still waiting to learn whether the ad break continues. */
  holding: boolean;
  onUndo: () => void;
  onDismiss: () => void;
}) {
  useEffect(() => {
    if (holding) return;
    const timer = setTimeout(onDismiss, VISIBLE_MS);
    return () => clearTimeout(timer);
  }, [notice.at, holding, onDismiss]);

  return (
    <div className="mb-2 flex justify-center" role="status" aria-live="polite">
      <div key={notice.at} className="animate-toast-in flex items-center gap-3 rounded-full bg-text py-1.5 pl-3 pr-1.5 text-sm text-bg shadow-card">
        {holding ? (
          <LoaderCircle className="size-4 animate-spin text-ad" aria-hidden="true" />
        ) : (
          <FastForward className="size-4 fill-current text-ad" aria-hidden="true" />
        )}
        <span>
          {holding ? "Skipping ad break…" : `Skipped a ${formatDuration(notice.seconds)} ad`}
        </span>
        <button onClick={onUndo} className="rounded-full bg-bg/15 px-3 py-1 text-xs font-semibold hover:bg-bg/25">
          Undo
        </button>
      </div>
    </div>
  );
}
