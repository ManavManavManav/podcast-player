# Podblock

A podcast player that skips the ads for you.

While you listen, Podblock transcribes the next few minutes of the episode, has an AI model find the sponsor reads and inserted ads in the transcript, and jumps past them when playback gets there. You see every ad on the seek bar, can read along with a live transcript, and can undo any skip.

- **Search and browse** millions of shows through the [Podcast Index](https://podcastindex.org)
- **Automatic ad skipping** with an "Undo" for every skip and a running total of time saved
- **Ad markers on the timeline**, plus a list of every ad break found and why it was flagged
- **Live transcript** that follows playback; click any line to jump there
- **Picks up where you left off** across reloads, with recently played episodes on the home page
- **Accounts with admin approval**, so friends and family can use it on your API keys without strangers running up the bill
- Playback speed, sleep timer, media keys/lock-screen controls, keyboard shortcuts, light and dark mode

It runs anywhere Next.js does, including Vercel: transcription and ad detection are API calls, and ffmpeg ships with the app.

## Quick start

You need **Node.js 22+** (CI uses 24; see `.nvmrc`) and four sets of keys:

| For | Where | Cost |
|---|---|---|
| Search | [Podcast Index](https://api.podcastindex.org/signup) | Free |
| Transcription | [Groq](https://console.groq.com) (or any OpenAI-compatible speech-to-text API) | Free tier ≈ 8 h of audio a day, then $0.04/h |
| Ad detection | [Xiaomi MiMo](https://platform.xiaomimimo.com) (or any OpenAI-compatible chat API) | Under 1¢ per listened hour |

```bash
npm install
cp .env.example .env.local          # add the keys above and your email as PODBLOCK_ADMIN_EMAIL
echo "BETTER_AUTH_SECRET=$(openssl rand -base64 48)" >> .env.local
echo "PODBLOCK_SETUP_CODE=$(openssl rand -hex 12)" >> .env.local
npm run doctor                      # checks the setup
npm run dev
```

Open <http://localhost:3000>, **create your account first, with the admin email and the setup code** from `.env.local`, then search for a show and press play.

## How it works

```
 Browser                                  Server (Next.js)                         APIs
┌──────────────────────────┐   POST    ┌──────────────────────────────┐
│ <audio> plays the episode│/api/analyze  1. ffmpeg: 5 min of audio   │  range requests to the podcast host
│                          │ ────────▶ │     → 16 kHz FLAC            │  (see How it works, step 2)
│ useAdScanner keeps the   │ window N  │  2. transcribe ─────────────────▶ Groq Whisper (timestamps)
│ current and next 5-minute│           │  3. find ads ───────────────────▶ MiMo (JSON ad ranges)
│ windows analyzed         │ ◀──────── │  4. store both in the database│
│ Player skips any ad the  │transcript │     (shared by all listeners) │
│ playhead enters          │ + all ads └──────────────────────────────┘
└──────────────────────────┘
```

1. **Pinning the audio.** Many hosts stitch ads into the file per request, so two downloads of "the same" episode can have different ads and different timings. Before playing, `/api/resolve` follows the episode's redirects to the concrete file being served. The player and the analyzer both use that exact URL, so the ads found are the ads you hear.
2. **Listening ahead.** Episodes are analyzed in 5-minute windows on a fixed grid (0:00, 5:00, 10:00…), and the player keeps the current window and the next one done. ffmpeg reads the window straight from the remote file with range requests. For M4A that means only the bytes around the window; for MP3, ffmpeg reads from the start of the file up to the window, which keeps timestamps exact but costs more later in long episodes (see [docs/seek-accuracy.md](docs/seek-accuracy.md)). Node does the networking and hands ffmpeg a loopback URL, which also checks every redirect points at a public host.
3. **Transcribing.** Each window goes to the transcription API as 16 kHz mono FLAC (about 5 MB) and comes back as timestamped lines.
4. **Finding ads.** The model reads the window's transcript, plus the end of the previous window for context, and returns each ad's start and end time. It's told what the show and episode are, so the episode's own subject and the show's own plugs aren't flagged. Reasoning is switched off and JSON output requested; for APIs that don't support those options, the request is retried without them.
5. **Skipping.** When playback naturally enters an ad, the player jumps to its end and shows "Skipped a 51 sec ad · Undo". If you deliberately seek into an ad, it plays.

Transcripts and verdicts are stored per episode in the database and shared by everyone, so a second listener, or a replay, costs nothing. A failed detection keeps the transcript, so the retry only redoes the detection. Changing the model or the instructions redoes the detection, not the transcription.

**Why 5 minutes?** Transcription is billed per second of audio, so window size doesn't change its price. Each detection call, though, resends the same instructions, so bigger windows are cheaper. At 1 minute, about three quarters of every call is repeated overhead; at 5 minutes it costs within a fraction of a cent of analyzing the whole episode at once, while the first skip is still ready a few seconds after you press play.

## Accounts and approval

- **Sign-in** uses [Better Auth](https://www.better-auth.com) with email and password. GitHub and Google sign-in appear when their OAuth credentials are set.
- **The admin** is the account with `PODBLOCK_ADMIN_EMAIL`. Creating it with a password takes the one-time `PODBLOCK_SETUP_CODE` (the sign-up form asks for it), so nobody else can claim the address; signing in with GitHub or Google, which verify the email, works without it. Until the admin exists, nobody else can sign up.
- **Everyone else** can sign up, but sees "Waiting for approval" until the admin approves them under **Users** in the account menu. Unapproved accounts can't search, play through the analyzer, or cost you anything.
- **The Users page** also shows each person's usage this month (minutes transcribed, detection calls, tokens), and lets the admin disable, re-enable or delete accounts and set a new password for someone who forgot theirs (there's no email-based reset).
- **API keys** belong to the server's owner and live only in the environment. Users never see or need them.
- **Listening history** is kept in the browser, separately per account.
- Keep `BETTER_AUTH_SECRET` safe and stable; changing it signs everyone out.

## Deploying to Vercel

1. **Create a database.** Vercel's filesystem doesn't persist, so accounts and transcripts need a hosted database. [Turso](https://turso.tech) (SQLite-compatible, free tier) works as is: create a database, then note its URL (`libsql://…turso.io`) and an auth token. It's also available from the Vercel Marketplace.
2. **Import the repo** into Vercel. No build settings need changing.
3. **Add environment variables** in the project's settings: everything from your `.env.local`, plus `DATABASE_URL`, `DATABASE_AUTH_TOKEN` and `CRON_SECRET`. Tables are created on first use; `vercel.json` schedules a daily cleanup of analysis older than 30 days.
4. **Deploy**, open the site, and **sign up with your admin email and the setup code** (`PODBLOCK_SETUP_CODE`) first.

The analyze function is allowed 120 seconds (a window normally takes a few), which fits Vercel's defaults. The Hobby plan is for non-commercial use, which covers friends and family.

## Configuration

See [`.env.example`](.env.example).

| Variable | Default | |
|---|---|---|
| `PODCAST_INDEX_API_KEY`, `PODCAST_INDEX_API_SECRET` | none (required) | Podcast search and episode lists. `PODCAST_INDEX_API_SECRET_BASE64` also works. |
| `BETTER_AUTH_SECRET` | none (required) | Signs sessions; at least 32 characters. `openssl rand -base64 48`. In production the server won't serve requests without a valid one. |
| `BETTER_AUTH_URL` | the request's host | The site's public address, e.g. `https://podblock.example.com`. Set it in production. |
| `PODBLOCK_ADMIN_EMAIL` | none (required) | The account that becomes the admin. |
| `PODBLOCK_SETUP_CODE` | none | A one-time code the sign-up form asks for when creating the admin account with email and password (`openssl rand -hex 12`). Not needed once the admin exists, or when the admin signs in with GitHub or Google. |
| `TRANSCRIBE_API_KEY` | none (required) | Speech-to-text key. |
| `TRANSCRIBE_BASE_URL`, `TRANSCRIBE_MODEL` | Groq, `whisper-large-v3-turbo` | Any OpenAI-compatible `/audio/transcriptions` API that returns segment timestamps (`verbose_json`), e.g. DeepInfra: `https://api.deepinfra.com/v1/openai`, `openai/whisper-large-v3-turbo`. |
| `DETECT_API_KEY` | none (required) | Ad-detection key. |
| `DETECT_BASE_URL`, `DETECT_MODEL` | Xiaomi MiMo, `mimo-v2.6-pro` | Any OpenAI-compatible `/chat/completions` API. `mimo-v2.6-flash` is cheaper. Changing the model re-runs detection for episodes listened to afterwards. |
| `DATABASE_URL`, `DATABASE_AUTH_TOKEN` | local file `.data/podblock.db` | A libSQL/Turso database. Required on Vercel. |
| `PODBLOCK_DATA_DIR` | `.data` | Where the local database file lives when `DATABASE_URL` isn't set. |
| `CRON_SECRET` | not set | On Vercel, authorizes the daily cleanup (`vercel.json`): transcripts and verdicts older than 30 days, expired sessions. `openssl rand -hex 24`. |
| `PODBLOCK_TRUSTED_ORIGINS` | not set | Extra addresses the site is reached at, comma-separated, so sign-in works from them. |
| `PODBLOCK_LOG_LEVEL` | `info` | Server log level (`debug`, `info`, `warn`, `error`, `silent`). Logs are one JSON object per line. |
| `GITHUB_CLIENT_ID`, `GITHUB_CLIENT_SECRET`, `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET` | not set | Optional social sign-in; both halves of a pair are needed. |
| `FFMPEG_PATH` | bundled | Use a different ffmpeg. |

Development and testing only: `DEV_ALLOWED_ORIGINS` (hostnames `next dev` is opened from), `PODCAST_INDEX_BASE_URL` and `PODBLOCK_UNSAFE_ALLOW_AUDIO_HOSTS` (for the fake providers; see [Development](#development)). `npm run doctor` checks all of these with the same rules the server applies at startup.

## Keyboard shortcuts

| Key | |
|---|---|
| `Space` / `K` | Play / pause |
| `←` / `J` | Back 15 seconds |
| `→` / `L` | Forward 30 seconds |
| `T` | Transcript and ads panel |
| `S` | Toggle ad skipping |
| `M` | Mute |
| `/` | Search |

## Project layout

```
src/
  app/                      Pages (home, search, podcast) and API routes
    api/analyze/            Transcribe + detect one window; GET returns what's stored
    api/resolve/            Pin the ad-stitched variant of an episode
    api/health/             Setup check used by the in-app notice
    api/healthz, readyz/    Uptime checks (no sign-in)
    api/auth/               Better Auth (sign-in, sign-up, sessions, admin)
    api/admin/users/        The admin's user list and actions
    (app)/                  Signed-in pages, incl. admin/; (auth)/ holds login, signup, pending
  components/               UI; player/ holds the player bar, timeline, panel; admin/ the Users page
  hooks/useAdScanner.ts     Keeps the current and next windows analyzed
  store/                    Zustand stores: player (persisted), analysis
  instrumentation.ts        Startup configuration check; unhandled errors to the log
  proxy.ts                  Sends signed-out visitors to sign in
  lib/
    analysis.ts             Window size and look-ahead
    ads/merge.ts            Merging ad ranges across windows
    redirect.ts             Safe post-sign-in destinations
    securityHeaders.ts      Security headers and content security policy
    server/analyzer.ts      Orchestration, storage, de-duplication, usage
    server/audio.ts         ffmpeg window extraction (via a loopback proxy), URL pinning
    server/safeFetch.ts     Fetching user-supplied URLs, public addresses only
    server/guard.ts         Public-address and cross-site checks
    server/transcribe.ts    Speech-to-text client
    server/llm/             Ad-detection client and its prompt
    server/retry.ts         One retry for transient provider failures
    server/auth.ts          Better Auth setup, approval rules, admin bootstrap
    server/session.ts       The signed-in user, for pages and routes
    server/db.ts            libSQL client
    server/migrations.ts    The schema, versioned
    server/envSchema.mjs    Every setting and its rules (shared with the doctor)
    server/log.ts           Structured JSON logs
    server/podcastIndex.ts  Podcast Index client
e2e/                        Playwright end-to-end tests
scripts/
  doctor.mjs                Setup checker
  migrate.ts                npm run migrate
  fake-providers.mjs        Stand-ins for every external API
  seek-accuracy.mjs         Measures window extraction accuracy and cost
docs/                       RUNBOOK.md (operating a server), seek-accuracy.md
```

Tests sit next to the code they test (`*.test.ts`, `*.test.tsx`).

## Development

```bash
npm run dev             # development server
npm run check           # typecheck + lint + unit tests
npm test                # unit and integration tests (Vitest)
npm run test:coverage   # the same, with a coverage report in coverage/
npm run build           # production build
npm run test:e2e        # end-to-end tests in Chromium, after a build
npm run fake-providers  # stand-ins for every external API, for offline work
npm run doctor          # checks your setup
```

The end-to-end tests start the production build against `scripts/fake-providers.mjs` (a fake Podcast Index, transcription and detection API, and podcast host) with a throwaway database, so they need no keys or network. The first run needs a browser: `npx playwright install chromium`. CI (`.github/workflows/ci.yml`) runs the checks, the build and the end-to-end tests on every push and pull request.

## Limitations

- **Every listen costs a little.** Roughly 1–2¢ per listened hour with Groq and MiMo, less on Groq's free tier; replays and other listeners of the same episode are free. The Users page shows who's using what.
- **The first seconds after pressing play or seeking aren't covered** until that window comes back (a few seconds), so an ad right at that spot can start playing before it's skipped.
- **Some hosts don't pin.** If a host serves a different stitched file on every request, even at the final URL, detected timings can drift. The player falls back gracefully, but skips may land a little off.
- **No password reset by email.** The admin sets a new password from the Users page instead.

## License

[MIT](LICENSE).
