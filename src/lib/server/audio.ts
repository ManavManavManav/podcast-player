import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

const EXTRACT_TIMEOUT_MS = 60_000;

export function isHttpUrl(value: unknown): value is string {
  if (typeof value !== "string") return false;
  try {
    const url = new URL(value);
    return url.protocol === "http:" || url.protocol === "https:";
  } catch {
    return false;
  }
}

/**
 * Pulls `duration` seconds of audio starting at `start` straight from a
 * remote file and writes it as 16 kHz mono WAV (what Whisper consumes).
 *
 * ffmpeg seeks with HTTP range requests, so only the bytes around the window
 * are downloaded, not the whole episode. Returns the path of the WAV file;
 * the caller is responsible for deleting it.
 */
export async function extractWindow(
  url: string,
  start: number,
  duration: number,
  signal?: AbortSignal,
): Promise<string> {
  if (!isHttpUrl(url)) throw new Error("Audio URL must be http(s)");

  const dir = path.join(os.tmpdir(), "podblock");
  await fs.mkdir(dir, { recursive: true });
  const output = path.join(dir, `${randomUUID()}.wav`);

  const args = [
    "-nostdin",
    "-hide_banner",
    "-loglevel", "error",
    // Only allow network protocols, so a crafted "URL" can't read local files.
    "-protocol_whitelist", "http,https,tcp,tls,crypto",
    "-user_agent", "Podblock/1.0",
    "-reconnect", "1",
    "-reconnect_delay_max", "4",
    "-rw_timeout", "20000000",
    "-ss", String(start),
    "-t", String(duration),
    "-i", url,
    "-vn",
    "-ac", "1",
    "-ar", "16000",
    "-f", "wav",
    "-y", output,
  ];

  await new Promise<void>((resolve, reject) => {
    const ffmpeg = spawn("ffmpeg", args, { stdio: ["ignore", "ignore", "pipe"] });
    let stderr = "";
    let settled = false;

    const finish = (err?: Error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      signal?.removeEventListener("abort", onAbort);
      if (err) reject(err);
      else resolve();
    };
    const onAbort = () => {
      ffmpeg.kill("SIGKILL");
      finish(new DOMException("Aborted", "AbortError"));
    };
    const timer = setTimeout(() => {
      ffmpeg.kill("SIGKILL");
      finish(new Error("Timed out fetching audio"));
    }, EXTRACT_TIMEOUT_MS);

    if (signal?.aborted) return onAbort();
    signal?.addEventListener("abort", onAbort, { once: true });

    ffmpeg.stderr.on("data", (chunk) => {
      stderr = (stderr + chunk.toString()).slice(-2000);
    });
    ffmpeg.on("error", (err: NodeJS.ErrnoException) => {
      finish(
        err.code === "ENOENT"
          ? new Error("ffmpeg is not installed or not on PATH")
          : err,
      );
    });
    ffmpeg.on("close", (code) => {
      if (code === 0) finish();
      else finish(new Error(`ffmpeg exited with code ${code}: ${stderr.trim()}`));
    });
  }).catch(async (err) => {
    await fs.rm(output, { force: true });
    throw err;
  });

  return output;
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
export async function resolveAudioUrl(url: string): Promise<string> {
  if (!isHttpUrl(url)) throw new Error("Audio URL must be http(s)");
  const hit = resolved.get(url);
  if (hit && Date.now() - hit.at < RESOLVE_TTL_MS) return hit.url;

  let final = url;
  try {
    const res = await fetch(url, {
      headers: { Range: "bytes=0-0", "User-Agent": "Podblock/1.0" },
      redirect: "follow",
      signal: AbortSignal.timeout(10_000),
    });
    await res.body?.cancel();
    if (res.ok && isHttpUrl(res.url)) final = res.url;
  } catch {
    // Use the original URL.
  }

  resolved.set(url, { url: final, at: Date.now() });
  if (resolved.size > 500) resolved.delete(resolved.keys().next().value!);
  return final;
}

let ffmpegCheck: Promise<boolean> | null = null;

export function ffmpegAvailable(): Promise<boolean> {
  ffmpegCheck ??= new Promise((resolve) => {
    const proc = spawn("ffmpeg", ["-version"], { stdio: "ignore" });
    proc.on("error", () => resolve(false));
    proc.on("close", (code) => resolve(code === 0));
  });
  return ffmpegCheck;
}
