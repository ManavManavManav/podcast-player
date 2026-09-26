#!/usr/bin/env node
// Stand-ins for everything Podblock calls out to, for end-to-end tests and
// offline development: the Podcast Index API, an OpenAI-compatible
// transcription and chat API, and a podcast host serving one episode.
//
// The episode is 10 minutes of tone. Every 5-minute window "transcribes" to
// the same lines, with a sponsor read 20–50 s in, which the fake detector
// reports; so the known ads are at 0:20–0:50 and 5:20–5:50.
//
// Usage: node scripts/fake-providers.mjs [--port 4010]
// Prints the environment variables that point the app at it.

import { execFileSync } from "node:child_process";
import fs from "node:fs";
import http from "node:http";
import { createRequire } from "node:module";
import os from "node:os";
import path from "node:path";

const require = createRequire(import.meta.url);
const portFlag = process.argv.indexOf("--port");
const PORT = Number(portFlag > 0 ? process.argv[portFlag + 1] : process.env.FAKE_PROVIDERS_PORT || 4010);
const HOST = "127.0.0.1";
const BASE = `http://${HOST}:${PORT}`;

const EPISODE_SECONDS = 600;
const AD_LINES = [
  [20, 30, "This episode is brought to you by Acme."],
  [30, 40, "Acme makes the widgets you need. Use code POD for ten percent off."],
  [40, 50, "That's acme dot com slash pod."],
];

// --- The episode -------------------------------------------------------------------

const ffmpeg = process.env.FFMPEG_PATH || require("@ffmpeg-installer/ffmpeg").path;
const dir = fs.mkdtempSync(path.join(os.tmpdir(), "podblock-fake-"));
const episodeFile = path.join(dir, "episode.mp3");
execFileSync(ffmpeg, [
  "-v", "error", "-f", "lavfi", "-i", `sine=frequency=440:duration=${EPISODE_SECONDS}`,
  "-ac", "1", "-ar", "22050", "-c:a", "libmp3lame", "-b:a", "32k", episodeFile,
]);
const episodeAudio = fs.readFileSync(episodeFile);
fs.rmSync(dir, { recursive: true, force: true });

// --- Podcast Index -------------------------------------------------------------------

const feed = {
  id: 1001,
  title: "The Fixture Show",
  author: "Podblock Tests",
  description: "<p>A show that exists only for tests.</p>",
  image: "",
  artwork: "",
  language: "en",
  categories: { 1: "Technology" },
  episodeCount: 1,
  link: "https://fixture.example",
};
const item = {
  id: 5001,
  title: "Episode one: sponsored",
  description: "An episode with a sponsor read at 0:20.",
  enclosureUrl: `${BASE}/audio/episode.mp3`,
  duration: EPISODE_SECONDS,
  datePublished: 1767225600,
  feedId: feed.id,
  feedTitle: feed.title,
  feedLanguage: "en",
};

function podcastIndex(endpoint, query) {
  switch (endpoint) {
    case "search/byterm":
    case "podcasts/trending":
      return { feeds: [feed] };
    case "podcasts/byfeedid":
      return { feed: Number(query.get("id")) === feed.id ? feed : [] };
    case "episodes/byfeedid":
      return { items: Number(query.get("id")) === feed.id ? [item] : [] };
    default:
      return null;
  }
}

// --- Transcription and detection -------------------------------------------------------

/** The same transcript for every window, in window time (0–300 s). */
function transcript() {
  const segments = [];
  for (let t = 0; t < 300; t += 10) {
    const ad = AD_LINES.find(([start]) => start === t);
    segments.push({ start: t, end: t + 10, text: ad ? ad[2] : `Show talk at ${t} seconds into the window.`, no_speech_prob: 0.01 });
  }
  return { duration: 300, segments };
}

/** Reports the transcript lines that read like a sponsor, as one ad per run of lines. */
function detect(prompt) {
  const lines = [...prompt.matchAll(/^WINDOW \[([\d.]+)-([\d.]+)\] (.*)$/gm)].map(([, s, e, text]) => ({
    start: Number(s),
    end: Number(e),
    ad: /acme/i.test(text),
  }));
  const ads = [];
  for (const line of lines) {
    const last = ads.at(-1);
    if (!line.ad) continue;
    if (last && Math.abs(last.end - line.start) < 0.5) last.end = line.end;
    else ads.push({ start: line.start, end: line.end, advertiser: "Acme" });
  }
  return { ads };
}

// --- Server ----------------------------------------------------------------------------

function sendAudio(req, res) {
  const size = episodeAudio.length;
  const range = req.headers.range?.match(/bytes=(\d+)-(\d*)/);
  const start = range ? Number(range[1]) : 0;
  const end = range && range[2] ? Math.min(Number(range[2]), size - 1) : size - 1;
  res.writeHead(range ? 206 : 200, {
    "content-type": "audio/mpeg",
    "accept-ranges": "bytes",
    "content-length": end - start + 1,
    ...(range ? { "content-range": `bytes ${start}-${end}/${size}` } : {}),
  });
  res.end(req.method === "HEAD" ? undefined : episodeAudio.subarray(start, end + 1));
}

async function readBody(req) {
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  return Buffer.concat(chunks).toString("utf-8");
}

const json = (res, status, body) => res.writeHead(status, { "content-type": "application/json" }).end(JSON.stringify(body));

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url ?? "/", BASE);
  if (url.pathname === "/audio/episode.mp3") return sendAudio(req, res);
  if (url.pathname.startsWith("/podcastindex/")) {
    const body = podcastIndex(url.pathname.slice("/podcastindex/".length), url.searchParams);
    return body ? json(res, 200, body) : json(res, 404, { description: "Unknown endpoint" });
  }
  if (req.method === "POST" && url.pathname === "/v1/audio/transcriptions") {
    await readBody(req);
    return json(res, 200, transcript());
  }
  if (req.method === "POST" && url.pathname === "/v1/chat/completions") {
    const { messages } = JSON.parse(await readBody(req));
    const content = JSON.stringify(detect(messages.at(-1).content));
    return json(res, 200, { choices: [{ message: { content }, finish_reason: "stop" }], usage: { prompt_tokens: 500, completion_tokens: 20 } });
  }
  json(res, 404, { error: "Not found" });
});

server.listen(PORT, HOST, () => {
  console.log(`Fake providers on ${BASE}. Point the app at them with:

PODCAST_INDEX_BASE_URL=${BASE}/podcastindex
PODCAST_INDEX_API_KEY=fake
PODCAST_INDEX_API_SECRET=fake
TRANSCRIBE_BASE_URL=${BASE}/v1
TRANSCRIBE_API_KEY=fake
DETECT_BASE_URL=${BASE}/v1
DETECT_API_KEY=fake
DETECT_MODEL=fake-detector
PODBLOCK_UNSAFE_ALLOW_AUDIO_HOSTS=${HOST}:${PORT}`);
});
