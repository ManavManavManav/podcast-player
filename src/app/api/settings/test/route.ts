import { NextResponse, type NextRequest } from "next/server";
import { rejectCrossSite } from "@/lib/server/guard";
import { classifyWithClaude } from "@/lib/server/llm/claude";
import { classifyWithGlm } from "@/lib/server/llm/glm";
import { requireUser } from "@/lib/server/session";
import { detectorFor, getSettings, saveSettings, validateUpdate } from "@/lib/server/settings";

/** A two-line transcript with an obvious ad, to check a key and model work. */
const SAMPLE = [
  { start: 0, end: 4, text: "This episode is brought to you by Acme Mattress." },
  { start: 4, end: 9, text: "Go to acme.com slash show and use code SHOW for 20% off your first order." },
  { start: 9, end: 13, text: "Okay, back to the interview." },
];

/**
 * Saves the given settings, then runs one tiny classification with the chosen
 * provider so the user finds out right away whether their key and model work.
 */
export async function POST(req: NextRequest) {
  const refused = rejectCrossSite(req);
  if (refused) return refused;
  const user = await requireUser();
  if (user instanceof NextResponse) return user;

  const update = validateUpdate(await req.json().catch(() => null));
  if (typeof update === "string") return NextResponse.json({ ok: false, error: update }, { status: 400 });
  saveSettings(user.id, update);

  const settings = getSettings(user.id);
  const detector = detectorFor(user.id);
  if (settings.detector === "heuristic") {
    return NextResponse.json({ ok: true, message: "On-device detection needs no key." });
  }
  if (detector.kind === "heuristic") {
    return NextResponse.json({ ok: false, error: "Add an API key for this provider first." });
  }

  const started = Date.now();
  try {
    const run = detector.kind === "claude" ? classifyWithClaude : classifyWithGlm;
    const ads = await run(SAMPLE, [], detector, AbortSignal.timeout(45_000));
    const ms = Date.now() - started;
    return ads.length
      ? NextResponse.json({ ok: true, message: `Working: ${detector.model} found the test ad in ${(ms / 1000).toFixed(1)}s.` })
      : NextResponse.json({
          ok: false,
          error: `${detector.model} answered but missed an obvious ad. It may be too small for this job.`,
        });
  } catch (err) {
    return NextResponse.json({ ok: false, error: (err as Error).message });
  }
}
