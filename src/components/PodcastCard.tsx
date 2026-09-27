import Link from "next/link";
import type { Podcast } from "@/lib/types";
import { Artwork } from "@/components/Artwork";

export function PodcastCard({ podcast, priority = false }: { podcast: Podcast; priority?: boolean }) {
  return (
    <Link
      href={`/podcast/${podcast.id}`}
      className="hover-wave group flex h-full flex-col gap-3 overflow-hidden rounded-card bg-surface p-3 pb-4"
    >
      <Artwork
        src={podcast.image}
        alt=""
        priority={priority}
        className="aspect-square w-full rounded-art transition-transform duration-300 ease-out group-hover:-translate-y-0.5"
      />
      <div className="min-w-0 px-1">
        <h3 className="line-clamp-2 text-body font-medium leading-snug">{podcast.title}</h3>
        {podcast.author && <p className="mt-0.5 truncate text-meta text-faint">{podcast.author}</p>}
      </div>
    </Link>
  );
}

export function PodcastGrid({ podcasts, priorityCount = 0 }: { podcasts: Podcast[]; priorityCount?: number }) {
  return (
    <ul className="grid grid-cols-2 gap-3 sm:grid-cols-3 sm:gap-5 md:grid-cols-4 lg:grid-cols-6">
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
    <ul className="grid grid-cols-2 gap-3 sm:grid-cols-3 sm:gap-5 md:grid-cols-4 lg:grid-cols-6" aria-hidden="true">
      {Array.from({ length: count }, (_, i) => (
        <li key={i} className="flex flex-col gap-3 rounded-card bg-surface p-3 pb-4">
          <div className="skeleton aspect-square w-full rounded-art" />
          <div className="skeleton h-3.5 w-4/5 rounded" />
          <div className="skeleton h-3 w-1/2 rounded" />
        </li>
      ))}
    </ul>
  );
}
