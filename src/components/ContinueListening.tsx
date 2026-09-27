"use client";

import { ArrowRight } from "lucide-react";
import Link from "next/link";
import { Artwork } from "@/components/Artwork";
import { buttonStyles } from "@/components/ui/Button";
import { formatDuration } from "@/lib/text";
import type { Episode } from "@/lib/types";
import { useEpisodeProgress, usePlayback, usePlayer } from "@/store/player";

/** The top of the home page: what Podblock has saved you so far, and where to go next. */
export function HomeSummary() {
  const latest = usePlayer((s) => s.recent[0]);
  const stats = usePlayer((s) => s.stats);
  const play = usePlayer((s) => s.play);

  return (
    <section aria-label="Your listening" className="flex flex-wrap items-end justify-between gap-x-10 gap-y-6 pt-2 sm:pt-6">
      {stats.adsSkipped > 0 ? (
        <dl className="flex gap-10">
          <Stat label={stats.adsSkipped === 1 ? "Ad skipped" : "Ads skipped"} value={String(stats.adsSkipped)} />
          <Stat label="Time saved" value={formatDuration(stats.secondsSaved)} />
        </dl>
      ) : (
        <p className="max-w-md text-sm text-muted">Play an episode and Podblock skips its ads. What it saves you adds up here.</p>
      )}
      <div className="flex max-w-full flex-wrap gap-3">
        <Link href="/search" className={buttonStyles()}>
          Find a show <ArrowRight className="size-4" aria-hidden="true" />
        </Link>
        {latest && (
          <button onClick={() => play(latest)} className={`${buttonStyles({ variant: "outline" })} max-w-full`}>
            <span className="truncate">Resume {latest.title}</span>
            <ArrowRight className="size-4 shrink-0" aria-hidden="true" />
          </button>
        )}
      </div>
    </section>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex flex-col-reverse gap-1">
      <dt className="text-xs uppercase text-muted">{label}</dt>
      <dd className="font-serif text-4xl leading-none tracking-display sm:text-5xl">{value}</dd>
    </div>
  );
}

export function ContinueListening() {
  const recent = usePlayer((s) => s.recent);
  // Empty until the store rehydrates from localStorage after mount.
  if (recent.length === 0) return null;

  return (
    <section>
      <div className="mb-6 flex items-baseline gap-3">
        <h2 className="font-serif text-heading leading-tight tracking-heading">Continue listening</h2>
        <span className="font-mono text-meta text-faint">{recent.length}</span>
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
  const playing = usePlayback((s) => s.playing) && isCurrent;
  const toggle = usePlayer((s) => s.toggle);
  const progress = useEpisodeProgress(episode);
  return (
    <li className="flex items-center gap-4 bg-surface p-4 sm:gap-5 sm:p-5">
      <Artwork src={episode.image} alt="" className="size-16 shrink-0 sm:size-[92px]" />
      <div className="flex min-w-0 flex-1 flex-col gap-1">
        <Link href={`/podcast/${episode.podcastId}`} className="truncate text-meta text-faint hover:text-text">
          {episode.podcastTitle}
        </Link>
        <p className="line-clamp-2 font-serif text-xl leading-tight sm:text-[23px]">{episode.title}</p>
        <div className="mt-2 h-0.5 overflow-hidden bg-text/15">
          <div className="h-full bg-text" style={{ width: `${Math.round(progress * 100)}%` }} />
        </div>
        {episode.duration > 0 && (
          <span className="font-mono text-xs text-faint">{formatDuration(episode.duration * (1 - progress))} left</span>
        )}
      </div>
      <button
        onClick={() => (isCurrent ? toggle() : play(episode))}
        aria-label={`${playing ? "Pause" : "Play"} ${episode.title}`}
        className={`${buttonStyles({ size: "md" })} w-[6rem]`}
      >
        {playing ? "Pause" : isCurrent ? "Play" : "Resume"}
      </button>
    </li>
  );
}
