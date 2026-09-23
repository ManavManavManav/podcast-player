"use client";

import { useLayoutEffect, useRef, useState } from "react";

/** Long text clamped to a few lines, with a "More" toggle when it overflows. */
export function ExpandableText({ text, lines = 3, className = "" }: { text: string; lines?: number; className?: string }) {
  const [expanded, setExpanded] = useState(false);
  const [overflows, setOverflows] = useState(false);
  const ref = useRef<HTMLParagraphElement>(null);

  useLayoutEffect(() => {
    const el = ref.current;
    if (el && !expanded) setOverflows(el.scrollHeight > el.clientHeight + 1);
  }, [text, expanded]);

  return (
    <div className={className}>
      <p
        ref={ref}
        className="whitespace-pre-line"
        style={expanded ? undefined : { display: "-webkit-box", WebkitLineClamp: lines, WebkitBoxOrient: "vertical", overflow: "hidden" }}
      >
        {text}
      </p>
      {(overflows || expanded) && (
        <button onClick={() => setExpanded((e) => !e)} className="mt-1 text-sm font-medium text-text hover:underline">
          {expanded ? "Less" : "More"}
        </button>
      )}
    </div>
  );
}
