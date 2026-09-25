import { createHash } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { WINDOW_SECONDS } from "@/lib/analysis";
import { detectAds, siteName } from "@/lib/ads/heuristic";
import { mergeRanges, snapToSpeech } from "@/lib/ads/merge";
import type { AdRange, AnalyzeResponse, CachedAnalysis, EpisodeContext, TranscriptSegment } from "@/lib/types";
import { extractWindow } from "@/lib/server/audio";
import { classifyWithClaude } from "@/lib/server/llm/claude";
import { classifyWithGlm } from "@/lib/server/llm/glm";
import { PROMPT_VERSION } from "@/lib/server/llm/prompt";
import type { DetectorConfig } from "@/lib/server/settings";
import { whisper } from "@/lib/server/whisper";

/**
 * Transcribes episodes one window at a time and keeps an up-to-date list of
 * ad ranges per episode. Results are cached in memory and on disk, so a
 * re-listen (or a server restart) doesn't redo any work.
 */

const CACHE_DIR = process.env.PODBLOCK_CACHE_DIR || path.join(process.cwd(), ".cache", "analysis");
const CACHE_VERSION = 1;
const MEMORY_LIMIT = 30;

interface EpisodeRecord {
  version: number;
  url: string;
  /** Window start (seconds) → transcript segments in episode time. */
  windows: Record<number, TranscriptSegment[]>;
  /**
   * LLM verdicts, per "provider:model" (e.g. "glm:glm-4.7-flash"), then per
   * window start. Kept separately so users with different settings never
   * see each other's model's results, and replays never pay twice.
   */
  llm: Record<string, Record<number, AdRange[]>>;
}

function keyFor(url: string) {
  return createHash("sha1").update(url).digest("hex").slice(0, 20);
}

// --- Cache ---------------------------------------------------------------------

const state = globalThis as unknown as {
  __podblockEpisodes?: Map<string, Promise<EpisodeRecord>>;
  __podblockInflight?: Map<string, SharedTask<TranscriptSegment[]>>;
};
/**
 * Keyed by URL hash. Holds the load *promise* so concurrent first requests for
 * an episode share one record instead of each building (and saving) their own.
 */
const episodes = (state.__podblockEpisodes ??= new Map<string, Promise<EpisodeRecord>>());
const inflight = (state.__podblockInflight ??= new Map<string, SharedTask<TranscriptSegment[]>>());

function loadEpisode(url: string): Promise<EpisodeRecord> {
  const key = keyFor(url);
  let record = episodes.get(key);
  if (record) {
    // Refresh LRU position.
    episodes.delete(key);
  } else {
    record = readEpisode(url, key);
  }
  episodes.set(key, record);
  if (episodes.size > MEMORY_LIMIT) episodes.delete(episodes.keys().next().value!);
  return record;
}

async function readEpisode(url: string, key: string): Promise<EpisodeRecord> {
  try {
    const stored = JSON.parse(await fs.readFile(path.join(CACHE_DIR, `${key}.json`), "utf-8"));
    if (stored.version === CACHE_VERSION && stored.url === url) {
      // Records from before per-model verdicts: keep the transcripts.
      stored.llm ??= {};
      delete stored.claude;
      return stored;
    }
  } catch {
    // Not cached yet.
  }
  return { version: CACHE_VERSION, url, windows: {}, llm: {} };
}

const pendingWrites = new Map<string, NodeJS.Timeout>();

function saveEpisode(record: EpisodeRecord) {
  const key = keyFor(record.url);
  clearTimeout(pendingWrites.get(key));
  pendingWrites.set(
    key,
    setTimeout(async () => {
      pendingWrites.delete(key);
      try {
        await fs.mkdir(CACHE_DIR, { recursive: true });
        const file = path.join(CACHE_DIR, `${key}.json`);
        await fs.writeFile(`${file}.tmp`, JSON.stringify(record));
        await fs.rename(`${file}.tmp`, file);
      } catch (err) {
        console.warn("[podblock] could not write analysis cache:", err);
      }
    }, 1000),
  );
}

// --- Shared, abortable work ----------------------------------------------------

/**
 * A task several requests can wait on. It's only cancelled once every
 * request waiting on it has gone away.
 */
class SharedTask<T> {
  private controller = new AbortController();
  private waiters = 0;
  readonly promise: Promise<T>;

  constructor(run: (signal: AbortSignal) => Promise<T>) {
    this.promise = run(this.controller.signal);
  }

  wait(signal?: AbortSignal): Promise<T> {
    this.waiters++;
    return new Promise<T>((resolve, reject) => {
      const leave = () => {
        signal?.removeEventListener("abort", onAbort);
        this.waiters--;
      };
      const onAbort = () => {
        leave();
        if (this.waiters === 0) this.controller.abort();
        reject(new DOMException("Aborted", "AbortError"));
      };
      if (signal?.aborted) return onAbort();
      signal?.addEventListener("abort", onAbort, { once: true });
      this.promise.then(
        (value) => {
          leave();
          resolve(value);
        },
        (err) => {
          leave();
          reject(err);
        },
      );
    });
  }
}

async function transcribeWindow(
  url: string,
  start: number,
  language: string | undefined,
  signal: AbortSignal,
): Promise<TranscriptSegment[]> {
  const wav = await extractWindow(url, start, WINDOW_SECONDS, signal);
  try {
    const segments = await whisper.transcribe(wav, language, signal);
    return segments
      .map((s) => ({
        start: Math.round((start + s.start) * 100) / 100,
        end: Math.round((start + Math.min(s.end, WINDOW_SECONDS)) * 100) / 100,
        text: s.text,
      }))
      .filter((s) => s.end > s.start);
  } finally {
    await fs.rm(wav, { force: true });
  }
}

// --- Detection -------------------------------------------------------------------

function verdictKey(detector: Exclude<DetectorConfig, { kind: "heuristic" }>) {
  // Verdicts from older instructions are redone, not reused.
  return `${detector.kind}:${detector.model}:p${PROMPT_VERSION}`;
}

function allSegments(record: EpisodeRecord): TranscriptSegment[] {
  return Object.keys(record.windows)
    .map(Number)
    .sort((a, b) => a - b)
    .flatMap((w) => record.windows[w]);
}

/** The show's own site names, which the on-device detector won't treat as ad evidence. */
function ownSites(episode: EpisodeContext): string[] {
  const fromTitle = episode.podcastTitle?.toLowerCase().replace(/[^a-z0-9]/g, "");
  return [siteName(episode.website), fromTitle && fromTitle.length >= 3 && fromTitle.length <= 30 ? fromTitle : null].filter(
    (name): name is string => Boolean(name),
  );
}

function computeAds(record: EpisodeRecord, detector: DetectorConfig, episode: EpisodeContext): AdRange[] {
  const segments = allSegments(record);
  const heuristic = detectAds(segments, { ownSites: ownSites(episode) });
  if (detector.kind === "heuristic") return heuristic;

  // Use the model's answer where we have one, and the on-device detector for
  // any window it couldn't classify (e.g. a network error or a bad key).
  const verdicts = record.llm[verdictKey(detector)] ?? {};
  const fromModel = Object.values(verdicts).flat();
  const uncovered = Object.keys(record.windows)
    .map(Number)
    .filter((w) => !(w in verdicts));
  const fallback = heuristic.filter((ad) =>
    uncovered.some((w) => ad.start < w + WINDOW_SECONDS && ad.end > w),
  );
  return snapToSpeech(mergeRanges([...fromModel, ...fallback], 2), segments);
}

/**
 * The last failure per provider + key, so the listener can be told their key
 * or model isn't working (detection quietly falls back to on-device).
 */
const detectorErrors = new Map<string, string>();
const errorKey = (d: Exclude<DetectorConfig, { kind: "heuristic" }>) =>
  `${verdictKey(d)}:${createHash("sha1").update(d.apiKey).digest("hex").slice(0, 12)}`;

async function classify(
  record: EpisodeRecord,
  window: number,
  detector: DetectorConfig,
  episode: EpisodeContext,
  signal?: AbortSignal,
) {
  if (detector.kind === "heuristic") return;
  const verdicts = (record.llm[verdictKey(detector)] ??= {});
  if (window in verdicts) return;

  const segments = record.windows[window] ?? [];
  const context = record.windows[window - WINDOW_SECONDS] ?? [];
  const run = detector.kind === "claude" ? classifyWithClaude : classifyWithGlm;
  try {
    verdicts[window] = await run(segments, context, detector, signal, episode);
    detectorErrors.delete(errorKey(detector));
    saveEpisode(record);
  } catch (err) {
    // A cancelled request (the listener seeked away) isn't a provider failure.
    if (!signal?.aborted && (err as Error).name !== "AbortError") {
      detectorErrors.set(errorKey(detector), (err as Error).message);
      console.warn(`[podblock] ${detector.kind} classification failed for window ${window}:`, (err as Error).message);
    }
  }
}

// --- Public API ------------------------------------------------------------------

export async function analyzeWindow(
  url: string,
  window: number,
  language: string | undefined,
  detector: DetectorConfig,
  episode: EpisodeContext,
  signal?: AbortSignal,
): Promise<AnalyzeResponse> {
  const record = await loadEpisode(url);
  const cached = window in record.windows;

  if (!cached) {
    const taskKey = `${keyFor(url)}:${window}`;
    let task = inflight.get(taskKey);
    if (!task) {
      task = new SharedTask((taskSignal) => transcribeWindow(url, window, language, taskSignal));
      inflight.set(taskKey, task);
      task.promise
        .then((segments) => {
          record.windows[window] = segments;
          saveEpisode(record);
        })
        .catch(() => {})
        .finally(() => inflight.delete(taskKey));
    }
    record.windows[window] = await task.wait(signal);
  }

  await classify(record, window, detector, episode, signal);

  return {
    window,
    segments: record.windows[window],
    ads: computeAds(record, detector, episode),
    detector: detector.kind,
    cached,
    ...(detector.kind !== "heuristic" && detectorErrors.has(errorKey(detector))
      ? { detectorError: detectorErrors.get(errorKey(detector)) }
      : {}),
  };
}

/** Everything already analyzed for an episode, without doing any new work. */
export async function cachedAnalysis(
  url: string,
  detector: DetectorConfig,
  episode: EpisodeContext,
): Promise<CachedAnalysis> {
  const record = await loadEpisode(url);
  return {
    windows: Object.keys(record.windows).map(Number).sort((a, b) => a - b),
    segments: allSegments(record),
    ads: computeAds(record, detector, episode),
    detector: detector.kind,
  };
}
