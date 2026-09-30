import { NextResponse, type NextRequest } from "next/server";
import { WINDOW_SECONDS, whisperLanguage } from "@/lib/analysis";
import { analyzeWindow, cachedAnalysis } from "@/lib/server/analyzer";
import { AppError, publicError } from "@/lib/server/errors";
import { log, withRequestContext } from "@/lib/server/log";
import { isHttpUrl } from "@/lib/server/audio";
import { isPublicUrl, rejectCrossSite } from "@/lib/server/guard";
import { requireUser } from "@/lib/server/session";
import type { EpisodeContext } from "@/lib/types";

/** Fetching, transcribing and classifying a window takes seconds; allow for slow hosts. */
export const maxDuration = 120;
/** Give up with time to answer before the platform stops the function mid-write. */
const DEADLINE_MS = (maxDuration - 10) * 1000;
/** Transcripts are saved as soon as they're done, so a retry picks up where this left off. */
const RETRY_AFTER_SECONDS = 10;

/** A signal that aborts after `ms`, with a timer that can be cleared. */
function deadline(ms: number) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(new DOMException("Analysis deadline passed", "TimeoutError")), ms);
  return { signal: controller.signal, clear: () => clearTimeout(timer) };
}

/** 12 hours: longer than any real episode, short enough to reject junk. */
const MAX_START = 12 * 3600;

/** Episode details from the client. Only hints for the detector, so just bounded. */
function episodeContext(input: Record<string, unknown> | URLSearchParams): EpisodeContext {
  const get = (key: string) => (input instanceof URLSearchParams ? input.get(key) : input[key]);
  const text = (value: unknown) => (typeof value === "string" && value.trim() ? value.trim().slice(0, 300) : undefined);
  const website = text(get("website"));
  return {
    podcastTitle: text(get("podcastTitle")),
    episodeTitle: text(get("episodeTitle")),
    website: website && isHttpUrl(website) ? website : undefined,
  };
}

/** What's already known about an episode, so a returning listener sees it at once. */
export async function GET(req: NextRequest) {
  const user = await requireUser();
  if (user instanceof NextResponse) return user;

  const url = req.nextUrl.searchParams.get("url");
  if (!isHttpUrl(url)) {
    return NextResponse.json({ error: "`url` must be an http(s) URL" }, { status: 400 });
  }
  return NextResponse.json(await cachedAnalysis(url));
}

/** Analyzes one window of an episode (or returns it from the cache). */
export function POST(req: NextRequest) {
  return withRequestContext(req, () => analyze(req));
}

async function analyze(req: NextRequest) {
  const refused = rejectCrossSite(req);
  if (refused) return refused;
  const user = await requireUser();
  if (user instanceof NextResponse) return user;

  let body: { url?: unknown; window?: unknown; language?: unknown; episode?: unknown };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const { url, window, language } = body;
  if (!isHttpUrl(url)) {
    return NextResponse.json({ error: "`url` must be an http(s) URL" }, { status: 400 });
  }
  if (
    typeof window !== "number" ||
    !Number.isInteger(window) ||
    window < 0 ||
    window > MAX_START ||
    window % WINDOW_SECONDS !== 0
  ) {
    return NextResponse.json(
      { error: `\`window\` must be a multiple of ${WINDOW_SECONDS}` },
      { status: 400 },
    );
  }
  if (!(await isPublicUrl(url))) {
    return NextResponse.json({ error: "Audio must be on a public host" }, { status: 400 });
  }

  const limit = deadline(DEADLINE_MS);
  try {
    const result = await analyzeWindow(
      url,
      window,
      whisperLanguage(typeof language === "string" ? language : undefined),
      episodeContext(body.episode && typeof body.episode === "object" ? (body.episode as Record<string, unknown>) : {}),
      user.id,
      AbortSignal.any([req.signal, limit.signal]),
    );
    return NextResponse.json(result);
  } catch (err) {
    const error = err as Error;
    if (req.signal.aborted) {
      // The player moved on; nobody is listening for this response.
      return new NextResponse(null, { status: 499 });
    }
    if (error.name === "AbortError" || error.name === "TimeoutError") {
      // Out of time, or shared work was cancelled under us: worth retrying.
      const { status, body } = publicError(new AppError("timeout", `Analysis stopped: ${error.message}`));
      log.warn("analysis.stopped", { window, userId: user.id, reason: limit.signal.aborted ? "deadline" : error.message });
      return NextResponse.json(body, { status, headers: { "Retry-After": String(RETRY_AFTER_SECONDS) } });
    }
    // Full details for the log; the listener gets a message meant for them.
    const { status, body, retryAfterSeconds } = publicError(err);
    log.error("analysis.failed", { window, userId: user.id, code: body.code, err: error });
    const headers = retryAfterSeconds === undefined ? undefined : { "Retry-After": String(retryAfterSeconds) };
    return NextResponse.json(body, { status, headers });
  } finally {
    limit.clear();
  }
}
