import { Suspense } from "react";
import { ContinueListening, HeroActions } from "@/components/ContinueListening";
import { PodcastGrid, PodcastGridSkeleton } from "@/components/PodcastCard";
import { trendingPodcasts } from "@/lib/server/podcastIndex";

export default function HomePage() {
  return (
    <div className="space-y-16 sm:space-y-20">
      <section className="flex flex-col items-center pt-8 text-center sm:pt-14">
        <h1 className="font-serif text-hero leading-[1.02] tracking-display text-balance sm:text-hero-lg">
          Podcasts,
          <br />
          minus the ads.
        </h1>
        <p className="mt-6 max-w-[34rem] text-pretty leading-relaxed text-muted sm:text-lg">
          Podblock listens a few minutes ahead of you, finds the sponsor reads, and skips straight past them.
        </p>
        <HeroActions />
      </section>

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
