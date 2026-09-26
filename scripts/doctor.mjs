#!/usr/bin/env node
// Checks that everything Podblock needs is installed and configured.
// Usage: npm run doctor

import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";

const results = [];
const check = (ok, label, fix) => results.push({ ok, label, fix });

function run(cmd, args) {
  try {
    return execFileSync(cmd, args, { encoding: "utf-8", stdio: ["ignore", "pipe", "pipe"], timeout: 60_000 }).trim();
  } catch {
    return null;
  }
}

// Node
const [major, minor] = process.versions.node.split(".").map(Number);
check(major > 20 || (major === 20 && minor >= 9), `Node.js ${process.versions.node}`, "Install Node.js 20.9 or newer.");

// .env.local (Next.js loads it for the server; mirror that here)
const envFile = path.join(process.cwd(), ".env.local");
const env = { ...process.env };
if (existsSync(envFile)) {
  for (const line of readFileSync(envFile, "utf-8").split("\n")) {
    const match = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (match) env[match[1]] ??= match[2].replace(/^["']|["']$/g, "");
  }
}

// ffmpeg (bundled with the app; FFMPEG_PATH overrides it)
let ffmpegPath = env.FFMPEG_PATH;
if (!ffmpegPath) {
  try {
    ffmpegPath = createRequire(import.meta.url)("@ffmpeg-installer/ffmpeg").path;
  } catch {
    ffmpegPath = null;
  }
}
const ffmpeg = ffmpegPath && run(ffmpegPath, ["-version"]);
check(Boolean(ffmpeg), ffmpeg ? ffmpeg.split("\n")[0] : "ffmpeg", "Run npm install (it bundles ffmpeg), or set FFMPEG_PATH.");

// Environment
check(Boolean(env.PODCAST_INDEX_API_KEY), "PODCAST_INDEX_API_KEY", "Get free keys at https://api.podcastindex.org and add them to .env.local.");
check(
  Boolean(env.PODCAST_INDEX_API_SECRET || env.PODCAST_INDEX_API_SECRET_BASE64),
  "PODCAST_INDEX_API_SECRET",
  "Add PODCAST_INDEX_API_SECRET to .env.local.",
);
check(
  (env.BETTER_AUTH_SECRET ?? "").length >= 32,
  "BETTER_AUTH_SECRET",
  "Add one to .env.local: BETTER_AUTH_SECRET=$(openssl rand -base64 48)",
);
check(Boolean(env.PODBLOCK_ADMIN_EMAIL), "PODBLOCK_ADMIN_EMAIL", "Set it to your email; that account becomes the admin who approves everyone else.");
check(Boolean(env.TRANSCRIBE_API_KEY), "TRANSCRIBE_API_KEY", "Add a Groq (or other OpenAI-compatible) speech-to-text key.");
check(Boolean(env.DETECT_API_KEY), "DETECT_API_KEY", "Add a Xiaomi MiMo (or other OpenAI-compatible) API key for ad detection.");

// Report
console.log("\nPodblock setup check\n");
for (const r of results) {
  console.log(`  ${r.ok ? "✓" : "✗"} ${r.label}`);
  if (!r.ok) console.log(`      → ${r.fix}`);
}
console.log(`\n  Database:      ${env.DATABASE_URL ? env.DATABASE_URL.replace(/\/\/.*@/, "//…@") : "local file (.data/podblock.db)"}`);
console.log(`  Transcription: ${env.TRANSCRIBE_MODEL || "whisper-large-v3-turbo"} @ ${env.TRANSCRIBE_BASE_URL || "https://api.groq.com/openai/v1"}`);
console.log(`  Ad detection:  ${env.DETECT_MODEL || "mimo-v2.6-pro"} @ ${env.DETECT_BASE_URL || "https://api.xiaomimimo.com/v1"}\n`);

process.exit(results.every((r) => r.ok) ? 0 : 1);
