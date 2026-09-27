#!/usr/bin/env node
// Screenshots of every screen, for checking UI changes before and after.
//
// Starts the fake providers and a dev server on a throwaway database (the same
// settings as the end-to-end tests, so a developer's .env.local never leaks
// in), signs up, then walks the app at phone and desktop sizes, light and dark.
//
// Usage: node scripts/ux-shots.mjs [label] [--only desk,desk-dark,mob,mob-dark]
// Writes .ux-shots/<label>/<viewport>-<nn>-<screen>.png (label defaults to "latest").

import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { chromium } from "@playwright/test";

const APP_PORT = 3996;
const FAKE_PORT = 4012;
const APP = `http://127.0.0.1:${APP_PORT}`;
const FAKE = `http://127.0.0.1:${FAKE_PORT}`;

const args = process.argv.slice(2);
const onlyFlag = args.indexOf("--only");
const only = onlyFlag >= 0 ? args[onlyFlag + 1].split(",") : null;
const label = args.find((a, i) => !a.startsWith("--") && (onlyFlag < 0 || i !== onlyFlag + 1)) ?? "latest";
const out = path.join(".ux-shots", label);
fs.mkdirSync(out, { recursive: true });

const appEnv = {
  ...process.env,
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
function start(command, commandArgs, env) {
  const child = spawn(command, commandArgs, { env, stdio: ["ignore", "ignore", "inherit"] });
  children.push(child);
  return child;
}
const stopAll = () => children.forEach((c) => c.kill("SIGTERM"));
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

fs.rmSync(".ux-shots-data", { recursive: true, force: true });
start(process.execPath, ["scripts/fake-providers.mjs", "--port", String(FAKE_PORT)], process.env);
start(process.execPath, ["node_modules/next/dist/bin/next", "dev", "-H", "127.0.0.1", "-p", String(APP_PORT)], appEnv);
await waitFor(`${FAKE}/podcastindex/podcasts/trending`);
await waitFor(`${APP}/login`);

const OWNER = { name: "Owner", email: "owner@example.com", password: "correct horse battery" };
const browser = await chromium.launch({ args: ["--autoplay-policy=no-user-gesture-required"] });

async function walk(name, contextOptions, signUp) {
  const context = await browser.newContext(contextOptions);
  const page = await context.newPage();
  let n = 0;
  const shot = async (screen, options = {}) => {
    await page.waitForTimeout(options.wait ?? 1200);
    await page.screenshot({ path: path.join(out, `${name}-${String(++n).padStart(2, "0")}-${screen}.png`), fullPage: options.fullPage });
  };

  await page.goto(`${APP}/login`);
  await shot("login");
  if (signUp) {
    await page.goto(`${APP}/signup`);
    await shot("signup");
    await page.getByLabel("Name").fill(OWNER.name);
    await page.getByLabel("Email").fill(OWNER.email);
    await page.getByLabel("Password", { exact: true }).fill(OWNER.password);
    await page.getByLabel("Setup code").fill("ux-shots-code");
    await page.getByRole("button", { name: "Create account" }).click();
  } else {
    await page.getByLabel("Email").fill(OWNER.email);
    await page.getByLabel("Password", { exact: true }).fill(OWNER.password);
    await page.getByRole("button", { name: "Sign in" }).click();
  }
  await page.waitForURL(`${APP}/`);
  await shot("home", { wait: 2500 });
  await page.goto(`${APP}/search`);
  await shot("search-empty");
  await page.goto(`${APP}/search?q=fixture`);
  await shot("search-results", { wait: 2000 });
  await page.goto(`${APP}/podcast/1001`);
  await shot("podcast", { wait: 2000 });

  await page.getByRole("button", { name: /^Play / }).first().click();
  await shot("playing", { wait: 6000 });
  if (!contextOptions.hasTouch) {
    // Hover inside the fixture's first ad (0:20–0:50 of 10:00) to show the seek preview.
    const bar = await page.getByRole("slider", { name: "Seek" }).boundingBox();
    await page.mouse.move(bar.x + bar.width * 0.055, bar.y + bar.height / 2);
    await shot("seek-preview", { wait: 400 });
    await page.mouse.move(0, 0);
  }
  await page.keyboard.press("t");
  await shot("transcript", { wait: 2500 });
  await page.getByRole("tab", { name: /Ad/ }).click();
  await shot("ad-breaks");
  await page.keyboard.press("t");
  await page.locator("audio").evaluate((audio) => {
    audio.currentTime = 18;
  });
  await shot("skip-toast", { wait: 5000 });

  await page.goto(`${APP}/`);
  await shot("home-with-history", { wait: 3000 });
  await page.goto(`${APP}/settings`);
  await shot("settings");
  await page.goto(`${APP}/admin`);
  await shot("admin");
  await page.goto(`${APP}/podcast/999999999`);
  await shot("not-found");
  await context.close();
}

const desktop = { viewport: { width: 1440, height: 900 } };
const phone = { viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true };
const runs = [
  ["desk", { ...desktop, colorScheme: "light" }],
  ["desk-dark", { ...desktop, colorScheme: "dark" }],
  ["mob", { ...phone, colorScheme: "light" }],
  ["mob-dark", { ...phone, colorScheme: "dark" }],
].filter(([name]) => !only || only.includes(name));

let signedUp = false;
for (const [name, options] of runs) {
  await walk(name, options, !signedUp);
  signedUp = true;
}
await browser.close();
console.log(`Screenshots in ${out}`);
process.exit(0);
