import Link from "next/link";
import type { Podcast } from "@/lib/types";
import { Artwork } from "@/components/Artwork";

export function PodcastCard({ podcast, priority = false }: { podcast: Podcast; priority?: boolean }) {
  return (
    <Link
      href={`/podcast/${podcast.id}`}
      className="hover-wave group -m-1.5 flex flex-col gap-2.5 overflow-hidden rounded-2xl p-1.5 transition-colors hover:bg-surface-2/70"
    >
      <Artwork
        src={podcast.image}
        alt=""
        priority={priority}
        className="aspect-square w-full rounded-xl shadow-card transition-transform duration-300 ease-out group-hover:-translate-y-0.5"
      />
      <div className="min-w-0 px-0.5">
        <h3 className="line-clamp-2 text-sm font-semibold leading-snug">{podcast.title}</h3>
        {podcast.author && <p className="mt-0.5 truncate text-xs text-muted">{podcast.author}</p>}
      </div>
    </Link>
  );
}

export function PodcastGrid({ podcasts, priorityCount = 0 }: { podcasts: Podcast[]; priorityCount?: number }) {
  return (
    <ul className="grid grid-cols-2 gap-x-4 gap-y-6 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6">
      {podcasts.map((podcast, i) => (
        <li key={podcast.id}>
          <PodcastCard podcast={podcast} priority={i < priorityCount} />
        </li>
      ))}
    </ul>
  );
}

export function PodcastGridSkeleton({ count = 12 }: { count?: number }) {
  return (
    <ul className="grid grid-cols-2 gap-x-4 gap-y-6 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6" aria-hidden="true">
      {Array.from({ length: count }, (_, i) => (
        <li key={i} className="flex flex-col gap-2.5">
          <div className="skeleton aspect-square w-full rounded-xl" />
          <div className="skeleton h-3.5 w-4/5 rounded" />
          <div className="skeleton h-3 w-1/2 rounded" />
        </li>
      ))}
    </ul>
  );
}
