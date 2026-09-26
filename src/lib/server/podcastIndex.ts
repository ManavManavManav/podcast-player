import crypto from "node:crypto";
import type { Episode, Podcast } from "@/lib/types";
import { stripHtml } from "@/lib/text";

const DEFAULT_API_BASE = "https://api.podcastindex.org/api/1.0";
/** PODCAST_INDEX_BASE_URL points the client at another server (end-to-end tests use a stub). */
const apiBase = () => (process.env.PODCAST_INDEX_BASE_URL || DEFAULT_API_BASE).replace(/\/+$/, "");
const USER_AGENT = "Podblock/1.0";
/** Pages wait on these calls, so a slow API mustn't hang them. */
const TIMEOUT_MS = 8_000;

export class PodcastIndexError extends Error {
  constructor(
    message: string,
    readonly status?: number,
  ) {
    super(message);
    this.name = "PodcastIndexError";
  }
}

function credentials(): { key: string; secret: string } {
  const key = process.env.PODCAST_INDEX_API_KEY;
  const base64 = process.env.PODCAST_INDEX_API_SECRET_BASE64;
  const secret = base64
    ? Buffer.from(base64, "base64").toString("utf-8")
    : process.env.PODCAST_INDEX_API_SECRET;
  if (!key || !secret) {
    throw new PodcastIndexError(
      "Podcast Index credentials are missing. Set PODCAST_INDEX_API_KEY and PODCAST_INDEX_API_SECRET in .env.local.",
    );
  }
  return { key, secret };
}

export function hasPodcastIndexCredentials(): boolean {
  try {
    credentials();
    return true;
  } catch {
    return false;
  }
}

async function request<T>(
  endpoint: string,
  params: Record<string, string | number>,
  revalidate = 600,
): Promise<T> {
  const { key, secret } = credentials();
  const authDate = Math.floor(Date.now() / 1000).toString();
  const signature = crypto
    .createHash("sha1")
    .update(key + secret + authDate)
    .digest("hex");

  const query = new URLSearchParams(
    Object.entries(params).map(([k, v]) => [k, String(v)]),
  );
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(`${apiBase()}/${endpoint}?${query}`, {
      headers: {
        "User-Agent": USER_AGENT,
        "X-Auth-Date": authDate,
        "X-Auth-Key": key,
        Authorization: signature,
      },
      next: { revalidate },
      signal: controller.signal,
    });
    if (!res.ok) {
      throw new PodcastIndexError(
        `Podcast Index request failed (${res.status})`,
        res.status,
      );
    }
    // Still inside the timeout: a body can stall too.
    return (await res.json()) as T;
  } catch (err) {
    if (err instanceof PodcastIndexError) throw err;
    if (controller.signal.aborted) throw new PodcastIndexError("Podcast Index didn't answer in time");
    throw new PodcastIndexError(`Couldn't reach Podcast Index: ${(err as Error).message}`);
  } finally {
    clearTimeout(timer);
  }
}

// --- Raw API shapes (only the fields we use) -------------------------------

interface RawFeed {
  id: number;
  title?: string;
  author?: string;
  ownerName?: string;
  description?: string;
  image?: string;
  artwork?: string;
  language?: string;
  categories?: Record<string, string> | null;
  episodeCount?: number;
  link?: string;
}

interface RawEpisode {
  id: number;
  title?: string;
  description?: string;
  enclosureUrl?: string;
  image?: string;
  feedImage?: string;
  duration?: number | null;
  datePublished?: number;
  season?: number | null;
  episode?: number | null;
  feedId: number;
  feedTitle?: string;
  feedLanguage?: string;
}

/** Feed-supplied links are rendered as hrefs, so only http(s) ones are kept. */
function webLink(value: string | undefined): string {
  const link = value?.trim() ?? "";
  try {
    const { protocol } = new URL(link);
    return protocol === "http:" || protocol === "https:" ? link : "";
  } catch {
    return "";
  }
}

function toPodcast(feed: RawFeed): Podcast {
  return {
    id: feed.id,
    title: feed.title?.trim() || "Untitled podcast",
    author: feed.author || feed.ownerName || "",
    description: stripHtml(feed.description ?? ""),
    image: feed.artwork || feed.image || "",
    language: feed.language ?? "",
    categories: feed.categories ? Object.values(feed.categories) : [],
    episodeCount: feed.episodeCount ?? 0,
    link: webLink(feed.link),
  };
}

function toEpisode(ep: RawEpisode, podcast?: Podcast): Episode {
  return {
    id: ep.id,
    title: ep.title?.trim() || "Untitled episode",
    description: stripHtml(ep.description ?? ""),
    audioUrl: ep.enclosureUrl ?? "",
    image: ep.image || ep.feedImage || podcast?.image || "",
    duration: ep.duration && ep.duration > 0 ? ep.duration : 0,
    publishedAt: ep.datePublished ?? 0,
    season: ep.season || null,
    episode: ep.episode || null,
    podcastId: ep.feedId,
    podcastTitle: podcast?.title ?? ep.feedTitle ?? "",
    podcastLink: podcast?.link ?? "",
    language: ep.feedLanguage || podcast?.language || "",
  };
}

// --- Public API --------------------------------------------------------------

export async function searchPodcasts(term: string, max = 30): Promise<Podcast[]> {
  const data = await request<{ feeds?: RawFeed[] }>("search/byterm", {
    q: term,
    max,
  });
  return (data.feeds ?? []).map(toPodcast);
}

export async function trendingPodcasts(max = 24): Promise<Podcast[]> {
  const data = await request<{ feeds?: RawFeed[] }>(
    "podcasts/trending",
    { max, lang: "en" },
    3600,
  );
  return (data.feeds ?? []).map(toPodcast);
}

export async function getPodcast(id: number): Promise<Podcast | null> {
  const data = await request<{ feed?: RawFeed | [] }>("podcasts/byfeedid", { id });
  // The API returns `feed: []` for unknown ids.
  if (!data.feed || Array.isArray(data.feed)) return null;
  return toPodcast(data.feed);
}

export async function getEpisodes(podcast: Podcast, max = 100): Promise<Episode[]> {
  const data = await request<{ items?: RawEpisode[] }>("episodes/byfeedid", {
    id: podcast.id,
    max,
  });
  return (data.items ?? [])
    .map((ep) => toEpisode(ep, podcast))
    .filter((ep) => ep.audioUrl);
}
