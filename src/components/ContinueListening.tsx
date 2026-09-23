"use client";

import { Play } from "lucide-react";
import Link from "next/link";
import { Artwork } from "@/components/Artwork";
import { formatDuration } from "@/lib/text";
import type { Episode } from "@/lib/types";
import { useEpisodeProgress, usePlayer } from "@/store/player";

export function ContinueListening() {
  const recent = usePlayer((s) => s.recent);
  const stats = usePlayer((s) => s.stats);
  // Empty until the store rehydrates from localStorage after mount.
  if (recent.length === 0) return null;

  return (
    <section>
      <div className="mb-5 flex items-baseline justify-between gap-4">
        <h2 className="text-xl font-semibold tracking-tight">Continue listening</h2>
        {stats.adsSkipped > 0 && (
          <p className="text-sm text-muted">
            <span className="font-medium text-text">{stats.adsSkipped}</span> ads skipped ·{" "}
            <span className="font-medium text-text">{formatDuration(stats.secondsSaved)}</span> saved
          </p>
        )}
      </div>
      <ul className="scrollbar-none -mx-4 flex snap-x gap-4 overflow-x-auto px-4 pb-2 sm:-mx-6 sm:px-6">
        {recent.map((episode) => (
          <RecentCard key={episode.id} episode={episode} />
        ))}
      </ul>
    </section>
  );
}

function RecentCard({ episode }: { episode: Episode }) {
  const play = usePlayer((s) => s.play);
  const progress = useEpisodeProgress(episode);
  return (
    <li className="w-64 shrink-0 snap-start">
      <div className="flex gap-3 rounded-2xl border border-border bg-surface p-3 shadow-card">
        <button onClick={() => play(episode)} className="group relative shrink-0" aria-label={`Play ${episode.title}`}>
          <Artwork src={episode.image} alt="" className="size-16 rounded-lg" />
          <span className="absolute inset-0 grid place-items-center rounded-lg bg-black/40 opacity-0 transition group-hover:opacity-100 group-focus-visible:opacity-100">
            <Play className="size-6 fill-white text-white" />
          </span>
        </button>
        <div className="flex min-w-0 flex-1 flex-col">
          <Link href={`/podcast/${episode.podcastId}`} className="truncate text-xs text-muted hover:text-text">
            {episode.podcastTitle}
          </Link>
          <p className="line-clamp-2 text-sm font-medium leading-snug">{episode.title}</p>
          <div className="mt-auto flex items-center gap-2 pt-1.5">
            <div className="h-1 flex-1 overflow-hidden rounded-full bg-surface-2">
              <div className="h-full rounded-full bg-accent" style={{ width: `${Math.round(progress * 100)}%` }} />
            </div>
            {episode.duration > 0 && (
              <span className="text-[11px] text-faint">{formatDuration(episode.duration * (1 - progress))}</span>
            )}
          </div>
        </div>
      </div>
    </li>
  );
}
