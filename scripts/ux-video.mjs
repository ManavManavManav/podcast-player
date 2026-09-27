#!/usr/bin/env node
// A short screen recording of playback, for judging motion (the background
// field, the play burst, skips) that stills can't show.
//
// Usage: node scripts/ux-video.mjs [label] [--dark] [--phone]
// Writes .ux-shots/<label>/<name>.webm (label defaults to "video").

import fs from "node:fs";
import path from "node:path";
import { chromium } from "@playwright/test";
import { APP, signIn, startApp } from "./ux-env.mjs";

const args = process.argv.slice(2);
const dark = args.includes("--dark");
const phone = args.includes("--phone");
const label = args.find((a) => !a.startsWith("--")) ?? "video";
const out = path.join(".ux-shots", label);
fs.mkdirSync(out, { recursive: true });
const name = `${phone ? "phone" : "desktop"}-${dark ? "dark" : "light"}`;

await startApp();
const browser = await chromium.launch({ args: ["--autoplay-policy=no-user-gesture-required"] });
const size = phone ? { width: 390, height: 844 } : { width: 1280, height: 800 };

// Sign up without recording, so the video starts on the page that matters.
const setup = await browser.newContext({ viewport: size, colorScheme: dark ? "dark" : "light" });
await signIn(await setup.newPage(), { signUp: true });
const storage = await setup.storageState();
await setup.close();

const context = await browser.newContext({
  viewport: size,
  colorScheme: dark ? "dark" : "light",
  storageState: storage,
  recordVideo: { dir: out, size },
  ...(phone && { deviceScaleFactor: 1, isMobile: true, hasTouch: true }),
  // The field defaults to the Now Playing view on phones; show it on the page for the recording.
});
const page = await context.newPage();
if (phone) {
  await page.addInitScript(() => {
    for (const key of Object.keys(localStorage)) {
      if (!key.startsWith("podblock-player:")) continue;
      const saved = JSON.parse(localStorage.getItem(key));
      saved.state.field = "everywhere";
      localStorage.setItem(key, JSON.stringify(saved));
    }
  });
}
await page.goto(`${APP}/podcast/1001`);
await page.waitForTimeout(1500);
if (phone) {
  await page.evaluate(() => {
    const key = Object.keys(localStorage).find((k) => k.startsWith("podblock-player:"));
    if (key) {
      const saved = JSON.parse(localStorage.getItem(key));
      saved.state.field = "everywhere";
      localStorage.setItem(key, JSON.stringify(saved));
    }
  });
  await page.reload();
  await page.waitForTimeout(1500);
}
await page.getByRole("button", { name: /^Play / }).first().click();
await page.waitForTimeout(4000);

if (!phone) {
  // Draw with the pointer for a few seconds.
  for (let i = 0; i <= 60; i++) {
    const a = (i / 60) * Math.PI * 2;
    await page.mouse.move(size.width * (0.5 + 0.3 * Math.cos(a)), size.height * (0.45 + 0.25 * Math.sin(2 * a)));
    await page.waitForTimeout(50);
  }
}
await page.waitForTimeout(3000);
// Into the sponsor read at 0:20, to catch the skip.
await page.locator("audio").evaluate((audio) => {
  audio.currentTime = 17;
});
await page.waitForTimeout(7000);
await context.close();
const video = fs.readdirSync(out).filter((f) => f.endsWith(".webm")).map((f) => path.join(out, f)).sort((a, b) => fs.statSync(b).mtimeMs - fs.statSync(a).mtimeMs)[0];
fs.renameSync(video, path.join(out, `${name}.webm`));
await browser.close();
console.log(`Video in ${path.join(out, `${name}.webm`)}`);
process.exit(0);
