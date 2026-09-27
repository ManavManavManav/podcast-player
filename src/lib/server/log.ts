import { AsyncLocalStorage } from "node:async_hooks";
import { randomUUID } from "node:crypto";

/**
 * Structured server logs: one JSON object per line, which Vercel's log
 * viewer and `next start` output both keep, and which can be searched by
 * event, request id or any field.
 *
 *   log.info("analysis.detected", { window: 300, ads: 2, detectMs: 1400 })
 *
 * PODBLOCK_LOG_LEVEL sets the minimum level (debug, info, warn, error;
 * default info, or silent under tests). Configured secrets are redacted.
 */

type Level = "debug" | "info" | "warn" | "error";
const LEVELS: Record<Level, number> = { debug: 10, info: 20, warn: 30, error: 40 };

/** Settings whose values must never appear in logs. */
const SECRET_SETTINGS = [
  "BETTER_AUTH_SECRET",
  "PODBLOCK_SETUP_CODE",
  "TRANSCRIBE_API_KEY",
  "DETECT_API_KEY",
  "PODCAST_INDEX_API_KEY",
  "PODCAST_INDEX_API_SECRET",
  "PODCAST_INDEX_API_SECRET_BASE64",
  "DATABASE_AUTH_TOKEN",
  "GITHUB_CLIENT_SECRET",
  "GOOGLE_CLIENT_SECRET",
];

const context = new AsyncLocalStorage<{ requestId: string }>();

/** Runs `work` with a request id that every log line inside it carries. */
export function withRequestContext<T>(req: Request, work: () => Promise<T>): Promise<T> {
  const id = req.headers.get("x-request-id") || req.headers.get("x-vercel-id") || randomUUID();
  return context.run({ requestId: id }, work);
}

export function requestId(): string | undefined {
  return context.getStore()?.requestId;
}

function threshold(): number {
  const configured = process.env.PODBLOCK_LOG_LEVEL as Level | "silent" | undefined;
  if (configured && configured in LEVELS) return LEVELS[configured as Level];
  if (configured === "silent" || process.env.NODE_ENV === "test" || process.env.VITEST) return Infinity;
  return LEVELS.info;
}

function describeError(err: Error): Record<string, unknown> {
  return {
    name: err.name,
    message: err.message,
    ...("code" in err && typeof err.code === "string" ? { code: err.code } : {}),
    ...("kind" in err ? { kind: err.kind } : {}),
    ...(err.cause instanceof Error ? { cause: describeError(err.cause) } : err.cause ? { cause: String(err.cause) } : {}),
    stack: err.stack,
  };
}

function redact(text: string): string {
  let out = text;
  for (const name of SECRET_SETTINGS) {
    const value = process.env[name];
    // Short values would redact ordinary text; real secrets are long.
    if (value && value.length >= 8) out = out.split(value).join("[redacted]");
  }
  return out;
}

function write(level: Level, event: string, fields: Record<string, unknown>) {
  if (LEVELS[level] < threshold()) return;
  const entry = { time: new Date().toISOString(), level, event, requestId: requestId(), ...fields };
  const line = redact(JSON.stringify(entry, (_key, value) => (value instanceof Error ? describeError(value) : value)));
  if (LEVELS[level] >= LEVELS.warn) console.error(line);
  else console.log(line);
}

export const log = {
  debug: (event: string, fields: Record<string, unknown> = {}) => write("debug", event, fields),
  info: (event: string, fields: Record<string, unknown> = {}) => write("info", event, fields),
  warn: (event: string, fields: Record<string, unknown> = {}) => write("warn", event, fields),
  error: (event: string, fields: Record<string, unknown> = {}) => write("error", event, fields),
};
