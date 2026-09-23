import type { Metadata } from "next";
import { Suspense } from "react";
import { PodcastGrid, PodcastGridSkeleton } from "@/components/PodcastCard";
import { searchPodcasts } from "@/lib/server/podcastIndex";

type Props = { searchParams: Promise<{ q?: string }> };

export async function generateMetadata({ searchParams }: Props): Promise<Metadata> {
  const { q } = await searchParams;
  return { title: q ? `“${q}”` : "Search" };
}

export default async function SearchPage({ searchParams }: Props) {
  const q = (await searchParams).q?.trim() ?? "";

  if (!q) {
    return <p className="py-20 text-center text-muted">Type a podcast name, host or topic to search.</p>;
  }

  return (
    <div>
      <h1 className="mb-6 text-2xl font-semibold tracking-tight">
        Results for <span className="text-accent">“{q}”</span>
      </h1>
      <Suspense key={q} fallback={<PodcastGridSkeleton />}>
        <Results q={q} />
      </Suspense>
    </div>
  );
}

async function Results({ q }: { q: string }) {
  const podcasts = await searchPodcasts(q, 36);
  if (podcasts.length === 0) {
    return (
      <p className="rounded-xl border border-dashed border-border p-10 text-center text-muted">
        No podcasts matched “{q}”. Try a shorter or different search.
      </p>
    );
  }
  return <PodcastGrid podcasts={podcasts} priorityCount={6} />;
}
