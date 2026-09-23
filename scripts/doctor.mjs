#!/usr/bin/env node
// Checks that everything Podblock needs is installed and configured.
// Usage: npm run doctor

import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import os from "node:os";
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

// ffmpeg
const ffmpeg = run("ffmpeg", ["-version"]);
check(Boolean(ffmpeg), ffmpeg ? ffmpeg.split("\n")[0] : "ffmpeg", "Install ffmpeg: brew install ffmpeg (macOS) or apt install ffmpeg.");

// Python with openai-whisper (same search order as the server)
const candidates = [process.env.WHISPER_PYTHON];
const whisperCli = run("which", ["whisper"]);
if (whisperCli) {
  const shebang = readFileSync(whisperCli, "utf-8").split("\n", 1)[0];
  if (shebang.startsWith("#!")) candidates.push(shebang.slice(2).trim().split(" ")[0]);
}
candidates.push("python3", "python");
const python = [...new Set(candidates.filter(Boolean))].find((py) => run(py, ["-c", "import whisper"]) !== null);
check(
  Boolean(python),
  python ? `openai-whisper (${python})` : "openai-whisper",
  "Install it: pip install -U openai-whisper  (or set WHISPER_PYTHON to a Python that has it).",
);

// Environment
const envFile = path.join(process.cwd(), ".env.local");
const env = { ...process.env };
if (existsSync(envFile)) {
  for (const line of readFileSync(envFile, "utf-8").split("\n")) {
    const match = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (match) env[match[1]] ??= match[2].replace(/^["']|["']$/g, "");
  }
}
check(Boolean(env.PODCAST_INDEX_API_KEY), "PODCAST_INDEX_API_KEY", "Get free keys at https://api.podcastindex.org and add them to .env.local.");
check(
  Boolean(env.PODCAST_INDEX_API_SECRET || env.PODCAST_INDEX_API_SECRET_BASE64),
  "PODCAST_INDEX_API_SECRET",
  "Add PODCAST_INDEX_API_SECRET to .env.local.",
);

// Whisper model (downloaded automatically on first use; just informational)
const model = env.WHISPER_MODEL || "base";
const modelCached = existsSync(path.join(os.homedir(), ".cache", "whisper", `${model}.pt`));

// Report
console.log("\nPodblock setup check\n");
for (const r of results) {
  console.log(`  ${r.ok ? "✓" : "✗"} ${r.label}`);
  if (!r.ok) console.log(`      → ${r.fix}`);
}
console.log(
  `\n  Whisper model: ${model}${modelCached ? " (downloaded)" : " (will download on first play)"}`,
);
const claude = env.AD_DETECTOR !== "heuristic" && Boolean(env.ANTHROPIC_API_KEY);
console.log(`  Ad detector:   ${claude ? `Claude (${env.CLAUDE_MODEL || "claude-opus-5"})` : "on-device heuristic"}\n`);

process.exit(results.every((r) => r.ok) ? 0 : 1);
