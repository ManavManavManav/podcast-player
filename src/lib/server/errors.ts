/**
 * Errors that know what listeners may be told. The message is for the
 * server's log (it can hold ffmpeg output, provider responses, paths); the
 * public message is what the API sends back.
 */

export type ErrorKind = "config" | "audio" | "transcription" | "detection" | "timeout" | "rate_limit";

const PUBLIC_MESSAGES: Record<ErrorKind, string> = {
  config: "Ad detection isn't set up on this server yet.",
  audio: "Couldn't read this part of the episode's audio.",
  transcription: "The transcription service didn't answer. Trying again shortly.",
  detection: "The ad detector didn't answer. Trying again shortly.",
  timeout: "This part of the episode is taking longer than usual. Trying again shortly.",
  rate_limit: "Transcription has hit its hourly limit. Picking up again as soon as it resets.",
};

/** Kinds that mean "try again later" rather than "the upstream service failed". */
const UNAVAILABLE: ErrorKind[] = ["config", "timeout", "rate_limit"];

export class AppError extends Error {
  readonly publicMessage: string;
  /** How long until retrying can succeed, when the provider said. */
  readonly retryAfterMs?: number;

  constructor(
    readonly kind: ErrorKind,
    message: string,
    options: { publicMessage?: string; cause?: unknown; retryAfterMs?: number } = {},
  ) {
    super(message, { cause: options.cause });
    this.name = "AppError";
    this.publicMessage = options.publicMessage ?? PUBLIC_MESSAGES[kind];
    this.retryAfterMs = options.retryAfterMs;
  }
}

/** What an API route sends back for a failure: its public message and kind, never internal details. */
export function publicError(err: unknown): {
  status: number;
  body: { error: string; code: string };
  /** For a Retry-After header, when the error knows how long to wait. */
  retryAfterSeconds?: number;
} {
  if (err instanceof AppError) {
    return {
      status: UNAVAILABLE.includes(err.kind) ? 503 : 502,
      body: { error: err.publicMessage, code: err.kind },
      retryAfterSeconds: err.retryAfterMs === undefined ? undefined : Math.ceil(err.retryAfterMs / 1000),
    };
  }
  return { status: 502, body: { error: "Something went wrong analyzing this part of the episode.", code: "internal" } };
}
