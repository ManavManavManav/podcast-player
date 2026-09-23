"use client";

import { Pause, Play } from "lucide-react";
import { formatDate, formatDuration } from "@/lib/text";
import type { Episode } from "@/lib/types";
import { useEpisodeProgress, usePlayback, usePlayer } from "@/store/player";

export function EpisodeList({ episodes }: { episodes: Episode[] }) {
  return (
    <ul className="divide-y divide-border border-y border-border">
      {episodes.map((episode) => (
        <EpisodeRow key={episode.id} episode={episode} />
      ))}
    </ul>
  );
}

function EpisodeRow({ episode }: { episode: Episode }) {
  const isCurrent = usePlayer((s) => s.episode?.id === episode.id);
  const playing = usePlayback((s) => s.playing) && isCurrent;
  const progress = useEpisodeProgress(episode);
  const play = usePlayer((s) => s.play);
  const toggle = usePlayer((s) => s.toggle);

  const onClick = () => (isCurrent ? toggle() : play(episode));
  const remaining = episode.duration ? episode.duration * (1 - progress) : 0;
  const started = progress > 0.01;
  const finished = progress > 0.97;

  const meta = [
    formatDate(episode.publishedAt),
    started && !finished && remaining ? `${formatDuration(remaining)} left` : formatDuration(episode.duration),
    finished ? "Played" : null,
  ].filter(Boolean);

  return (
    <li className="group relative flex gap-4 py-4">
      <button
        onClick={onClick}
        aria-label={`${playing ? "Pause" : "Play"} ${episode.title}`}
        className={`relative mt-0.5 grid size-11 shrink-0 place-items-center rounded-full transition ${
          isCurrent
            ? "bg-accent text-accent-text shadow-card"
            : "bg-surface-2 text-text group-hover:bg-accent group-hover:text-accent-text"
        }`}
      >
        {playing ? <Pause className="size-4 fill-current" /> : <Play className="ml-0.5 size-4 fill-current" />}
        {started && !finished && !isCurrent && <ProgressRing progress={progress} />}
      </button>
      <div className="min-w-0 flex-1">
        <p className="text-xs text-faint">{meta.join(" · ")}</p>
        <h3 className={`mt-0.5 font-medium leading-snug ${isCurrent ? "text-accent" : ""} ${finished ? "text-muted" : ""}`}>
          <button onClick={onClick} className="text-left after:absolute after:inset-0 after:content-['']">
            {episode.title}
          </button>
        </h3>
        {episode.description && <p className="mt-1 line-clamp-2 text-sm text-muted">{episode.description}</p>}
      </div>
    </li>
  );
}

function ProgressRing({ progress }: { progress: number }) {
  const r = 20.5;
  const c = 2 * Math.PI * r;
  return (
    <svg className="pointer-events-none absolute inset-0 -rotate-90" viewBox="0 0 44 44" aria-hidden="true">
      <circle cx="22" cy="22" r={r} fill="none" strokeWidth="2.5" className="stroke-accent" strokeDasharray={c} strokeDashoffset={c * (1 - progress)} strokeLinecap="round" />
    </svg>
  );
}
