// The server's settings: what each one is, and which values are a problem.
// Plain JavaScript (typed with JSDoc) so the app and scripts/doctor.mjs
// share it. Messages never repeat a setting's value.

/**
 * @typedef {object} EnvVar
 * @property {string} name
 * @property {string} description
 * @property {boolean} [secret] Never shown, logged or echoed.
 * @property {string} [example] For .env.example.
 * @property {"core" | "transcription" | "detection" | "database" | "optional" | "development"} group
 */

/** @type {EnvVar[]} */
export const ENV_VARS = [
  { name: "PODCAST_INDEX_API_KEY", group: "core", secret: true, description: "Podcast Index API key, for search and episode lists (free: https://api.podcastindex.org/signup)." },
  { name: "PODCAST_INDEX_API_SECRET", group: "core", secret: true, description: "Podcast Index API secret. PODCAST_INDEX_API_SECRET_BASE64 also works." },
  { name: "PODCAST_INDEX_API_SECRET_BASE64", group: "optional", secret: true, description: "The Podcast Index secret, base64-encoded, for hosts that mangle special characters." },
  { name: "BETTER_AUTH_SECRET", group: "core", secret: true, description: "Signs sessions; at least 32 characters (openssl rand -base64 48). Changing it signs everyone out." },
  { name: "BETTER_AUTH_URL", group: "core", example: "https://podblock.example.com", description: "The site's public address. Sign-in links and origin checks use it; without it they trust the request's Host header." },
  { name: "PODBLOCK_ADMIN_EMAIL", group: "core", example: "you@example.com", description: "The account with this email becomes the admin who approves everyone else. No one can sign up until it exists." },
  { name: "PODBLOCK_SETUP_CODE", group: "core", secret: true, description: "A one-time code that creating the admin account with email and password takes, so nobody else can claim PODBLOCK_ADMIN_EMAIL first (openssl rand -hex 12). Not needed once the admin exists, or when the admin signs in with GitHub or Google." },
  { name: "TRANSCRIBE_API_KEY", group: "transcription", secret: true, description: "Key for an OpenAI-compatible speech-to-text API that returns segment timestamps (verbose_json)." },
  { name: "TRANSCRIBE_BASE_URL", group: "transcription", example: "https://api.groq.com/openai/v1", description: "Its base URL. Default: Groq." },
  { name: "TRANSCRIBE_MODEL", group: "transcription", example: "whisper-large-v3-turbo", description: "Its model. Default: whisper-large-v3-turbo." },
  { name: "DETECT_API_KEY", group: "detection", secret: true, description: "Key for an OpenAI-compatible chat API that finds the ads." },
  { name: "DETECT_BASE_URL", group: "detection", example: "https://api.xiaomimimo.com/v1", description: "Its base URL. Default: Xiaomi MiMo." },
  { name: "DETECT_MODEL", group: "detection", example: "mimo-v2.6-pro", description: "Its model. Default: mimo-v2.6-pro. Changing it re-runs detection (and bills it) for every episode listened to afterwards." },
  { name: "DATABASE_URL", group: "database", example: "libsql://<db>.turso.io", description: "A libSQL/Turso database. Unset: a local SQLite file in PODBLOCK_DATA_DIR. Required on Vercel." },
  { name: "DATABASE_AUTH_TOKEN", group: "database", secret: true, description: "Auth token for DATABASE_URL." },
  { name: "PODBLOCK_DATA_DIR", group: "database", example: ".data", description: "Where the local database file lives when DATABASE_URL is unset. Default: .data" },
  { name: "PODBLOCK_TRUSTED_ORIGINS", group: "optional", example: "https://podblock.example.com", description: "Other addresses the site is reached at, comma-separated, so sign-in and the app's own requests work from them." },
  { name: "PODBLOCK_LOG_LEVEL", group: "optional", example: "info", description: "Minimum server log level: debug, info, warn, error or silent. Default: info." },
  { name: "GITHUB_CLIENT_ID", group: "optional", description: "GitHub OAuth app for “Continue with GitHub” (callback: <site>/api/auth/callback/github)." },
  { name: "GITHUB_CLIENT_SECRET", group: "optional", secret: true, description: "Its secret. Both GitHub settings are needed." },
  { name: "GOOGLE_CLIENT_ID", group: "optional", description: "Google OAuth client for “Continue with Google” (callback: <site>/api/auth/callback/google)." },
  { name: "GOOGLE_CLIENT_SECRET", group: "optional", secret: true, description: "Its secret. Both Google settings are needed." },
  { name: "FFMPEG_PATH", group: "optional", description: "Use this ffmpeg instead of the one bundled with the app." },
  { name: "DEV_ALLOWED_ORIGINS", group: "development", example: "100.64.0.1", description: "Other hostnames `next dev` is opened from (LAN, tailnet), comma-separated, without scheme or port, so live reload works there." },
  { name: "PODCAST_INDEX_BASE_URL", group: "development", description: "Point the Podcast Index client elsewhere, e.g. at scripts/fake-providers.mjs." },
  { name: "PODBLOCK_UNSAFE_ALLOW_AUDIO_HOSTS", group: "development", description: "End-to-end tests only: host:port pairs allowed to serve audio despite being private. Never set in production." },
];

const LOG_LEVELS = ["debug", "info", "warn", "error", "silent"];
const URL_SETTINGS = ["BETTER_AUTH_URL", "TRANSCRIBE_BASE_URL", "DETECT_BASE_URL", "PODCAST_INDEX_BASE_URL"];

/** @param {string} value */
function isHttpUrl(value) {
  try {
    const { protocol } = new URL(value);
    return protocol === "http:" || protocol === "https:";
  } catch {
    return false;
  }
}

/**
 * Problems with a set of settings. Errors mean the server shouldn't start;
 * warnings mean something won't work.
 *
 * @param {Record<string, string | undefined>} env
 * @param {{ production: boolean, vercel: boolean }} where
 * @returns {{ errors: string[], warnings: string[] }}
 */
export function checkEnv(env, { production, vercel }) {
  /** @type {string[]} */ const errors = [];
  /** @type {string[]} */ const warnings = [];
  const has = (/** @type {string} */ name) => Boolean(env[name]?.trim());

  const secret = env.BETTER_AUTH_SECRET ?? "";
  if (secret.length < 32) {
    const problem = secret
      ? "BETTER_AUTH_SECRET is shorter than 32 characters."
      : "BETTER_AUTH_SECRET isn't set, so sessions are signed with a default key.";
    (production ? errors : warnings).push(`${problem} Generate one with: openssl rand -base64 48`);
  }

  if (vercel && !has("DATABASE_URL")) {
    errors.push("DATABASE_URL isn't set. On Vercel the filesystem doesn't persist: use a hosted database such as Turso.");
  }
  if (has("DATABASE_URL")) {
    const url = env.DATABASE_URL ?? "";
    if (!/^(libsql|https?|wss?|file):/.test(url)) {
      errors.push("DATABASE_URL must be a libSQL URL (libsql://, https://, ws(s)://) or a file: path.");
    } else if (/^(libsql|https?|wss?):/.test(url) && !has("DATABASE_AUTH_TOKEN") && !/localhost|127\.0\.0\.1/.test(url)) {
      warnings.push("DATABASE_URL points at a hosted database but DATABASE_AUTH_TOKEN isn't set.");
    }
  }

  for (const name of URL_SETTINGS) {
    if (has(name) && !isHttpUrl(env[name] ?? "")) errors.push(`${name} must be an http(s) URL.`);
  }
  const entries = (/** @type {string} */ name) => (env[name] ?? "").split(",").map((o) => o.trim()).filter(Boolean);
  const badOrigins = entries("PODBLOCK_TRUSTED_ORIGINS").filter((o) => !isHttpUrl(o));
  if (badOrigins.length) {
    errors.push(`PODBLOCK_TRUSTED_ORIGINS has ${badOrigins.length === 1 ? "an entry" : "entries"} that aren't http(s) URLs.`);
  }
  // Next.js matches only the hostname here, so a scheme or port makes an entry never match.
  if (entries("DEV_ALLOWED_ORIGINS").some((o) => !/^(\*\.)?[a-z0-9.-]+$/i.test(o))) {
    warnings.push("DEV_ALLOWED_ORIGINS entries should be hostnames (e.g. 100.64.0.1 or *.example.com), without a scheme or port.");
  }
  if (has("PODBLOCK_ADMIN_EMAIL") && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(env.PODBLOCK_ADMIN_EMAIL?.trim() ?? "")) {
    errors.push("PODBLOCK_ADMIN_EMAIL isn't an email address.");
  }
  if (has("PODBLOCK_LOG_LEVEL") && !LOG_LEVELS.includes(env.PODBLOCK_LOG_LEVEL ?? "")) {
    errors.push(`PODBLOCK_LOG_LEVEL must be one of ${LOG_LEVELS.join(", ")}.`);
  }

  if (production && !has("BETTER_AUTH_URL")) {
    warnings.push("BETTER_AUTH_URL isn't set: sign-in trusts each request's Host header for the site's address.");
  }
  if (!has("PODBLOCK_ADMIN_EMAIL")) warnings.push("PODBLOCK_ADMIN_EMAIL isn't set, so no one can sign up.");
  if (!has("PODCAST_INDEX_API_KEY") || !(has("PODCAST_INDEX_API_SECRET") || has("PODCAST_INDEX_API_SECRET_BASE64"))) {
    warnings.push("PODCAST_INDEX_API_KEY and PODCAST_INDEX_API_SECRET aren't both set, so search won't work.");
  }
  if (!has("TRANSCRIBE_API_KEY")) warnings.push("TRANSCRIBE_API_KEY isn't set, so episodes can't be transcribed.");
  if (!has("DETECT_API_KEY")) warnings.push("DETECT_API_KEY isn't set, so ads can't be detected.");
  for (const provider of ["GITHUB", "GOOGLE"]) {
    if (has(`${provider}_CLIENT_ID`) !== has(`${provider}_CLIENT_SECRET`)) {
      warnings.push(`${provider}_CLIENT_ID and ${provider}_CLIENT_SECRET must both be set for that sign-in button to appear.`);
    }
  }
  if (production && has("PODBLOCK_UNSAFE_ALLOW_AUDIO_HOSTS")) {
    warnings.push("PODBLOCK_UNSAFE_ALLOW_AUDIO_HOSTS is set: those hosts bypass the private-network check. It's for end-to-end tests only.");
  }
  return { errors, warnings };
}
