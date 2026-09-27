import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import http from "node:http";
import type { AddressInfo } from "node:net";
import { Readable } from "node:stream";
import ffmpegStatic from "ffmpeg-static";
import { canFastSeek, headBytesNeeded } from "@/lib/server/audioFormat";
import { AppError } from "@/lib/server/errors";
import { fetchPublic } from "@/lib/server/safeFetch";

const EXTRACT_TIMEOUT_MS = 90_000;
/** Far more than a window of 16 kHz mono FLAC needs; stops a runaway stream. */
const MAX_OUTPUT_BYTES = 24 * 1024 * 1024;

/** FFMPEG_PATH if set, otherwise the static binary installed with the app (so it runs on Vercel). */
export const ffmpegPath = process.env.FFMPEG_PATH || ffmpegStatic || "";

export function isHttpUrl(value: unknown): value is string {
  if (typeof value !== "string") return false;
  try {
    const url = new URL(value);
    return url.protocol === "http:" || url.protocol === "https:";
  } catch {
    return false;
  }
}

/** Response headers ffmpeg needs to seek with range requests. */
const PASSED_HEADERS = ["content-type", "content-length", "content-range", "accept-ranges"];

/**
 * Runs `work` with a loopback URL that proxies range requests to `url`.
 *
 * ffmpeg does its own seeking, but the static builds that run on Vercel
 * crash resolving hostnames. So Node does all the networking (DNS, TLS,
 * redirects, the public-address check at connect time) and ffmpeg only
 * talks to 127.0.0.1.
 */
async function withLoopbackProxy<T>(url: string, signal: AbortSignal, work: (localUrl: string) => Promise<T>): Promise<T> {
  const path = `/${randomUUID()}`;
  const server = http.createServer(async (req, res) => {
    if (req.url !== path || req.method !== "GET") {
      res.writeHead(404).end();
      return;
    }
    const upstream = new AbortController();
    const abort = () => upstream.abort();
    res.on("close", abort);
    signal.addEventListener("abort", abort, { once: true });
    try {
      const headers: Record<string, string> = { "User-Agent": "Podblock/1.0" };
      if (req.headers.range) headers.Range = req.headers.range;
      const { response: remote } = await fetchPublic(url, { headers, signal: upstream.signal });
      const passed = Object.fromEntries(
        PASSED_HEADERS.flatMap((name) => (remote.headers.has(name) ? [[name, remote.headers.get(name)!]] : [])),
      );
      res.writeHead(remote.status, passed);
      if (!remote.body) return void res.end();
      Readable.fromWeb(remote.body as import("node:stream/web").ReadableStream).on("error", () => res.destroy()).pipe(res);
    } catch {
      if (!res.headersSent) res.writeHead(502);
      res.end();
    } finally {
      signal.removeEventListener("abort", abort);
    }
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  try {
    const { port } = server.address() as AddressInfo;
    return await work(`http://127.0.0.1:${port}${path}`);
  } finally {
    server.closeAllConnections();
    server.close();
  }
}

// --- Choosing how to seek ------------------------------------------------------------

const seekModes = (globalThis as unknown as { __podblockSeek?: Map<string, boolean> }).__podblockSeek ??= new Map();

/** Reads at most `limit` bytes of a response body, then stops the download. */
async function readUpTo(response: Response, limit: number): Promise<Buffer> {
  const chunks: Buffer[] = [];
  let size = 0;
  const reader = response.body?.getReader();
  if (!reader) return Buffer.alloc(0);
  while (size < limit) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(Buffer.from(value));
    size += value.length;
  }
  await reader.cancel().catch(() => {});
  return Buffer.concat(chunks).subarray(0, limit);
}

/**
 * Whether ffmpeg may jump straight to a window in this file (see
 * audioFormat.ts), from its first bytes. Remembered per URL; any doubt
 * means the exact read.
 */
async function fastSeekable(url: string, signal: AbortSignal): Promise<boolean> {
  const known = seekModes.get(url);
  if (known !== undefined) return known;
  const read = async (bytes: number) => {
    const { response } = await fetchPublic(url, {
      headers: { Range: `bytes=0-${bytes - 1}`, "User-Agent": "Podblock/1.0" },
      signal,
    });
    if (!response.ok) throw new Error(`Probe failed (${response.status})`);
    return readUpTo(response, bytes);
  };
  let head = await read(64 * 1024);
  const needed = headBytesNeeded(head.subarray(0, 16));
  if (needed > head.length && head.length === 64 * 1024) head = await read(needed);
  const fast = canFastSeek(head);
  seekModes.set(url, fast);
  if (seekModes.size > 500) seekModes.delete(seekModes.keys().next().value!);
  return fast;
}

/**
 * Pulls `duration` seconds of audio starting at `start` straight from a
 * remote file, as 16 kHz mono FLAC: lossless for speech recognition, and
 * about half the size of WAV to upload.
 *
 * ffmpeg reads the file with HTTP range requests. For files it can seek
 * exactly by byte offset (constant-bitrate MP3, M4A) it jumps to the
 * window; otherwise it reads from the start, which keeps timestamps exact
 * (docs/seek-accuracy.md).
 */
export async function extractWindow(
  url: string,
  start: number,
  duration: number,
  signal?: AbortSignal,
): Promise<Buffer> {
  if (!isHttpUrl(url)) throw new AppError("audio", "Audio URL must be http(s)");
  // A listener added to an already-aborted signal would never fire.
  if (signal?.aborted) throw new DOMException("Aborted", "AbortError");
  const controller = new AbortController();
  const stop = () => controller.abort();
  signal?.addEventListener("abort", stop, { once: true });
  try {
    // The first window needs no seeking; after that, probing once per file is cheap.
    const fast = start > 0 && (await fastSeekable(url, controller.signal).catch(() => false));
    return await withLoopbackProxy(url, controller.signal, (localUrl) =>
      runFfmpeg(localUrl, start, duration, controller.signal, fast),
    );
  } catch (err) {
    if ((err as Error).name === "AbortError" || err instanceof AppError) throw err;
    throw new AppError("audio", (err as Error).message, { cause: err });
  } finally {
    signal?.removeEventListener("abort", stop);
    controller.abort();
  }
}

/**
 * False for a FLAC stream that's only metadata, which is what ffmpeg writes
 * when asked for audio past the end of a file. True when unsure.
 */
export function hasAudioFrames(flac: Buffer): boolean {
  if (flac.subarray(0, 4).toString("latin1") !== "fLaC") return true;
  let offset = 4;
  for (;;) {
    if (offset + 4 > flac.length) return true; // truncated: can't tell
    const header = flac[offset];
    offset += 4 + flac.readUIntBE(offset + 1, 3);
    if (header & 0x80) return offset < flac.length; // last metadata block: frames follow, if any
  }
}

function runFfmpeg(input: string, start: number, duration: number, signal: AbortSignal, fastSeek = false): Promise<Buffer> {
  const args = [
    "-nostdin",
    "-hide_banner",
    "-loglevel", "error",
    // Only plain HTTP to the loopback proxy, so a crafted input can't read local files.
    "-protocol_whitelist", "http,tcp",
    "-reconnect", "1",
    "-reconnect_delay_max", "4",
    "-rw_timeout", "20000000",
    // Jump by byte offset, only where that's exact (see fastSeekable).
    ...(fastSeek ? ["-fflags", "+fastseek"] : []),
    "-ss", String(start),
    "-t", String(duration),
    "-i", input,
    "-vn",
    "-ac", "1",
    "-ar", "16000",
    // 16-bit is plenty for speech; the encoder would otherwise pick 24-bit.
    "-sample_fmt", "s16",
    "-c:a", "flac",
    "-f", "flac",
    "pipe:1",
  ];

  return new Promise<Buffer>((resolve, reject) => {
    // The binary ships via outputFileTracingIncludes (next.config.ts); don't trace the spawn itself.
    const ffmpeg = spawn(/*turbopackIgnore: true*/ ffmpegPath, args, { stdio: ["ignore", "pipe", "pipe"] });
    const chunks: Buffer[] = [];
    let size = 0;
    let stderr = "";
    let settled = false;

    const finish = (err: Error | null, output?: Buffer) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      signal?.removeEventListener("abort", onAbort);
      if (err) {
        ffmpeg.kill("SIGKILL");
        reject(err);
      } else resolve(output!);
    };
    const onAbort = () => finish(new DOMException("Aborted", "AbortError"));
    const timer = setTimeout(() => finish(new Error("Timed out fetching audio")), EXTRACT_TIMEOUT_MS);

    if (signal?.aborted) return onAbort();
    signal?.addEventListener("abort", onAbort, { once: true });

    ffmpeg.stdout.on("data", (chunk: Buffer) => {
      size += chunk.length;
      if (size > MAX_OUTPUT_BYTES) return finish(new Error("Audio window is unexpectedly large"));
      chunks.push(chunk);
    });
    ffmpeg.stderr.on("data", (chunk) => {
      stderr = (stderr + chunk.toString()).slice(-2000);
    });
    ffmpeg.on("error", (err: NodeJS.ErrnoException) => {
      finish(err.code === "ENOENT" ? new Error(`ffmpeg not found at ${ffmpegPath}`) : err);
    });
    ffmpeg.on("close", (code, killedBy) => {
      if (code !== 0) return finish(new Error(`ffmpeg failed (${killedBy ?? `exit ${code}`}): ${stderr.trim()}`));
      if (size === 0) return finish(new Error("No audio at this position"));
      finish(null, Buffer.concat(chunks));
    });
  });
}

// --- Pinning a dynamic-ad-insertion variant ---------------------------------------

const RESOLVE_TTL_MS = 2 * 3600_000;
const resolved = (globalThis as unknown as { __podblockResolved?: Map<string, { url: string; at: number }> })
  .__podblockResolved ??= new Map();

/**
 * Follows an episode's tracking redirects to the file actually served.
 *
 * Hosts that insert ads dynamically stitch a different set of ads into the
 * file for each request, which shifts every timestamp after them. The final
 * URL of the redirect chain names one stitched variant, so the player and the
 * analyzer both use it: that way the ads found are the ads being heard.
 * Falls back to the original URL if the host doesn't cooperate.
 */
export async function resolveAudioUrl(url: string, { fresh = false }: { fresh?: boolean } = {}): Promise<string> {
  if (!isHttpUrl(url)) throw new Error("Audio URL must be http(s)");
  const hit = resolved.get(url);
  // `fresh`: the remembered link stopped working (e.g. a signed URL expired).
  if (!fresh && hit && Date.now() - hit.at < RESOLVE_TTL_MS) return hit.url;

  let final = url;
  try {
    // Every hop is checked, so a redirect can't make the server request an internal address.
    const { response, url: answered } = await fetchPublic(url, {
      headers: { Range: "bytes=0-0", "User-Agent": "Podblock/1.0" },
      signal: AbortSignal.timeout(10_000),
    });
    await response.body?.cancel();
    if (response.ok && isHttpUrl(answered)) final = answered;
  } catch {
    // Use the original URL.
  }

  resolved.set(url, { url: final, at: Date.now() });
  if (resolved.size > 500) resolved.delete(resolved.keys().next().value!);
  return final;
}
