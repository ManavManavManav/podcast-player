#!/usr/bin/env node
// Measures how accurately, and how cheaply, ffmpeg extracts a window from a
// remote file with the app's arguments: with its default seeking, and with
// fast seeking (-fflags +fastseek). Writes a Markdown table to stdout.
//
// Fixtures have 3 kHz beeps at known times over a background whose loudness
// changes every 10 s (so VBR bitrates vary). A window is extracted around
// each beep; the error is where the beep lands versus where it should.
//
// Usage: node scripts/seek-accuracy.mjs [--ffmpeg /path/to/ffmpeg]

import { execFileSync, spawnSync } from "node:child_process";
import fs from "node:fs";
import http from "node:http";
import { createRequire } from "node:module";
import os from "node:os";
import path from "node:path";

const require = createRequire(import.meta.url);
const flagIndex = process.argv.indexOf("--ffmpeg");
const ffmpeg = flagIndex > 0 ? process.argv[flagIndex + 1] : process.env.FFMPEG_PATH || require("ffmpeg-static");

const DURATION = 1200; // 20 minutes: long enough that reading from the start is visibly costly
const BEEPS = [305, 905]; // seconds; windows start 5 s before each
const WINDOW = 10;

const dir = fs.mkdtempSync(path.join(os.tmpdir(), "podblock-seek-"));
const source = path.join(dir, "source.wav");

// Background: pink noise, loud and quiet in alternating 10 s stretches. Beeps: 0.2 s of 3 kHz.
const beepExpr = BEEPS.map((t) => `between(t,${t},${t + 0.2})`).join("+");
execFileSync(ffmpeg, [
  "-v", "error", "-y",
  "-f", "lavfi", "-i", `anoisesrc=d=${DURATION}:c=pink:a=0.3:r=44100`,
  "-f", "lavfi", "-i", `aevalsrc='0.6*sin(2*PI*3000*t)*(${beepExpr})':d=${DURATION}:s=44100`,
  "-filter_complex", "[0]volume='if(lt(mod(t,20),10),1,0.05)':eval=frame[bg];[bg][1]amix=inputs=2,aformat=channel_layouts=stereo",
  source,
]);

// Embedded cover art: a large ID3 tag that shifts where the audio starts.
const cover = path.join(dir, "cover.png");
execFileSync(ffmpeg, ["-v", "error", "-y", "-f", "lavfi", "-i", "nullsrc=s=320x320,geq=random(1)*255:128:128", "-frames:v", "1", cover]);
const withCover = ["-i", cover, "-map", "0:a", "-map", "1:v", "-c:v", "copy", "-disposition:v", "attached_pic", "-id3v2_version", "3"];
const encodings = [
  ["MP3 CBR 128k", "a.mp3", ["-c:a", "libmp3lame", "-b:a", "128k"]],
  ["MP3 CBR 128k + cover art in ID3", "b.mp3", [...withCover, "-c:a", "libmp3lame", "-b:a", "128k"]],
  ["MP3 VBR with TOC (Xing)", "c.mp3", ["-c:a", "libmp3lame", "-q:a", "2"]],
  ["MP3 VBR without TOC", "d.mp3", ["-c:a", "libmp3lame", "-q:a", "2", "-write_xing", "0"]],
  ["M4A AAC, index first (faststart)", "e.m4a", ["-c:a", "aac", "-b:a", "128k", "-movflags", "+faststart"]],
  ["M4A AAC, index last", "f.m4a", ["-c:a", "aac", "-b:a", "128k"]],
];
for (const [, file, args] of encodings) {
  execFileSync(ffmpeg, ["-v", "error", "-y", "-i", source, ...args, path.join(dir, file)]);
}
console.error(`cover art: ${Math.round(fs.statSync(cover).size / 1000)} KB`);
{
}

// Serves the fixtures with range support, counting requests.
let requests = 0;
const server = http.createServer((req, res) => {
  const file = path.join(dir, path.basename(req.url ?? ""));
  if (!fs.existsSync(file)) return void res.writeHead(404).end();
  requests++;
  const size = fs.statSync(file).size;
  const range = req.headers.range?.match(/bytes=(\d+)-(\d*)/);
  const start = range ? Number(range[1]) : 0;
  const end = range && range[2] ? Number(range[2]) : size - 1;
  res.writeHead(range ? 206 : 200, {
    "accept-ranges": "bytes",
    "content-length": end - start + 1,
    ...(range ? { "content-range": `bytes ${start}-${end}/${size}` } : {}),
  });
  fs.createReadStream(file, { start, end }).on("error", () => res.destroy()).pipe(res);
});
await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
const base = `http://127.0.0.1:${server.address().port}`;

/** The app's extraction arguments (src/lib/server/audio.ts), plus any extra input options. */
function extract(url, start, extra) {
  const args = [
    "-nostdin", "-hide_banner", "-loglevel", "debug",
    "-protocol_whitelist", "http,tcp", "-reconnect", "1", "-reconnect_delay_max", "4", "-rw_timeout", "20000000",
    ...extra,
    "-ss", String(start), "-t", String(WINDOW), "-i", url,
    "-vn", "-ac", "1", "-ar", "16000", "-sample_fmt", "s16", "-c:a", "flac", "-f", "flac", "pipe:1",
  ];
  return new Promise((resolve) => {
    const child = spawnAsync(ffmpeg, args);
    child.then(resolve);
  });
}

function spawnAsync(cmd, args) {
  return new Promise((resolve) => {
    const { spawn } = require("node:child_process");
    const p = spawn(cmd, args, { stdio: ["ignore", "pipe", "pipe"] });
    const out = [];
    let err = "";
    p.stdout.on("data", (c) => out.push(c));
    p.stderr.on("data", (c) => (err += c));
    p.on("close", () => resolve({ flac: Buffer.concat(out), log: err }));
  });
}

/** Seconds into the extracted audio where the 3 kHz beep starts (Goertzel over 10 ms frames). */
function beepAt(flac) {
  const pcm = spawnSync(ffmpeg, ["-v", "error", "-i", "pipe:0", "-f", "s16le", "-ac", "1", "-ar", "16000", "pipe:1"], {
    input: flac,
    maxBuffer: 64 * 1024 * 1024,
  }).stdout;
  const samples = new Int16Array(pcm.buffer, pcm.byteOffset, pcm.length / 2);
  const frame = 160;
  const coeff = 2 * Math.cos((2 * Math.PI * 3000) / 16000);
  const power = [];
  for (let i = 0; i + frame <= samples.length; i += frame) {
    let s1 = 0;
    let s2 = 0;
    for (let j = 0; j < frame; j++) {
      const s = samples[i + j] + coeff * s1 - s2;
      s2 = s1;
      s1 = s;
    }
    power.push(s1 * s1 + s2 * s2 - coeff * s1 * s2);
  }
  const max = Math.max(...power);
  if (!max) return null;
  const first = power.findIndex((p) => p > max * 0.3);
  return (first * frame) / 16000;
}

const bytesRead = (log) =>
  [...log.matchAll(/Statistics: (\d+) bytes read/g)].reduce((sum, m) => sum + Number(m[1]), 0);

const fmtError = (e) => (e === null ? "no beep" : `${e >= 0 ? "+" : ""}${e.toFixed(2)} s`);
const fmtBytes = (b) => (b >= 1e6 ? `${(b / 1e6).toFixed(1)} MB` : `${Math.round(b / 1e3)} KB`);

console.log(`ffmpeg: ${execFileSync(ffmpeg, ["-version"]).toString().split("\n")[0]}`);
console.log(`Fixture: ${DURATION / 60} min; windows of ${WINDOW} s starting 5 s before beeps at ${BEEPS.join(" s and ")} s.\n`);
console.log("| Encoding | File size | Seeking | Error at " + BEEPS.map((b) => `${b} s`).join(" | Error at ") + " | Read for the later window | Requests |");
console.log("|---|---|---|" + BEEPS.map(() => "---|").join("") + "---|---|");
for (const [label, file] of encodings) {
  const size = fs.statSync(path.join(dir, file)).size;
  for (const [mode, extra] of [["default (current)", []], ["fast (-fflags +fastseek)", ["-fflags", "+fastseek"]]]) {
    const errors = [];
    let lastBytes = 0;
    let lastRequests = 0;
    for (const beep of BEEPS) {
      requests = 0;
      const { flac, log } = await extract(`${base}/${file}`, beep - 5, extra);
      const at = beepAt(flac);
      errors.push(at === null ? null : at - 5);
      lastBytes = bytesRead(log);
      lastRequests = requests;
    }
    console.log(`| ${label} | ${fmtBytes(size)} | ${mode} | ${errors.map(fmtError).join(" | ")} | ${fmtBytes(lastBytes)} | ${lastRequests} |`);
  }
}

server.close();
fs.rmSync(dir, { recursive: true, force: true });
