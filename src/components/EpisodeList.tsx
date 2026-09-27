"use client";

import { LoaderCircle } from "lucide-react";
import { useRef } from "react";
import { playBurst } from "@/components/player/PlayBurst";
import { formatDate, formatDuration } from "@/lib/text";
import type { Episode } from "@/lib/types";
import { useEpisodeProgress, usePlayback, usePlayer } from "@/store/player";

export function EpisodeList({ episodes }: { episodes: Episode[] }) {
  return (
    <ul className="divide-y divide-border overflow-hidden rounded-3xl bg-surface px-4 sm:px-6">
      {episodes.map((episode) => (
        <EpisodeRow key={episode.id} episode={episode} list={episodes} />
      ))}
    </ul>
  );
}

function EpisodeRow({ episode, list }: { episode: Episode; list: Episode[] }) {
  const isCurrent = usePlayer((s) => s.episode?.id === episode.id);
  const playing = usePlayback((s) => s.playing) && isCurrent;
  // Feedback from the moment of the click, before the audio is ready.
  const loading = usePlayback((s) => s.buffering && !s.playing) && isCurrent;
  const progress = useEpisodeProgress(episode);
  const play = usePlayer((s) => s.play);
  const toggle = usePlayer((s) => s.toggle);

  const playButton = useRef<HTMLButtonElement>(null);

  const onClick = () => {
    if (isCurrent) return toggle();
    playBurst(playButton.current);
    play(episode, list);
  };
  const remaining = episode.duration ? episode.duration * (1 - progress) : 0;
  const started = progress > 0.01;
  const finished = progress > 0.97;

  const meta = [
    formatDate(episode.publishedAt),
    started && !finished && remaining ? `${formatDuration(remaining)} left` : formatDuration(episode.duration),
    finished ? "Played" : null,
  ].filter(Boolean);

  return (
    // Inset a little on each side (and pulled back out by the same amount), so the play
    // button's hover scale isn't clipped by the row, which clips its sheen.
    <li className="hover-wave group relative -mx-2 flex gap-4 overflow-hidden px-2 py-5">
      <button
        ref={playButton}
        onClick={onClick}
        aria-label={`${playing ? "Pause" : "Play"} ${episode.title}`}
        className={`press relative z-[2] mt-0.5 grid h-9 w-[5.5rem] shrink-0 place-items-center text-xs uppercase hover:line-through ${
          isCurrent ? "bg-text text-bg" : "border border-text text-text group-hover:bg-text group-hover:text-bg"
        }`}
      >
        {loading ? (
          <LoaderCircle className="size-4 animate-spin" aria-hidden="true" />
        ) : playing ? (
          "Pause"
        ) : started && !finished ? (
          "Resume"
        ) : (
          "Play"
        )}
      </button>
      <div className="min-w-0 flex-1">
        <p className="font-mono text-xs text-faint">{meta.join(" · ")}</p>
        <h3 className={`mt-1 font-serif text-xl leading-snug ${finished ? "text-muted" : ""}`}>
          <button onClick={onClick} className="text-left after:absolute after:inset-0 after:content-['']">
            {episode.title}
          </button>
        </h3>
        {episode.description && episode.description !== episode.title && (
          <p className="mt-1.5 line-clamp-2 text-sm leading-relaxed text-muted">{episode.description}</p>
        )}
      </div>
    </li>
  );
}
