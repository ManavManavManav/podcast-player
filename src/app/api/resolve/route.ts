import { NextResponse, type NextRequest } from "next/server";
import { isHttpUrl, resolveAudioUrl } from "@/lib/server/audio";
import { isPublicUrl, rejectCrossSite } from "@/lib/server/guard";

/** Pins the stitched variant of an episode that both playback and analysis use. */
export async function POST(req: NextRequest) {
  const refused = rejectCrossSite(req);
  if (refused) return refused;

  const body = await req.json().catch(() => ({}));
  if (!isHttpUrl(body.url) || !(await isPublicUrl(body.url))) {
    return NextResponse.json({ error: "`url` must be a public http(s) URL" }, { status: 400 });
  }
  const resolved = await resolveAudioUrl(body.url);
  // A redirect could point somewhere internal; only hand back public URLs.
  return NextResponse.json({ url: (await isPublicUrl(resolved)) ? resolved : body.url });
}
