import { NextResponse, type NextRequest } from "next/server";
import { isHttpUrl, resolveAudioUrl } from "@/lib/server/audio";

/** Pins the stitched variant of an episode that both playback and analysis use. */
export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => ({}));
  if (!isHttpUrl(body.url)) {
    return NextResponse.json({ error: "`url` must be an http(s) URL" }, { status: 400 });
  }
  return NextResponse.json({ url: await resolveAudioUrl(body.url) });
}
