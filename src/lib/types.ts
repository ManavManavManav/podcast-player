/** Shared types used by both the server and the browser. */

export interface Podcast {
  id: number;
  title: string;
  author: string;
  description: string;
  image: string;
  language: string;
  categories: string[];
  episodeCount: number;
  link: string;
}

export interface Episode {
  id: number;
  title: string;
  description: string;
  audioUrl: string;
  image: string;
  /** Seconds. 0 when the feed doesn't say. */
  duration: number;
  /** Unix seconds. */
  publishedAt: number;
  season: number | null;
  episode: number | null;
  podcastId: number;
  podcastTitle: string;
  /** The show's website, if the feed has one. Missing on episodes saved by older versions. */
  podcastLink?: string;
  language: string;
}

/** A timestamped piece of transcript, in episode time (seconds). */
export interface TranscriptSegment {
  start: number;
  end: number;
  text: string;
}

/** A span of the episode the detector believes is an ad. */
export interface AdRange {
  start: number;
  end: number;
  /** 0–1. */
  confidence: number;
  /** Short human-readable explanation, e.g. the phrase that gave it away. */
  reason: string;
}

/**
 * What the episode is, so the detector can tell the show's own plugs and the
 * episode's subject apart from ads. All hints; any may be missing.
 */
export interface EpisodeContext {
  podcastTitle?: string;
  episodeTitle?: string;
  /** The show's website, e.g. "https://www.acquired.fm". */
  website?: string;
}

/** Response of POST /api/analyze. */
export interface AnalyzeResponse {
  /** Start of the analyzed window, in seconds. */
  window: number;
  segments: TranscriptSegment[];
  /** Every ad found in the episode so far, not just in this window. */
  ads: AdRange[];
  cached: boolean;
  /** The audio ends before this window: there's nothing more to analyze. */
  end?: boolean;
  /** This window's loudness envelope (lib/envelope.ts), when it was measured. */
  envelope?: string;
}

/** Response of GET /api/analyze: everything already analyzed for an episode. */
export interface CachedAnalysis {
  windows: number[];
  segments: TranscriptSegment[];
  ads: AdRange[];
  /** Loudness envelopes by window start, for the windows that have one. */
  envelopes?: Record<number, string>;
}

export interface HealthResponse {
  ok: boolean;
  podcastIndex: boolean;
  transcription: boolean;
  detection: boolean;
}

/** A row of the admin page's user list. */
export interface AdminUser {
  id: string;
  name: string;
  email: string;
  role: "admin" | "user";
  approved: boolean;
  banned: boolean;
  createdAt: string;
  /** This month's paid API usage. */
  usage: { audioMinutes: number; detectCalls: number; inputTokens: number; outputTokens: number };
}
