import type { Metadata } from "next";
import { Suspense } from "react";
import { PodcastGrid, PodcastGridSkeleton } from "@/components/PodcastCard";
import { SearchBox } from "@/components/SearchBox";
import { searchPodcasts } from "@/lib/server/podcastIndex";

type Props = { searchParams: Promise<{ q?: string }> };

export async function generateMetadata({ searchParams }: Props): Promise<Metadata> {
  const { q } = await searchParams;
  return { title: q ? `“${q}”` : "Search" };
}

export default async function SearchPage({ searchParams }: Props) {
  const q = (await searchParams).q?.trim() ?? "";

  if (!q) {
    return (
      <section className="mx-auto flex max-w-2xl flex-col items-center pt-10 text-center sm:pt-16">
        <h1 className="font-serif text-5xl tracking-display sm:text-6xl">Find a show</h1>
        <p className="mt-4 text-muted">Search millions of podcasts by name, host or topic.</p>
        <div className="mt-8 w-full">
          <Suspense>
            <SearchBox size="lg" autoFocus />
          </Suspense>
        </div>
      </section>
    );
  }

  return (
    <div>
      <h1 className="mb-8 font-serif text-4xl tracking-heading sm:text-5xl">
        <span className="text-muted">Results for</span> “{q}”
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
      <p className="rounded-3xl bg-surface p-10 text-center text-muted">
        No podcasts matched “{q}”. Try a shorter or different search.
      </p>
    );
  }
  return <PodcastGrid podcasts={podcasts} priorityCount={6} />;
}
