import { createHash } from "node:crypto";
import { WINDOW_SECONDS } from "@/lib/analysis";
import { mergeRanges, snapToSpeech } from "@/lib/ads/merge";
import type { AdRange, AnalyzeResponse, CachedAnalysis, EpisodeContext, TranscriptSegment } from "@/lib/types";
import { extractWindow } from "@/lib/server/audio";
import { detectConfig, transcribeConfig, type ApiConfig } from "@/lib/server/config";
import { getDb } from "@/lib/server/db";
import { AppError } from "@/lib/server/errors";
import { detectAds } from "@/lib/server/llm/detect";
import { PROMPT_VERSION } from "@/lib/server/llm/prompt";
import { transcribe } from "@/lib/server/transcribe";
import { usageStatement } from "@/lib/server/usage";

/**
 * Transcribes and checks episodes for ads one window at a time. Transcripts
 * and verdicts are stored in the database, shared by every listener, so no
 * one pays twice for the same minutes of an episode.
 */

function keyFor(url: string) {
  return createHash("sha1").update(url).digest("hex").slice(0, 20);
}

/** Verdicts from another model or older instructions are redone, not reused. */
function detectorKey(config: ApiConfig) {
  return `${config.model}:p${PROMPT_VERSION}`;
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

  /** Cancelled, though possibly still winding down: not worth joining. */
  get cancelled(): boolean {
    return this.controller.signal.aborted;
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

const inflight = ((globalThis as unknown as { __podblockInflight?: Map<string, SharedTask<unknown>> })
  .__podblockInflight ??= new Map());

/** Runs `work` once per key at a time; concurrent callers share the result. */
function shared<T>(key: string, work: (signal: AbortSignal) => Promise<T>, signal?: AbortSignal): Promise<T> {
  let task = inflight.get(key) as SharedTask<T> | undefined;
  if (!task || task.cancelled) {
    const created = new SharedTask(work);
    task = created;
    inflight.set(key, created as SharedTask<unknown>);
    // Only remove this task's entry: a replacement may have taken the key.
    created.promise
      .catch(() => {})
      .finally(() => {
        if (inflight.get(key) === created) inflight.delete(key);
      });
  }
  return task.wait(signal);
}

// --- Storage ---------------------------------------------------------------------

async function storedSegments(urlKey: string, start: number): Promise<TranscriptSegment[] | null> {
  const db = await getDb();
  const { rows } = await db.execute({
    sql: "SELECT segments FROM analysis_window WHERE url_key = ? AND start = ?",
    args: [urlKey, start],
  });
  return rows.length ? (JSON.parse(String(rows[0].segments)) as TranscriptSegment[]) : null;
}

async function storedVerdict(urlKey: string, start: number, detector: string): Promise<AdRange[] | null> {
  const db = await getDb();
  const { rows } = await db.execute({
    sql: "SELECT ads FROM analysis_verdict WHERE url_key = ? AND start = ? AND detector = ?",
    args: [urlKey, start, detector],
  });
  return rows.length ? (JSON.parse(String(rows[0].ads)) as AdRange[]) : null;
}

/** Every window of an episode that has both a transcript and this detector's verdict. */
async function episodeAnalysis(urlKey: string, detector: string) {
  const db = await getDb();
  const { rows } = await db.execute({
    sql: `SELECT w.start, w.segments, v.ads FROM analysis_window w
          JOIN analysis_verdict v ON v.url_key = w.url_key AND v.start = w.start AND v.detector = ?
          WHERE w.url_key = ? ORDER BY w.start`,
    args: [detector, urlKey],
  });
  const windows = rows.map((row) => Number(row.start));
  const segments = rows.flatMap((row) => JSON.parse(String(row.segments)) as TranscriptSegment[]);
  const found = rows.flatMap((row) => JSON.parse(String(row.ads)) as AdRange[]);
  // Ads split across a window boundary become one; skips land where speech resumes.
  const ads = snapToSpeech(mergeRanges(found, 2), segments);
  return { windows, segments, ads };
}

// --- The two steps -----------------------------------------------------------------

async function transcribeWindow(
  url: string,
  urlKey: string,
  start: number,
  language: string | undefined,
  userId: string,
  signal?: AbortSignal,
): Promise<TranscriptSegment[]> {
  const cached = await storedSegments(urlKey, start);
  if (cached) return cached;

  const config = transcribeConfig();
  if (!config) throw new AppError("config", "Transcription isn't configured on this server (TRANSCRIBE_API_KEY)");

  return shared(
    `t:${urlKey}:${start}`,
    async (taskSignal) => {
      const audio = await extractWindow(url, start, WINDOW_SECONDS, taskSignal);
      const { segments, audioSeconds } = await transcribe(audio, start, WINDOW_SECONDS, language, config, taskSignal);
      const db = await getDb();
      // One transaction: the transcript is only kept with the usage it cost.
      await db.batch(
        [
          {
            sql: `INSERT OR REPLACE INTO analysis_window (url_key, start, url, segments, created_at) VALUES (?, ?, ?, ?, ?)`,
            args: [urlKey, start, url, JSON.stringify(segments), Date.now()],
          },
          usageStatement(userId, { audioSeconds }),
        ],
        "write",
      );
      return segments;
    },
    signal,
  );
}

async function classifyWindow(
  urlKey: string,
  start: number,
  segments: TranscriptSegment[],
  episode: EpisodeContext,
  config: ApiConfig,
  userId: string,
  signal?: AbortSignal,
): Promise<void> {
  const detector = detectorKey(config);
  if (await storedVerdict(urlKey, start, detector)) return;

  await shared(
    `d:${urlKey}:${start}:${detector}`,
    async (taskSignal) => {
      // The end of the previous window, if it's been transcribed, so an ad
      // running across the boundary is recognized.
      const context = (await storedSegments(urlKey, start - WINDOW_SECONDS)) ?? [];
      const result = await detectAds(segments, context, episode, config, taskSignal);
      const db = await getDb();
      await db.batch(
        [
          {
            sql: `INSERT OR REPLACE INTO analysis_verdict (url_key, start, detector, ads, created_at) VALUES (?, ?, ?, ?, ?)`,
            args: [urlKey, start, detector, JSON.stringify(result.ads), Date.now()],
          },
          // An empty window never reaches the detector, so costs nothing.
          ...(segments.length > 0
            ? [usageStatement(userId, { detectCalls: 1, inputTokens: result.inputTokens, outputTokens: result.outputTokens })]
            : []),
        ],
        "write",
      );
    },
    signal,
  );
}

// --- Public API ------------------------------------------------------------------

/**
 * Transcribes one window and finds its ads (or returns them from the
 * database). A failed detection throws; the transcript is kept, so a retry
 * only redoes the detection.
 */
export async function analyzeWindow(
  url: string,
  window: number,
  language: string | undefined,
  episode: EpisodeContext,
  userId: string,
  signal?: AbortSignal,
): Promise<AnalyzeResponse> {
  const config = detectConfig();
  if (!config) throw new AppError("config", "Ad detection isn't configured on this server (DETECT_API_KEY)");

  const urlKey = keyFor(url);
  const detector = detectorKey(config);
  const cached = Boolean(await storedVerdict(urlKey, window, detector));

  const segments = await transcribeWindow(url, urlKey, window, language, userId, signal);
  await classifyWindow(urlKey, window, segments, episode, config, userId, signal);

  const { ads } = await episodeAnalysis(urlKey, detector);
  return { window, segments, ads, cached };
}

/** Everything already analyzed for an episode, without doing any new work. */
export async function cachedAnalysis(url: string): Promise<CachedAnalysis> {
  const config = detectConfig();
  if (!config) return { windows: [], segments: [], ads: [] };
  return episodeAnalysis(keyFor(url), detectorKey(config));
}
