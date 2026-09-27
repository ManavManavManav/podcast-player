"use client";

import { useEffect, useId, useRef, useState } from "react";

/** A small click-to-open menu anchored above its trigger. */
export function Popover({
  label,
  trigger,
  children,
  align = "center",
}: {
  label: string;
  trigger: React.ReactNode;
  children: (close: () => void) => React.ReactNode;
  align?: "center" | "end";
}) {
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  const id = useId();

  useEffect(() => {
    if (!open) return;
    const onPointer = (e: PointerEvent) => {
      if (!root.current?.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("pointerdown", onPointer);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("pointerdown", onPointer);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  return (
    <div ref={root} className="relative">
      <button
        onClick={() => setOpen((o) => !o)}
        aria-label={label}
        aria-expanded={open}
        aria-controls={id}
        className={`hover-breathe touch-target relative flex h-8 items-center gap-1 rounded-full px-2.5 text-xs font-medium hover:bg-surface-2 [--hover-scale:1.05] ${
          open ? "bg-surface-2" : ""
        }`}
      >
        {trigger}
      </button>
      {open && (
        <div
          id={id}
          role="menu"
          className={`animate-toast-in absolute bottom-full z-10 mb-2 min-w-36 rounded-xl border border-border bg-surface p-1 shadow-float ${
            align === "end" ? "right-0" : "left-1/2 -translate-x-1/2"
          }`}
        >
          {children(() => setOpen(false))}
        </div>
      )}
    </div>
  );
}

export function MenuItem({
  selected,
  onSelect,
  children,
}: {
  selected?: boolean;
  onSelect: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      role="menuitemradio"
      aria-checked={selected}
      onClick={onSelect}
      className={`hover-fill flex w-full items-center justify-between gap-4 rounded-lg px-3 py-1.5 text-left text-sm ${
        selected ? "font-semibold text-accent" : ""
      }`}
    >
      {children}
    </button>
  );
}
