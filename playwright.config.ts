import { defineConfig, devices } from "@playwright/test";

/**
 * End-to-end tests: the production build, run against the fake providers
 * (scripts/fake-providers.mjs) and a throwaway database. Build first:
 *   npm run build && npm run test:e2e
 */
const APP = "http://127.0.0.1:3999";
const FAKE_PORT = 4010;
const FAKE = `http://127.0.0.1:${FAKE_PORT}`;

// Every setting is given explicitly, so a developer's .env.local (real keys,
// a real database) never leaks into a test run: process env wins over it.
const appEnv = {
  PODBLOCK_DATA_DIR: ".e2e-data",
  DATABASE_URL: "",
  DATABASE_AUTH_TOKEN: "",
  BETTER_AUTH_SECRET: "e2e-secret-e2e-secret-e2e-secret-e2e-secret",
  BETTER_AUTH_URL: APP,
  PODBLOCK_ADMIN_EMAIL: "owner@example.com",
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

export default defineConfig({
  testDir: "e2e",
  workers: 1,
  timeout: 60_000,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [["list"], ["html", { open: "never" }]] : "list",
  use: {
    baseURL: APP,
    trace: "retain-on-failure",
    // Episodes start playing from a click, but headless Chromium can still refuse.
    launchOptions: { args: ["--autoplay-policy=no-user-gesture-required"] },
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
  webServer: [
    {
      command: `node scripts/fake-providers.mjs --port ${FAKE_PORT}`,
      url: `${FAKE}/podcastindex/podcasts/trending`,
      reuseExistingServer: false,
    },
    {
      command: `node -e "require('fs').rmSync('.e2e-data', { recursive: true, force: true })" && next start -H 127.0.0.1 -p 3999`,
      url: `${APP}/login`,
      env: appEnv,
      reuseExistingServer: false,
      timeout: 60_000,
    },
  ],
});
