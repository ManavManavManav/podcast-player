import { Suspense } from "react";
import { ContinueListening, HomeSummary } from "@/components/ContinueListening";
import { PodcastGrid, PodcastGridSkeleton } from "@/components/PodcastCard";
import { trendingPodcasts } from "@/lib/server/podcastIndex";

export default function HomePage() {
  return (
    <div className="space-y-14 sm:space-y-16">
      <h1 className="sr-only">Discover</h1>
      <HomeSummary />

      <ContinueListening />

      <section>
        <h2 className="mb-6 font-serif text-heading leading-tight tracking-heading">Trending now</h2>
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
      <p className="bg-surface p-8 text-center text-sm text-muted">
        Couldn&apos;t load trending podcasts. Check your Podcast Index API keys and connection.
      </p>
    );
  }
  return <PodcastGrid podcasts={podcasts} priorityCount={6} />;
}
