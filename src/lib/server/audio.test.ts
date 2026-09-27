import { execFileSync, spawnSync } from "node:child_process";
import fs from "node:fs";
import http from "node:http";
import type { AddressInfo } from "node:net";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

// The fixture server runs on 127.0.0.1, which the real guard (rightly)
// refuses. Every address counts as public here; the guard has its own tests.
const guard = vi.hoisted(() => ({ allow: (() => true) as (address: string) => boolean }));
vi.mock("@/lib/server/guard", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/server/guard")>()),
  isPublicUrl: async () => true,
  isPublicAddress: (address: string) => guard.allow(address),
}));

const { extractWindow, ffmpegPath, hasAudioFrames, resolveAudioUrl } = await import("@/lib/server/audio");
const { AppError } = await import("@/lib/server/errors");

const FIXTURE_SECONDS = 20;
let dir: string;
let fixture: Buffer;
let server: http.Server;
let base: string;
let requests: Array<{ url: string; range?: string }> = [];
/** A longer episode, to show seeking doesn't download everything before the window. */
let longFixture: Buffer;
/** Two minutes with a 3 kHz beep at 100 s, constant and variable bitrate. */
const beepFixtures: Record<string, Buffer> = {};

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
  const name = (req.url ?? "").slice(1).split("?")[0];
  const file = name === "long.mp3" ? longFixture : name === "episode.mp3" ? fixture : (beepFixtures[name] ?? null);
  if (!file) {
    res.writeHead(404).end();
    return;
  }
  const range = req.headers.range?.match(/bytes=(\d+)-(\d*)/);
  if (range) {
    const start = Number(range[1]);
    const end = range[2] ? Math.min(Number(range[2]), file.length - 1) : file.length - 1;
    res.writeHead(206, {
      "content-type": "audio/mpeg",
      "accept-ranges": "bytes",
      "content-length": end - start + 1,
      "content-range": `bytes ${start}-${end}/${file.length}`,
    });
    res.end(file.subarray(start, end + 1));
  } else {
    res.writeHead(200, { "content-type": "audio/mpeg", "accept-ranges": "bytes", "content-length": file.length });
    res.end(file);
  }
}

/** Seconds into a FLAC buffer where the 3 kHz beep starts (Goertzel over 10 ms frames). */
function beepAt(flac: Buffer): number | null {
  const pcm = spawnSync(ffmpegPath, ["-v", "error", "-i", "pipe:0", "-f", "s16le", "-ac", "1", "-ar", "16000", "pipe:1"], {
    input: flac,
    maxBuffer: 64 * 1024 * 1024,
  }).stdout;
  const samples = new Int16Array(pcm.buffer, pcm.byteOffset, pcm.length / 2);
  const coeff = 2 * Math.cos((2 * Math.PI * 3000) / 16000);
  const power: number[] = [];
  for (let i = 0; i + 160 <= samples.length; i += 160) {
    let s1 = 0;
    let s2 = 0;
    for (let j = 0; j < 160; j++) {
      const s0 = samples[i + j] + coeff * s1 - s2;
      s2 = s1;
      s1 = s0;
    }
    power.push(s1 * s1 + s2 * s2 - coeff * s1 * s2);
  }
  const max = Math.max(...power);
  return max ? (power.findIndex((p) => p > max * 0.3) * 160) / 16000 : null;
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
  const long = path.join(dir, "long.mp3");
  execFileSync(ffmpegPath, [
    "-v", "error", "-f", "lavfi", "-i", "sine=frequency=330:duration=120",
    "-ac", "1", "-ar", "22050", "-c:a", "libmp3lame", "-b:a", "64k", long,
  ]);
  longFixture = fs.readFileSync(long);
  const beepSource = path.join(dir, "beep.wav");
  execFileSync(ffmpegPath, [
    "-v", "error",
    "-f", "lavfi", "-i", "anoisesrc=d=120:c=pink:a=0.3",
    "-f", "lavfi", "-i", "aevalsrc='0.6*sin(2*PI*3000*t)*between(t,100,100.2)':d=120:s=44100",
    "-filter_complex", "[0]volume='if(lt(mod(t,20),10),1,0.05)':eval=frame[bg];[bg][1]amix=inputs=2",
    beepSource,
  ]);
  for (const [name, args] of [
    ["beep-cbr.mp3", ["-c:a", "libmp3lame", "-b:a", "128k"]],
    ["beep-vbr.mp3", ["-c:a", "libmp3lame", "-q:a", "2", "-write_xing", "0"]],
  ] as const) {
    const out = path.join(dir, name);
    execFileSync(ffmpegPath, ["-v", "error", "-i", beepSource, ...args, out]);
    beepFixtures[name] = fs.readFileSync(out);
  }
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

  it("extracts a window late in a longer file", async () => {
    const flac = await extractWindow(`${base}/long.mp3`, 100, 5);
    expect(flacSeconds(flac)).toBeCloseTo(5, 1);
  });

  it("seeks constant-bitrate MP3 with range requests instead of downloading everything before the window", async () => {
    await extractWindow(`${base}/long.mp3`, 100, 5);
    // A window at 100 s of 120 s: ffmpeg asks for bytes from well past the middle.
    const starts = requests.map((r) => Number(r.range?.match(/^bytes=(\d+)-$/)?.[1] ?? 0));
    expect(Math.max(...starts)).toBeGreaterThan(longFixture.length * 0.5);
  });

  it.each([
    ["beep-cbr.mp3", "jumps straight to the window"],
    ["beep-vbr.mp3", "reads from the start"],
  ])("places the window exactly in %s (it %s)", async (name) => {
    const flac = await extractWindow(`${base}/${name}?exact=${Math.random()}`, 95, 10);
    expect(Math.abs((beepAt(flac) ?? Infinity) - 5)).toBeLessThan(0.1);
    const offsetRanges = requests.filter((r) => r.range && !/^bytes=0-\d*$/.test(r.range));
    if (name === "beep-cbr.mp3") expect(offsetRanges.length).toBeGreaterThan(0);
    else expect(offsetRanges).toEqual([]);
  });

  it("doesn't probe the file for the first window, and probes each file once", async () => {
    const url = `${base}/beep-cbr.mp3?probe=${Math.random()}`;
    await extractWindow(url, 0, 2);
    const probes = () => requests.filter((r) => r.range && /^bytes=0-\d+$/.test(r.range)).length;
    expect(probes()).toBe(0);
    await extractWindow(url, 60, 2);
    expect(probes()).toBe(1);
    await extractWindow(url, 90, 2);
    expect(probes()).toBe(1);
  });

  it("gives up on a host that stops sending", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    try {
      const pending = extractWindow(`${base}/stall.mp3`, 0, 5).catch((e) => e);
      await vi.advanceTimersByTimeAsync(90_000);
      const err = await pending;
      expect(err).toBeInstanceOf(AppError);
      expect(err.message).toMatch(/Timed out/);
    } finally {
      vi.useRealTimers();
    }
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

  it("refuses to start with an already-aborted signal", async () => {
    const controller = new AbortController();
    controller.abort();
    await expect(extractWindow(`${base}/episode.mp3`, 0, 5, controller.signal)).rejects.toThrow(/abort/i);
  });
});

describe("hasAudioFrames", () => {
  it("tells real audio from the header-only FLAC ffmpeg writes past the end", async () => {
    expect(hasAudioFrames(await extractWindow(`${base}/episode.mp3`, 5, 5))).toBe(true);
    expect(hasAudioFrames(await extractWindow(`${base}/episode.mp3`, 15, 10))).toBe(true); // runs off the end
    expect(hasAudioFrames(await extractWindow(`${base}/episode.mp3`, 60, 5))).toBe(false);
  });

  it("assumes audio when it can't tell", () => {
    expect(hasAudioFrames(Buffer.from("not flac at all"))).toBe(true);
    expect(hasAudioFrames(Buffer.from("fLaC\x00\x00"))).toBe(true); // truncated block header
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

  it("can skip the remembered answer when asked for a fresh one", async () => {
    await resolveAudioUrl(`${base}/redirect?e=1`);
    const before = requests.length;
    expect(await resolveAudioUrl(`${base}/redirect?e=1`, { fresh: true })).toBe(`${base}/episode.mp3`);
    expect(requests.length).toBeGreaterThan(before);
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
