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

export type DetectorKind = "heuristic" | "glm" | "claude";

/** Response of POST /api/analyze. */
export interface AnalyzeResponse {
  /** Start of the analyzed window, in seconds. */
  window: number;
  segments: TranscriptSegment[];
  /** Every ad found in the episode so far, not just in this window. */
  ads: AdRange[];
  detector: DetectorKind;
  cached: boolean;
  /** Set when the chosen AI provider failed and on-device detection was used instead. */
  detectorError?: string;
}

/** Response of GET /api/analyze: everything already analyzed for an episode. */
export interface CachedAnalysis {
  windows: number[];
  segments: TranscriptSegment[];
  ads: AdRange[];
  detector: DetectorKind;
}

export type KeyStatus =
  /** The user saved their own key (shown masked). */
  | { status: "own"; masked: string }
  /** No key of their own, but the server operator provided one. */
  | { status: "shared" }
  /** A stored key that can't be decrypted (the server secret changed). */
  | { status: "unreadable" }
  | { status: "none" };

/** Response of GET/PUT /api/settings. Keys are never sent back in full. */
export interface UserSettings {
  detector: DetectorKind;
  glmModel: string;
  claudeModel: string;
  keys: { zai: KeyStatus; anthropic: KeyStatus };
}

export interface HealthResponse {
  ok: boolean;
  podcastIndex: boolean;
  ffmpeg: boolean;
  whisper: { ok: boolean; python: string | null; model: string; error?: string };
  detector: DetectorKind;
}
