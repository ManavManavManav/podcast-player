# Podblock

A podcast player that skips the ads for you.

While you listen, Podblock transcribes the next few minutes of the episode on your machine, finds sponsor reads and inserted ads in the transcript, and jumps past them when playback gets there. You see every ad on the seek bar, can read along with a live transcript, and can undo any skip.

- **Search and browse** millions of shows through the [Podcast Index](https://podcastindex.org)
- **Automatic ad skipping** with an "Undo" for every skip and a running total of time saved
- **Ad markers on the timeline**, plus a list of every ad break found and why it was flagged
- **Live transcript** that follows playback; click any line to jump there
- **Picks up where you left off** across reloads, with recently played episodes on the home page
- **Accounts** so family or friends can share one server, each with their own history and **their own AI keys** (encrypted)
- Playback speed, sleep timer, media keys/lock-screen controls, keyboard shortcuts, light and dark mode

## Quick start

You need **Node.js 20.9+**, **ffmpeg**, and **Python 3** with **[openai-whisper](https://github.com/openai/whisper)**.

```bash
brew install ffmpeg                 # or: apt install ffmpeg
pip install -U openai-whisper
npm install
cp .env.example .env.local          # then add your Podcast Index keys (free)
echo "BETTER_AUTH_SECRET=$(openssl rand -base64 48)" >> .env.local
npm run doctor                      # checks everything above
npm run dev
```

Open <http://localhost:3000>, create an account, search for a show, and press play. The first play downloads the Whisper model (~140 MB, once).

Podcast Index keys are free: sign up at <https://api.podcastindex.org/signup>.

## How it works

```
 Browser                                   Next.js server                          Your machine
┌──────────────────────────┐   POST     ┌─────────────────────────────┐
│ <audio> plays the episode│ /api/analyze│  analyzer (cache: memory +  │   ffmpeg -ss N -t 60 <url>
│                          │ ─────────▶ │  .cache/analysis/*.json)    │ ───────────────────────────▶ HTTP range request:
│ useAdScanner keeps the   │  window N  │                             │                              only that minute is
│ next 4 minutes analyzed  │            │  1. ffmpeg: 60s → 16kHz WAV │ ◀─────────────────────────── downloaded
│                          │ ◀───────── │  2. Whisper worker (Python, │
│ Player skips any ad the  │ transcript │     model stays loaded)     │
│ playhead enters          │  + all ads │  3. ad detector             │
└──────────────────────────┘            └─────────────────────────────┘
```

1. **Pinning the audio.** Many hosts stitch ads into the file per request, so two downloads of "the same" episode can have different ads and different timings. Before playing, `/api/resolve` follows the episode's redirects to the concrete file being served. The player and the analyzer both use that exact URL, so the ads found are the ads you hear.
2. **Listening ahead.** The episode is analyzed in 60-second windows, from the playhead up to 4 minutes ahead. ffmpeg seeks straight into the remote file, so only the bytes for that minute are downloaded. A long-running Python process keeps the Whisper model in memory (the `base` model transcribes a minute in about 4 seconds on an M1 Pro). Seeking cancels work that's no longer needed.
3. **Finding ads.** The transcripts go to one of two detectors:
   - **On-device (default).** Looks for sponsor intros ("brought to you by", "our first sponsor"), break announcements ("when we come back"), and pitch language (promo codes, promo URLs, offers, legal disclaimers). It groups them into ad ranges that start at the intro and end where the show resumes. It needs real commercial evidence before flagging anything, so a host plugging a guest's website isn't skipped.
   - **An AI model (optional, per user).** In **Settings**, each user can switch to **GLM** (Z.ai; `glm-4.7-flash` is free) or **Claude** (Anthropic) with their own API key. Each window, with the previous one as context, is classified by the model, which also catches brand spots with no URL or code. If a call fails (a bad key, a network error), that window falls back to the on-device detector and the player says so.
4. **Skipping.** When playback naturally enters an ad, the player jumps to its end and shows "Skipped a 51 sec ad · Undo". If you deliberately seek into an ad, it plays.

Results are cached per episode on disk, so listening again, or reloading the page, is instant. Transcripts are shared by everyone on the server; each AI model's verdicts are cached per model, so a replay never pays twice.

## Accounts and API keys

Podblock is meant to run on one machine you control (your Mac, a home server, a VPS) that a few people sign into.

- **Sign-in** uses [Better Auth](https://www.better-auth.com) with email and password; accounts live in a local SQLite file (`.data/podblock.db`, created automatically). GitHub and Google sign-in appear when their OAuth credentials are set.
- **Sign-ups are open** until you set `PODBLOCK_ALLOW_SIGNUPS=false`. Create everyone's accounts first, then close them.
- **API keys** entered in Settings are encrypted (AES-256-GCM, with a key derived from `BETTER_AUTH_SECRET`), only ever shown masked, and only used server-side for that user's listening. "Save & test" checks a key against a tiny sample transcript.
- **Shared keys:** `ZAI_API_KEY` / `ANTHROPIC_API_KEY` in `.env.local` are used by anyone who hasn't added their own key, and are billed to you.
- **Listening history** is kept in the browser, separately per account.
- Keep `BETTER_AUTH_SECRET` safe and stable. Changing it signs everyone out, and saved API keys have to be entered again.
- Reaching the server from another address (its LAN IP, a domain)? Add that to `PODBLOCK_TRUSTED_ORIGINS` so sign-in works from there, and put it behind HTTPS if it's exposed to the internet.

## Configuration

All optional except the Podcast Index keys and `BETTER_AUTH_SECRET`. See [`.env.example`](.env.example).

| Variable | Default | |
|---|---|---|
| `PODCAST_INDEX_API_KEY`, `PODCAST_INDEX_API_SECRET` | none (required) | Podcast search and episode lists. `PODCAST_INDEX_API_SECRET_BASE64` also works. |
| `BETTER_AUTH_SECRET` | none (required) | Signs sessions and encrypts users' API keys. `openssl rand -base64 48`. |
| `PODBLOCK_ALLOW_SIGNUPS` | `true` | Set to `false` to stop new accounts being created. |
| `PODBLOCK_TRUSTED_ORIGINS` | not set | Extra addresses the server is reached at, comma-separated. |
| `GITHUB_CLIENT_ID/SECRET`, `GOOGLE_CLIENT_ID/SECRET` | not set | Optional social sign-in. |
| `WHISPER_MODEL` | `base` | `tiny` is ~2× faster and less accurate; `small` is more accurate and ~3× slower. |
| `WHISPER_PYTHON` | auto | Python interpreter with openai-whisper installed. |
| `ZAI_API_KEY`, `ANTHROPIC_API_KEY` | not set | Shared fallback keys for users who haven't added their own (billed to you). |
| `PODBLOCK_CACHE_DIR` | `.cache/analysis` | Where transcripts and results are cached. |
| `PODBLOCK_DATA_DIR` | `.data` | Where the accounts database lives. |

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
    api/analyze/            Transcribe + detect one window; GET returns the cache
    api/resolve/            Pin the ad-stitched variant of an episode
    api/health/             Setup check used by the in-app notice
    api/auth/               Better Auth (sign-in, sign-up, sessions)
    api/settings/           Per-user detector settings and API keys (+ /test)
    (app)/                  Signed-in pages; (auth)/ holds login and signup
  components/               UI; player/ holds the player bar, timeline, panel
  hooks/useAdScanner.ts     Keeps the windows ahead of the playhead analyzed
  store/                    Zustand stores: player (persisted), analysis
  lib/
    ads/heuristic.ts        On-device ad detector (+ tests)
    server/analyzer.ts      Orchestration, caching, de-duplication
    server/audio.ts         ffmpeg window extraction, URL pinning
    server/whisper.ts       Manages the Python worker process
    server/llm/             GLM and Claude classifiers, shared prompt (+ tests)
    server/auth.ts          Better Auth setup; server/settings.ts per-user keys
    server/secrets.ts       API key encryption
    server/podcastIndex.ts  Podcast Index client
worker/transcriber.py       The Whisper worker
scripts/doctor.mjs          Setup checker
```

## Development

```bash
npm run dev         # development server
npm run check       # typecheck + lint + tests
npm test            # unit tests (Vitest)
npm run build       # production build
```

## Limitations

- **It runs on one machine.** Transcription needs ffmpeg and Whisper on the server itself, so it suits a home server or VPS shared by a few people, not a public service.
- **No password reset by email.** There's no mail setup; a user who forgets their password needs the server's owner to help (or a new account).
- **The on-device detector misses pure brand spots.** It recognizes ads by what they say: sponsor intros, promo codes, promo links, offers, legal copy. A spot with none of that, such as "Stock up on fall flavors at Whole Foods Market", plays through. So can the first seconds of an ad that says nothing ad-like until its last line. The detector deliberately lets a borderline ad play rather than risk skipping real content. Switching to GLM or Claude in Settings catches most of these.
- **Some hosts don't pin.** If a host serves a different stitched file on every request, even at the final URL, detected timings can drift. The player falls back gracefully, but skips may land a little off.
