"use client";

import { LogOut, Settings } from "lucide-react";
import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { authClient } from "@/lib/authClient";
import { usePlayer } from "@/store/player";

export function UserMenu({ name, email, image }: { name: string; email: string; image: string | null }) {
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const close = (e: Event) => {
      if (e instanceof KeyboardEvent ? e.key === "Escape" : !root.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("pointerdown", close);
    document.addEventListener("keydown", close);
    return () => {
      document.removeEventListener("pointerdown", close);
      document.removeEventListener("keydown", close);
    };
  }, [open]);

  const signOut = async () => {
    usePlayer.getState().stop();
    await authClient.signOut();
    // A full page load, so nothing from this user's session stays in memory.
    // eslint-disable-next-line @next/next/no-location-assign-relative-destination
    window.location.assign("/login");
  };

  const initial = (name || email).trim().charAt(0).toUpperCase() || "?";
  return (
    <div ref={root} className="relative shrink-0">
      <button
        onClick={() => setOpen((o) => !o)}
        aria-label="Account menu"
        aria-expanded={open}
        className="hover-breathe grid size-9 place-items-center overflow-hidden rounded-full bg-accent-soft text-sm font-semibold text-accent"
      >
        {image ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={image} alt="" className="size-full object-cover" referrerPolicy="no-referrer" />
        ) : (
          initial
        )}
      </button>
      {open && (
        <div
          role="menu"
          className="animate-toast-in absolute right-0 top-full z-50 mt-2 w-60 rounded-xl border border-border bg-surface p-1 shadow-card"
        >
          <div className="px-3 py-2">
            <p className="truncate text-sm font-medium">{name}</p>
            <p className="truncate text-xs text-muted">{email}</p>
          </div>
          <div className="my-1 h-px bg-border" />
          <Link
            href="/settings"
            role="menuitem"
            onClick={() => setOpen(false)}
            className="hover-fill flex items-center gap-2.5 rounded-lg px-3 py-2 text-sm"
          >
            <Settings className="size-4 text-muted" /> Settings &amp; API keys
          </Link>
          <button
            role="menuitem"
            onClick={signOut}
            className="hover-fill flex w-full items-center gap-2.5 rounded-lg px-3 py-2 text-left text-sm"
          >
            <LogOut className="size-4 text-muted" /> Sign out
          </button>
        </div>
      )}
    </div>
  );
}
