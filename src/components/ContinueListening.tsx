"use client";

import { ArrowRight, Play } from "lucide-react";
import Link from "next/link";
import { Artwork } from "@/components/Artwork";
import { playBurst } from "@/components/player/PlayBurst";
import { formatDuration } from "@/lib/text";
import type { Episode } from "@/lib/types";
import { useEpisodeProgress, usePlayer } from "@/store/player";

const pill =
  "hover-breathe flex h-12 items-center gap-2.5 rounded-full px-6 text-[15px] font-medium [--hover-scale:1.03]";

/** The hero's buttons, plus the listener's running total of time saved. */
export function HeroActions() {
  const latest = usePlayer((s) => s.recent[0]);
  const stats = usePlayer((s) => s.stats);
  const play = usePlayer((s) => s.play);

  return (
    <>
      <div className="mt-9 flex flex-wrap justify-center gap-3">
        <Link href="/search" className={`${pill} bg-accent text-accent-text`}>
          Find a show <ArrowRight className="size-4" aria-hidden="true" />
        </Link>
        {latest && (
          <button onClick={() => play(latest)} className={`${pill} max-w-full border border-accent`}>
            <span className="truncate">Resume {latest.title}</span>
            <ArrowRight className="size-4 shrink-0" aria-hidden="true" />
          </button>
        )}
      </div>
      {stats.adsSkipped > 0 && (
        <p className="mt-6 font-mono text-[13px] text-faint">
          {stats.adsSkipped} {stats.adsSkipped === 1 ? "ad" : "ads"} skipped · {formatDuration(stats.secondsSaved)} saved
        </p>
      )}
    </>
  );
}

export function ContinueListening() {
  const recent = usePlayer((s) => s.recent);
  // Empty until the store rehydrates from localStorage after mount.
  if (recent.length === 0) return null;

  return (
    <section>
      <div className="mb-6 flex items-baseline gap-3">
        <h2 className="font-serif text-[34px] leading-tight tracking-[-0.01em]">Continue listening</h2>
        <span className="font-mono text-[13px] text-faint">{recent.length}</span>
      </div>
      <ul className="grid gap-5 md:grid-cols-2">
        {recent.slice(0, 4).map((episode) => (
          <RecentCard key={episode.id} episode={episode} />
        ))}
      </ul>
    </section>
  );
}

function RecentCard({ episode }: { episode: Episode }) {
  const play = usePlayer((s) => s.play);
  const isCurrent = usePlayer((s) => s.episode?.id === episode.id);
  const progress = useEpisodeProgress(episode);
  return (
    <li className="flex items-center gap-4 rounded-[22px] bg-surface p-4 sm:gap-5 sm:p-5">
      <Artwork src={episode.image} alt="" className="size-16 shrink-0 rounded-[14px] sm:size-[92px]" />
      <div className="flex min-w-0 flex-1 flex-col gap-1">
        <Link href={`/podcast/${episode.podcastId}`} className="truncate text-[13px] text-faint hover:text-text">
          {episode.podcastTitle}
        </Link>
        <p className="line-clamp-2 font-serif text-xl leading-tight sm:text-[23px]">{episode.title}</p>
        <div className="mt-2 h-1 overflow-hidden rounded-full bg-surface-2">
          <div className="h-full rounded-full bg-accent" style={{ width: `${Math.round(progress * 100)}%` }} />
        </div>
        {episode.duration > 0 && (
          <span className="font-mono text-xs text-faint">{formatDuration(episode.duration * (1 - progress))} left</span>
        )}
      </div>
      <button
        onClick={(e) => {
          if (!isCurrent) playBurst(e.currentTarget);
          play(episode);
        }}
        aria-label={`Play ${episode.title}`}
        className="hover-breathe grid size-12 shrink-0 place-items-center rounded-full bg-accent text-accent-text [--hover-scale:1.08]"
      >
        <Play className="ml-0.5 size-4 fill-current" />
      </button>
    </li>
  );
}
