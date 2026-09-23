import { NextResponse, type NextRequest } from "next/server";
import { WINDOW_SECONDS, whisperLanguage } from "@/lib/analysis";
import { analyzeWindow, cachedAnalysis } from "@/lib/server/analyzer";
import { isHttpUrl } from "@/lib/server/audio";
import { isPublicUrl, rejectCrossSite } from "@/lib/server/guard";

/** 12 hours: longer than any real episode, short enough to reject junk. */
const MAX_START = 12 * 3600;

/** What's already known about an episode, so a returning listener sees it at once. */
export async function GET(req: NextRequest) {
  const url = req.nextUrl.searchParams.get("url");
  if (!isHttpUrl(url)) {
    return NextResponse.json({ error: "`url` must be an http(s) URL" }, { status: 400 });
  }
  return NextResponse.json(await cachedAnalysis(url));
}

/** Analyzes one window of an episode (or returns it from the cache). */
export async function POST(req: NextRequest) {
  const refused = rejectCrossSite(req);
  if (refused) return refused;

  let body: { url?: unknown; window?: unknown; language?: unknown };
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

  try {
    const result = await analyzeWindow(
      url,
      window,
      whisperLanguage(typeof language === "string" ? language : undefined),
      req.signal,
    );
    return NextResponse.json(result);
  } catch (err) {
    const error = err as Error;
    if (error.name === "AbortError") {
      // The player moved on; nobody is listening for this response.
      return new NextResponse(null, { status: 499 });
    }
    console.error("[podblock] analysis failed:", error.message);
    return NextResponse.json({ error: error.message }, { status: 502 });
  }
}
