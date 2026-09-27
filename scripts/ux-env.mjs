// Shared by the UI scripts (ux-shots.mjs, ux-video.mjs): starts the fake
// providers and a dev server on a throwaway database, with the same settings
// as the end-to-end tests, so a developer's .env.local never leaks in.

import { execFileSync, spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

const APP_PORT = 3996;
const FAKE_PORT = 4012;
export const APP = `http://127.0.0.1:${APP_PORT}`;
const FAKE = `http://127.0.0.1:${FAKE_PORT}`;

const appEnv = {
  ...process.env,
  // Relative to the copy of the app (.ux-shots-app).
  PODBLOCK_DATA_DIR: ".ux-shots-data",
  DATABASE_URL: "",
  DATABASE_AUTH_TOKEN: "",
  BETTER_AUTH_SECRET: "ux-shots-secret-ux-shots-secret-ux-shots-secret",
  BETTER_AUTH_URL: APP,
  PODBLOCK_ADMIN_EMAIL: "owner@example.com",
  PODBLOCK_SETUP_CODE: "ux-shots-code",
  PODBLOCK_TRUSTED_ORIGINS: "",
  PODCAST_INDEX_BASE_URL: `${FAKE}/podcastindex`,
  PODCAST_INDEX_API_KEY: "fake",
  PODCAST_INDEX_API_SECRET: "fake",
  PODCAST_INDEX_API_SECRET_BASE64: "",
  TRANSCRIBE_BASE_URL: `${FAKE}/v1`,
  TRANSCRIBE_API_KEY: "fake",
  TRANSCRIBE_MODEL: "fake-whisper",
  DETECT_BASE_URL: `${FAKE}/v1`,
  DETECT_API_KEY: "fake",
  DETECT_MODEL: "fake-detector",
  PODBLOCK_UNSAFE_ALLOW_AUDIO_HOSTS: `127.0.0.1:${FAKE_PORT}`,
  GITHUB_CLIENT_ID: "",
  GITHUB_CLIENT_SECRET: "",
  GOOGLE_CLIENT_ID: "",
  GOOGLE_CLIENT_SECRET: "",
  FFMPEG_PATH: "",
};

const children = [];
function start(command, commandArgs, env, cwd) {
  const child = spawn(command, commandArgs, { env, cwd, stdio: ["ignore", "ignore", "inherit"] });
  children.push(child);
  return child;
}
export const stopAll = () => children.forEach((c) => c.kill("SIGTERM"));
process.on("exit", stopAll);
process.on("SIGINT", () => process.exit(130));

async function waitFor(url, timeoutMs = 120_000) {
  const until = Date.now() + timeoutMs;
  while (Date.now() < until) {
    try {
      if ((await fetch(url)).ok) return;
    } catch {
      // not up yet
    }
    await new Promise((r) => setTimeout(r, 500));
  }
  throw new Error(`Timed out waiting for ${url}`);
}

/**
 * A copy of the app to run, in .ux-shots-app: Next.js allows one dev server
 * per folder, and a developer's own may already be running here. Source files
 * are copied (tracked and new ones, not ignored ones like .env.local);
 * node_modules is hard-linked, which is instant and takes no space.
 */
function copyApp() {
  const dir = path.resolve(".ux-shots-app");
  fs.rmSync(dir, { recursive: true, force: true });
  const files = execFileSync("git", ["ls-files", "--cached", "--others", "--exclude-standard", "-z"], { encoding: "utf8" })
    .split("\0")
    .filter((f) => f && fs.existsSync(f));
  for (const file of files) {
    fs.mkdirSync(path.join(dir, path.dirname(file)), { recursive: true });
    fs.copyFileSync(file, path.join(dir, file));
  }
  execFileSync("cp", ["-al", "node_modules", path.join(dir, "node_modules")]);
  return dir;
}

/** Starts both servers on a fresh database and waits until they answer. */
export async function startApp() {
  const dir = copyApp();
  start(process.execPath, ["scripts/fake-providers.mjs", "--port", String(FAKE_PORT)], process.env);
  start(process.execPath, ["node_modules/next/dist/bin/next", "dev", "-H", "127.0.0.1", "-p", String(APP_PORT)], appEnv, dir);
  await waitFor(`${FAKE}/podcastindex/podcasts/trending`);
  await waitFor(`${APP}/login`);
}

export const OWNER = { name: "Owner", email: "owner@example.com", password: "correct horse battery", setupCode: "ux-shots-code" };

/** Creates the owner account (the first time) or signs in, and waits for the home page. */
export async function signIn(page, { signUp = false } = {}) {
  if (signUp) {
    await page.goto(`${APP}/signup`);
    await page.getByLabel("Name").fill(OWNER.name);
    await page.getByLabel("Email").fill(OWNER.email);
    await page.getByLabel("Password", { exact: true }).fill(OWNER.password);
    await page.getByLabel("Setup code").fill(OWNER.setupCode);
    await page.getByRole("button", { name: "Create account" }).click();
  } else {
    await page.goto(`${APP}/login`);
    await page.getByLabel("Email").fill(OWNER.email);
    await page.getByLabel("Password", { exact: true }).fill(OWNER.password);
    await page.getByRole("button", { name: "Sign in" }).click();
  }
  await page.waitForURL(`${APP}/`);
}

