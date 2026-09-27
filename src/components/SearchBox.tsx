"use client";

import { Search, X } from "lucide-react";
import { useRouter, useSearchParams } from "next/navigation";
import { useEffect, useRef, useState } from "react";

export function SearchBox({ size = "md", autoFocus = false }: { size?: "md" | "lg"; autoFocus?: boolean }) {
  const router = useRouter();
  const params = useSearchParams();
  const current = params.get("q") ?? "";
  const [query, setQuery] = useState(current);
  const input = useRef<HTMLInputElement>(null);

  // Follow navigation (back/forward, clicking a link) but not while typing.
  useEffect(() => {
    if (document.activeElement !== input.current) setQuery(current);
  }, [current]);

  // "/" focuses search from anywhere, like most web apps.
  useEffect(() => {
    if (size !== "md") return;
    const onKey = (e: KeyboardEvent) => {
      const target = e.target instanceof Element ? e.target : document.body;
      if (e.key !== "/" || target.closest("input, textarea, [contenteditable]")) return;
      e.preventDefault();
      input.current?.focus();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [size]);

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    const q = query.trim();
    if (!q) return;
    input.current?.blur();
    router.push(`/search?q=${encodeURIComponent(q)}`);
  };

  const large = size === "lg";
  return (
    <form onSubmit={submit} role="search" className="relative w-full">
      <Search
        className={`pointer-events-none absolute top-1/2 -translate-y-1/2 text-faint ${large ? "left-5 size-5" : "left-3.5 size-4"}`}
        aria-hidden="true"
      />
      <input
        ref={input}
        type="search"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        placeholder={large ? "Search for a podcast…" : "Search podcasts"}
        aria-label="Search podcasts"
        autoFocus={autoFocus}
        enterKeyHint="search"
        className={`w-full border border-text/20 bg-bg text-text placeholder:text-faint transition-colors hover:border-text/50 focus:border-text focus:outline-none [&::-webkit-search-cancel-button]:hidden ${
          large ? "h-14 pl-13 pr-12 text-base" : "h-10 pl-10 pr-9 text-sm"
        }`}
      />
      {query && (
        <button
          type="button"
          onClick={() => {
            setQuery("");
            input.current?.focus();
          }}
          className={`touch-target absolute top-1/2 -translate-y-1/2 p-1 text-faint hover:bg-text hover:text-bg ${large ? "right-4" : "right-2.5"}`}
          aria-label="Clear search"
        >
          <X className="size-4" />
        </button>
      )}
      {!query && size === "md" && (
        <kbd className="pointer-events-none absolute right-4 top-1/2 hidden -translate-y-1/2 font-mono text-xs text-faint sm:block">
          /
        </kbd>
      )}
    </form>
  );
}
