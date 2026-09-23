import { Suspense } from "react";
import { ContinueListening } from "@/components/ContinueListening";
import { PodcastGrid, PodcastGridSkeleton } from "@/components/PodcastCard";
import { SearchBox } from "@/components/SearchBox";
import { trendingPodcasts } from "@/lib/server/podcastIndex";

export default function HomePage() {
  return (
    <div className="space-y-14">
      <section className="mx-auto max-w-2xl pt-6 text-center sm:pt-12">
        <h1 className="text-4xl font-bold tracking-tight text-balance sm:text-5xl">
          Podcasts, <span className="text-accent">minus the ads.</span>
        </h1>
        <p className="mx-auto mt-4 max-w-lg text-pretty text-muted sm:text-lg">
          Podblock listens a few minutes ahead of you, spots sponsor reads and inserted ads, and skips
          straight past them.
        </p>
        <div className="mt-8">
          <Suspense>
            <SearchBox size="lg" />
          </Suspense>
        </div>
      </section>

      <ContinueListening />

      <section>
        <h2 className="mb-5 text-xl font-semibold tracking-tight">Trending now</h2>
        <Suspense fallback={<PodcastGridSkeleton />}>
          <Trending />
        </Suspense>
      </section>
    </div>
  );
}

async function Trending() {
  const podcasts = await trendingPodcasts(24).catch(() => null);
  if (!podcasts) {
    return (
      <p className="rounded-xl border border-dashed border-border p-6 text-center text-sm text-muted">
        Couldn&apos;t load trending podcasts. Check your Podcast Index API keys and connection.
      </p>
    );
  }
  return <PodcastGrid podcasts={podcasts} priorityCount={6} />;
}
