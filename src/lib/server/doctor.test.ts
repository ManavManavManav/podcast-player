import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, describe, expect, it } from "vitest";

/** Runs `npm run doctor` for a directory whose .env.local holds `envFile`. */
const dir = fs.mkdtempSync(path.join(os.tmpdir(), "podblock-doctor-"));
function doctor(envFile: string) {
  fs.writeFileSync(path.join(dir, ".env.local"), envFile);
  const clean = Object.fromEntries(
    Object.entries(process.env).filter(([k]) => !/^(PODCAST|BETTER|PODBLOCK|TRANSCRIBE|DETECT|DATABASE|GITHUB|GOOGLE|VERCEL)/.test(k)),
  ) as NodeJS.ProcessEnv;
  return spawnSync(process.execPath, [path.resolve("scripts/doctor.mjs")], { cwd: dir, env: clean, encoding: "utf-8" });
}

afterAll(() => fs.rmSync(dir, { recursive: true, force: true }));

describe("npm run doctor", () => {
  it("passes a complete setup", () => {
    const run = doctor(
      [
        "PODCAST_INDEX_API_KEY=k",
        "PODCAST_INDEX_API_SECRET=s",
        `BETTER_AUTH_SECRET=${"x".repeat(48)}`,
        "PODBLOCK_ADMIN_EMAIL=owner@example.com",
        "TRANSCRIBE_API_KEY=t",
        "DETECT_API_KEY=d",
      ].join("\n"),
    );
    expect(run.stdout).toContain("✓ ffmpeg");
    expect(run.status).toBe(0);
  });

  it("uses the server's own rules, and says what to fix", () => {
    const run = doctor(["BETTER_AUTH_SECRET=short", "PODBLOCK_ADMIN_EMAIL=not-an-email", "TRANSCRIBE_BASE_URL=groq"].join("\n"));
    expect(run.status).toBe(1);
    expect(run.stdout).toMatch(/PODBLOCK_ADMIN_EMAIL isn't an email address/);
    expect(run.stdout).toMatch(/TRANSCRIBE_BASE_URL must be an http\(s\) URL/);
    expect(run.stdout).toMatch(/BETTER_AUTH_SECRET is shorter than 32 characters/);
    expect(run.stdout).toMatch(/DETECT_API_KEY isn't set/);
    // Values are never printed.
    expect(run.stdout).not.toContain("not-an-email");
  });
});
