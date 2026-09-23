"use client";

import { FastForward } from "lucide-react";
import { useEffect } from "react";
import { formatDuration } from "@/lib/text";
import type { AdRange } from "@/lib/types";

export interface SkipNotice {
  ad: AdRange;
  /** Where playback was when the skip happened. */
  from: number;
  at: number;
}

const VISIBLE_MS = 6000;

export function SkipToast({ notice, onUndo, onDismiss }: { notice: SkipNotice; onUndo: () => void; onDismiss: () => void }) {
  useEffect(() => {
    const timer = setTimeout(onDismiss, VISIBLE_MS);
    return () => clearTimeout(timer);
  }, [notice.at, onDismiss]);

  const skipped = notice.ad.end - notice.from;
  return (
    <div className="mb-2 flex justify-center" role="status" aria-live="polite">
      <div key={notice.at} className="animate-toast-in flex items-center gap-3 rounded-full bg-text py-1.5 pl-3 pr-1.5 text-sm text-bg shadow-card">
        <FastForward className="size-4 fill-current text-ad" aria-hidden="true" />
        <span>
          Skipped a {formatDuration(skipped)} ad
        </span>
        <button onClick={onUndo} className="rounded-full bg-bg/15 px-3 py-1 text-xs font-semibold hover:bg-bg/25">
          Undo
        </button>
      </div>
    </div>
  );
}
