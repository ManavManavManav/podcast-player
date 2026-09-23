import { NextResponse } from "next/server";
import type { HealthResponse } from "@/lib/types";
import { detectorKind } from "@/lib/server/analyzer";
import { ffmpegAvailable } from "@/lib/server/audio";
import { hasPodcastIndexCredentials } from "@/lib/server/podcastIndex";
import { whisper, whisperModel } from "@/lib/server/whisper";

export const dynamic = "force-dynamic";

export async function GET() {
  const [ffmpeg, python] = await Promise.all([ffmpegAvailable(), whisper.resolvePython()]);
  const podcastIndex = hasPodcastIndexCredentials();
  const whisperOk = Boolean(python) && !whisper.lastError;

  const body: HealthResponse = {
    ok: ffmpeg && whisperOk && podcastIndex,
    podcastIndex,
    ffmpeg,
    whisper: {
      ok: whisperOk,
      python,
      model: whisperModel,
      ...(whisper.lastError
        ? { error: whisper.lastError }
        : python
          ? {}
          : { error: "No Python with openai-whisper found" }),
    },
    detector: detectorKind(),
  };
  return NextResponse.json(body);
}
