import { execFileSync, spawnSync } from "node:child_process";
import fs from "node:fs";
import http from "node:http";
import type { AddressInfo } from "node:net";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

// The fixture server runs on 127.0.0.1, which the real guard (rightly)
// refuses. Every address counts as public here; the guard has its own tests.
const guard = vi.hoisted(() => ({ allow: ((_address: string) => true) as (address: string) => boolean }));
vi.mock("@/lib/server/guard", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/server/guard")>()),
  isPublicUrl: async () => true,
  isPublicAddress: (address: string) => guard.allow(address),
}));

const { extractWindow, ffmpegPath, resolveAudioUrl } = await import("@/lib/server/audio");
const { AppError } = await import("@/lib/server/errors");

const FIXTURE_SECONDS = 20;
let dir: string;
let fixture: Buffer;
let server: http.Server;
let base: string;
let requests: Array<{ url: string; range?: string }> = [];

/** Serves the fixture with range support, plus redirects. */
function serve(req: http.IncomingMessage, res: http.ServerResponse) {
  requests.push({ url: req.url ?? "", range: req.headers.range });
  if (req.url === "/stall.mp3") {
    res.writeHead(200, { "content-type": "audio/mpeg" });
    res.write(fixture.subarray(0, 1024)); // then never finishes
    return;
  }
  if (req.url?.startsWith("/redirect")) {
    res.writeHead(302, { location: "/episode.mp3" }).end();
    return;
  }
  if (req.url !== "/episode.mp3") {
    res.writeHead(404).end();
    return;
  }
  const range = req.headers.range?.match(/bytes=(\d+)-(\d*)/);
  if (range) {
    const start = Number(range[1]);
    const end = range[2] ? Math.min(Number(range[2]), fixture.length - 1) : fixture.length - 1;
    res.writeHead(206, {
      "content-type": "audio/mpeg",
      "accept-ranges": "bytes",
      "content-length": end - start + 1,
      "content-range": `bytes ${start}-${end}/${fixture.length}`,
    });
    res.end(fixture.subarray(start, end + 1));
  } else {
    res.writeHead(200, { "content-type": "audio/mpeg", "accept-ranges": "bytes", "content-length": fixture.length });
    res.end(fixture);
  }
}

/** Seconds of audio in a FLAC buffer, by decoding it to 16 kHz mono 16-bit PCM. */
function flacSeconds(flac: Buffer): number {
  const pcm = spawnSync(ffmpegPath, ["-v", "error", "-i", "pipe:0", "-f", "s16le", "-ac", "1", "-ar", "16000", "pipe:1"], {
    input: flac,
    maxBuffer: 64 * 1024 * 1024,
  }).stdout;
  return pcm.length / 2 / 16000;
}

beforeAll(async () => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "podblock-audio-"));
  const file = path.join(dir, "episode.mp3");
  execFileSync(ffmpegPath, [
    "-v", "error", "-f", "lavfi", "-i", `sine=frequency=440:duration=${FIXTURE_SECONDS}`,
    "-ac", "1", "-ar", "22050", "-c:a", "libmp3lame", "-b:a", "64k", file,
  ]);
  fixture = fs.readFileSync(file);
  server = http.createServer(serve);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

afterAll(() => {
  server.closeAllConnections();
  server.close();
  fs.rmSync(dir, { recursive: true, force: true });
});

beforeEach(() => {
  requests = [];
  guard.allow = () => true;
});

describe("extractWindow", () => {
  it("extracts the window as 16 kHz mono FLAC", async () => {
    const flac = await extractWindow(`${base}/episode.mp3`, 5, 5);
    expect(flac.subarray(0, 4).toString("latin1")).toBe("fLaC");
    expect(flacSeconds(flac)).toBeCloseTo(5, 1);
  });

  it("stops at the end of the file", async () => {
    const flac = await extractWindow(`${base}/episode.mp3`, 15, 10);
    expect(flacSeconds(flac)).toBeCloseTo(5, 0);
  });

  it("follows redirects", async () => {
    const flac = await extractWindow(`${base}/redirect`, 0, 2);
    expect(flacSeconds(flac)).toBeCloseTo(2, 1);
    expect(requests.map((r) => r.url)).toContain("/redirect");
    expect(requests.map((r) => r.url)).toContain("/episode.mp3");
  });

  it("returns a header-only FLAC past the end of the file (no error; see E-5)", async () => {
    const flac = await extractWindow(`${base}/episode.mp3`, 60, 5);
    expect(flac.subarray(0, 4).toString("latin1")).toBe("fLaC");
    expect(flacSeconds(flac)).toBe(0);
  });

  it("fails when the file doesn't exist", async () => {
    await expect(extractWindow(`${base}/missing.mp3`, 0, 5)).rejects.toThrow(/ffmpeg failed|No audio/);
  });

  it("marks its failures as audio errors, but not aborts", async () => {
    const failed = await extractWindow(`${base}/missing.mp3`, 0, 5).catch((e) => e);
    expect(failed).toBeInstanceOf(AppError);
    expect(failed.kind).toBe("audio");

    const controller = new AbortController();
    setTimeout(() => controller.abort(), 100);
    const aborted = await extractWindow(`${base}/stall.mp3`, 0, 5, controller.signal).catch((e) => e);
    expect(aborted.name).toBe("AbortError");
  });

  it("refuses non-http(s) URLs", async () => {
    await expect(extractWindow("file:///etc/passwd", 0, 5)).rejects.toThrow(/http/);
  });

  it("stops when aborted mid-way", async () => {
    const controller = new AbortController();
    setTimeout(() => controller.abort(), 100);
    await expect(extractWindow(`${base}/stall.mp3`, 0, 5, controller.signal)).rejects.toThrow(/abort/i);
  });

  // Known bug: a listener added to an already-aborted signal never fires.
  it.fails("refuses to start with an already-aborted signal", async () => {
    const controller = new AbortController();
    controller.abort();
    await expect(extractWindow(`${base}/episode.mp3`, 0, 5, controller.signal)).rejects.toThrow(/abort/i);
  });
});

describe("resolveAudioUrl", () => {
  it("follows redirects to the file actually served", async () => {
    expect(await resolveAudioUrl(`${base}/redirect?a=1`)).toBe(`${base}/episode.mp3`);
  });

  it("keeps the original URL when the host doesn't answer well", async () => {
    expect(await resolveAudioUrl(`${base}/missing.mp3?b=1`)).toBe(`${base}/missing.mp3?b=1`);
  });

  it("remembers the answer", async () => {
    await resolveAudioUrl(`${base}/redirect?c=1`);
    const before = requests.length;
    expect(await resolveAudioUrl(`${base}/redirect?c=1`)).toBe(`${base}/episode.mp3`);
    expect(requests.length).toBe(before);
  });

  it("never requests a host that isn't public", async () => {
    guard.allow = () => false;
    expect(await resolveAudioUrl(`${base}/redirect?d=1`)).toBe(`${base}/redirect?d=1`);
    expect(requests).toEqual([]);
  });

  it("refuses non-http(s) URLs", async () => {
    await expect(resolveAudioUrl("ftp://example.com/a.mp3")).rejects.toThrow(/http/);
  });
});
