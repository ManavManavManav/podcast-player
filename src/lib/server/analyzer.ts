import { createHash } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { WINDOW_SECONDS } from "@/lib/analysis";
import { detectAds } from "@/lib/ads/heuristic";
import { mergeRanges, snapToSpeech } from "@/lib/ads/merge";
import type { AdRange, AnalyzeResponse, DetectorKind, TranscriptSegment } from "@/lib/types";
import { extractWindow } from "@/lib/server/audio";
import { classifyWindow, claudeEnabled } from "@/lib/server/claudeDetector";
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
  /** Window start → ads Claude found in it (absent if Claude wasn't used). */
  claude: Record<number, AdRange[]>;
}

function keyFor(url: string) {
  return createHash("sha1").update(url).digest("hex").slice(0, 20);
}

// --- Cache ---------------------------------------------------------------------

const state = globalThis as unknown as {
  __podblockEpisodes?: Map<string, EpisodeRecord>;
  __podblockInflight?: Map<string, SharedTask<TranscriptSegment[]>>;
};
const episodes = (state.__podblockEpisodes ??= new Map<string, EpisodeRecord>());
const inflight = (state.__podblockInflight ??= new Map<string, SharedTask<TranscriptSegment[]>>());

async function loadEpisode(url: string): Promise<EpisodeRecord> {
  const key = keyFor(url);
  const cached = episodes.get(key);
  if (cached) {
    // Refresh LRU position.
    episodes.delete(key);
    episodes.set(key, cached);
    return cached;
  }

  let record: EpisodeRecord = { version: CACHE_VERSION, url, windows: {}, claude: {} };
  try {
    const stored = JSON.parse(await fs.readFile(path.join(CACHE_DIR, `${key}.json`), "utf-8"));
    if (stored.version === CACHE_VERSION && stored.url === url) record = stored;
  } catch {
    // Not cached yet.
  }

  episodes.set(key, record);
  if (episodes.size > MEMORY_LIMIT) episodes.delete(episodes.keys().next().value!);
  return record;
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

export function detectorKind(): DetectorKind {
  return claudeEnabled() ? "claude" : "heuristic";
}

function allSegments(record: EpisodeRecord): TranscriptSegment[] {
  return Object.keys(record.windows)
    .map(Number)
    .sort((a, b) => a - b)
    .flatMap((w) => record.windows[w]);
}

function computeAds(record: EpisodeRecord): AdRange[] {
  const segments = allSegments(record);
  const heuristic = detectAds(segments);
  if (detectorKind() === "heuristic") return heuristic;

  // Use Claude's answer where we have one, and the heuristic for any window
  // Claude couldn't classify (e.g. a network error).
  const fromClaude = Object.values(record.claude).flat();
  const uncovered = Object.keys(record.windows)
    .map(Number)
    .filter((w) => !(w in record.claude));
  const fallback = heuristic.filter((ad) =>
    uncovered.some((w) => ad.start < w + WINDOW_SECONDS && ad.end > w),
  );
  return snapToSpeech(mergeRanges([...fromClaude, ...fallback], 2), segments);
}

async function classifyWithClaude(record: EpisodeRecord, window: number, signal?: AbortSignal) {
  if (detectorKind() !== "claude" || window in record.claude) return;
  const segments = record.windows[window] ?? [];
  const context = record.windows[window - WINDOW_SECONDS] ?? [];
  try {
    record.claude[window] = await classifyWindow(segments, context, signal);
    saveEpisode(record);
  } catch (err) {
    if ((err as Error).name !== "AbortError") {
      console.warn(`[podblock] Claude classification failed for window ${window}:`, (err as Error).message);
    }
  }
}

// --- Public API ------------------------------------------------------------------

export async function analyzeWindow(
  url: string,
  window: number,
  language: string | undefined,
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

  await classifyWithClaude(record, window, signal);

  return {
    window,
    segments: record.windows[window],
    ads: computeAds(record),
    detector: detectorKind(),
    cached,
  };
}
