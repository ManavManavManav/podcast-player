import type { TranscriptSegment } from "@/lib/types";
import type { ApiConfig } from "@/lib/server/config";

/**
 * Speech-to-text through any OpenAI-compatible `/audio/transcriptions`
 * endpoint (Groq, DeepInfra, OpenAI…), with segment timestamps: the ad
 * detector reports ads as times taken from them.
 */

/** Whisper's own "this is probably silence" score; above it, segments are usually hallucinated. */
const NO_SPEECH_THRESHOLD = 0.8;
const TIMEOUT_MS = 90_000;

interface VerboseSegment {
  start?: number;
  end?: number;
  text?: string;
  no_speech_prob?: number;
}

interface VerboseTranscription {
  duration?: number;
  segments?: VerboseSegment[];
  error?: { message?: string } | string;
}

export interface Transcription {
  /** In episode time, clamped to the window. */
  segments: TranscriptSegment[];
  /** Seconds of audio sent, for usage accounting. */
  audioSeconds: number;
}

/** Converts a verbose_json response into episode-time segments within the window. */
export function parseTranscription(body: VerboseTranscription, start: number, windowSeconds: number): TranscriptSegment[] {
  const round = (t: number) => Math.round(t * 100) / 100;
  return (body.segments ?? [])
    .filter((s) => typeof s.start === "number" && typeof s.end === "number")
    .filter((s) => (s.no_speech_prob ?? 0) <= NO_SPEECH_THRESHOLD)
    .map((s) => ({
      start: round(start + Math.max(0, s.start!)),
      end: round(start + Math.min(s.end!, windowSeconds)),
      text: (s.text ?? "").trim(),
    }))
    .filter((s) => s.text && s.end > s.start);
}

export async function transcribe(
  audio: Buffer,
  start: number,
  windowSeconds: number,
  language: string | undefined,
  config: ApiConfig,
  signal?: AbortSignal,
): Promise<Transcription> {
  const form = new FormData();
  form.append("file", new Blob([new Uint8Array(audio)], { type: "audio/flac" }), "window.flac");
  form.append("model", config.model);
  form.append("response_format", "verbose_json");
  form.append("timestamp_granularities[]", "segment");
  form.append("temperature", "0");
  if (language) form.append("language", language);

  const timeout = AbortSignal.timeout(TIMEOUT_MS);
  const res = await fetch(`${config.baseUrl}/audio/transcriptions`, {
    method: "POST",
    headers: { Authorization: `Bearer ${config.apiKey}` },
    body: form,
    signal: signal ? AbortSignal.any([signal, timeout]) : timeout,
  });
  const body = (await res.json().catch(() => ({}))) as VerboseTranscription;
  if (!res.ok) {
    const message = typeof body.error === "string" ? body.error : body.error?.message;
    throw new Error(`Transcription failed (${res.status}): ${message ?? res.statusText}`);
  }
  if (!Array.isArray(body.segments)) {
    throw new Error("The transcription API didn't return timestamps (it needs to support verbose_json)");
  }
  return {
    segments: parseTranscription(body, start, windowSeconds),
    audioSeconds: Math.min(windowSeconds, body.duration ?? windowSeconds),
  };
}
