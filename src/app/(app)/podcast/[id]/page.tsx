import { ExternalLink } from "lucide-react";
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { cache } from "react";
import { Artwork } from "@/components/Artwork";
import { EpisodeList } from "@/components/EpisodeList";
import { ExpandableText } from "@/components/ExpandableText";
import { getEpisodes, getPodcast } from "@/lib/server/podcastIndex";

type Props = { params: Promise<{ id: string }> };

// Shared between generateMetadata and the page within one request.
const loadPodcast = cache(async (rawId: string) => {
  const id = Number(rawId);
  if (!Number.isSafeInteger(id) || id <= 0) return null;
  return getPodcast(id);
});

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const podcast = await loadPodcast((await params).id);
  return podcast ? { title: podcast.title, description: podcast.description.slice(0, 160) } : {};
}

export default async function PodcastPage({ params }: Props) {
  const podcast = await loadPodcast((await params).id);
  if (!podcast) notFound();
  const episodes = await getEpisodes(podcast, 100);

  return (
    <div className="space-y-10">
      <header className="flex flex-col gap-6 sm:flex-row sm:items-end">
        <Artwork
          src={podcast.image}
          alt=""
          priority
          className="size-40 shrink-0 rounded-2xl shadow-card sm:size-52"
        />
        <div className="min-w-0 space-y-3">
          <div>
            <h1 className="text-3xl font-bold tracking-tight text-balance sm:text-4xl">{podcast.title}</h1>
            {podcast.author && <p className="mt-1 text-muted">{podcast.author}</p>}
          </div>
          {podcast.categories.length > 0 && (
            <ul className="flex flex-wrap gap-1.5">
              {podcast.categories.slice(0, 5).map((c) => (
                <li key={c} className="rounded-full bg-surface-2 px-2.5 py-0.5 text-xs text-muted">
                  {c}
                </li>
              ))}
            </ul>
          )}
          {podcast.link && (
            <a
              href={podcast.link}
              target="_blank"
              rel="noreferrer"
              className="inline-flex items-center gap-1 text-sm text-muted hover:text-text"
            >
              Website <ExternalLink className="size-3.5" aria-hidden="true" />
            </a>
          )}
        </div>
      </header>

      {podcast.description && (
        <ExpandableText text={podcast.description} className="max-w-3xl text-[15px] leading-relaxed text-muted" />
      )}

      <section>
        <h2 className="mb-3 text-xl font-semibold tracking-tight">
          Episodes <span className="text-base font-normal text-faint">{episodes.length}</span>
        </h2>
        {episodes.length ? (
          <EpisodeList episodes={episodes} />
        ) : (
          <p className="text-muted">This feed doesn&apos;t have any playable episodes.</p>
        )}
      </section>
    </div>
  );
}
