# Podblock — Production Readiness Plan

Audit of branch `vercel-api` @ `5be255f`, 2026-09-26. No code was changed; this document is the only new file.

---

## 0. What I ran

| Check | Result |
|---|---|
| `npm run typecheck` | ✅ passes |
| `npm run lint` | ✅ passes, 0 warnings |
| `npm test` (Vitest) | ✅ 4 files, 30 tests pass, 152 ms |
| `next build` (in an isolated copy; a `next dev` was running from the repo on :3001) | ✅ builds, but **initialises Better Auth and creates a SQLite DB during prerender** (see C-9) and warns `BETTER_AUTH_URL` is unset |
| `npm audit` (prod + dev) | ✅ 0 known vulnerabilities |
| `npm outdated` | Minor bumps only (better-auth 1.7.6, vitest 5.0.2, lucide 1.48). Majors are available for TypeScript (7), ESLint (10) and @types/node (26) |
| Bundled ffmpeg `-version` | ⚠️ `N-47683-g0e8eb07980-static … 2000-2018`, a **2018 build** |
| Git history secret scan | ✅ no keys committed; `.env.local` is ignored. Repo is **public** on GitHub |
| Probed `isPublicUrl` with a scratch test | ❌ **SSRF bypass confirmed** (see S-1) |
| Probed `safeNext` | ❌ **open redirect confirmed** (see S-4) |

---

## 1. What the project is

**Podblock** is a Next.js 16 (App Router, Turbopack, React 19) podcast player that transcribes a few minutes ahead of the playhead, has an LLM find the ads in the transcript, and seeks past them automatically.

### Architecture

```
Browser (client components, zustand)                 Server (Next.js route handlers)                    External
─────────────────────────────────────                ──────────────────────────────────                ────────
Player.tsx  <audio>, auto-skip, hold-at-frontier      proxy.ts          cookie-presence gate
useAdScanner  keeps windows [N, N+1] analysed  ──POST /api/resolve──▶ audio.resolveAudioUrl ─────────▶ podcast host (redirect chain)
             ──POST /api/analyze {url,window}──▶ analyzer.analyzeWindow
                                                   ├ transcribeWindow ─ audio.extractWindow
                                                   │    loopback HTTP proxy (Node does DNS/TLS/SSRF check)
                                                   │    └ ffmpeg -ss/-t → 16 kHz FLAC ──────────────────▶ podcast host (range requests)
                                                   │    transcribe.ts ─────────────────────────────────▶ Groq/DeepInfra /audio/transcriptions
                                                   ├ classifyWindow ── llm/detect.ts ──────────────────▶ MiMo/any /chat/completions
                                                   └ episodeAnalysis: merge + snap all windows' ads
             ──GET /api/analyze?url=──────────▶ cachedAnalysis (read only)
Server components: /, /search, /podcast/[id] ────────▶ podcastIndex.ts ─────────────────────────────────▶ api.podcastindex.org
Auth UI (better-auth/react) ────/api/auth/*──────────▶ Better Auth (email+pw, optional GitHub/Google, admin plugin)
AdminPanel ──────────────────/api/admin/users[/id]──▶ admin.ts, usage.ts
                                                   DB: libSQL (local .data/podblock.db or Turso)
                                                     tables: Better Auth's + analysis_window, analysis_verdict, usage
```

**Key design points**
- Analysis runs on a fixed 300 s window grid shared by all users. Transcripts are keyed by `sha1(url)` and start time. Verdicts are keyed by url, start and `model:pPROMPT_VERSION`. Because they are stored in the DB, a replay costs nothing.
- `SharedTask` de-duplicates concurrent work per process and aborts only when every waiter has gone.
- The ad-stitched DAI variant is pinned by resolving redirects once, cached in memory for 2 h, so the player and the analyzer hear the same file.
- Access model: anyone can sign up. Only the admin (`PODBLOCK_ADMIN_EMAIL`) can approve accounts, and only approved users can reach `/api/analyze` and `/api/resolve`. Usage is metered per user per month for display only.
- Client state: the `usePlayer` store is persisted to localStorage per user. The `usePlayback` and `useAnalysis` stores are ephemeral.
- Deploy target in the README is Vercel + Turso. Right now it is actually running as `next dev -H 100.92.248.74 -p 3001` (the tailnet address) on this box.

Size: about 5.7 k lines of TS/TSX across 60 files. Server logic is about 1.3 k lines. Four test files.

---

## 2. Gap analysis

Severity: **Critical** = exploitable now or loses data. **High** = must fix before calling it production. **Medium** = should fix. **Low** = polish.

### 2.1 Security

| ID | Sev | Gap | Files | Proposed fix |
|---|---|---|---|---|
| S-1 | **High** | **SSRF filter bypass (confirmed).** `isPrivateAddress` strips only the dotted `::ffff:a.b.c.d` prefix, but `new URL()` normalises `[::ffff:127.0.0.1]` to `[::ffff:7f00:1]`. The hex form falls through the IPv6 checks as "public". I verified that Node `fetch("http://[::ffff:127.0.0.1]:PORT/")` reaches a 127.0.0.1-only server. These are also treated as public: NAT64 `64:ff9b::/96`, 6to4 `2002::/16`, `fec0::/10`, `fe90–febf` (only the `fe80` prefix is matched), `198.18.0.0/15`, `192.0.0.0/24` and the TEST-NETs. Any approved user can make the server GET loopback or metadata endpoints, and `/api/analyze` streams the response body into ffmpeg. | `src/lib/server/guard.ts:35-52` | Parse the address into bytes (e.g. `ipaddr.js`, or `net.BlockList`, which is built in) and unwrap IPv4-mapped, IPv4-compatible, NAT64 and 6to4 addresses before checking. Use a complete IANA special-purpose deny list. Add every probe case to `guard.test.ts`. |
| S-2 | Medium | **DNS-rebinding TOCTOU.** `isPublicUrl` resolves the host, then `fetch` resolves it again. A rebinding domain can return a public IP to the check and a private one to the fetch. | `guard.ts:55-65`, `audio.ts:31-42` | Use an undici `Agent` whose `connect.lookup` validates the addresses it actually connects to, and use it for every outbound fetch of user-supplied URLs. |
| S-3 | Medium | **`resolveAudioUrl` follows redirects blindly** (`redirect: "follow"`). It only checks the *final* URL afterwards, so the server has already sent a GET to any internal hop (blind SSRF). | `audio.ts:204-208` | Reuse `fetchPublic` (manual redirects, check per hop) plus the S-2 agent. |
| S-4 | Medium | **Open redirect after login (confirmed).** `safeNext` accepts `/\evil.com`, which browsers resolve to `https://evil.com/`. The value reaches `redirect(next)` and `window.location.assign(next)`, and is also passed as the OAuth `callbackURL`. | `src/app/(auth)/login/page.tsx:18-20`, `AuthForm.tsx:41,59` | Resolve with `new URL(next, "http://x")`, require `origin === "http://x"`, and reject `\` and control characters. Unit-test it. |
| S-5 | **High** | **Admin bootstrap race.** While no admin exists, anyone who signs up *with the admin email* becomes admin. There is no email verification. `promoteAdmin` also re-promotes that email and un-bans it on every cold start. The README's advice to sign up first after deploying is the only protection, and the repo is public. | `src/lib/server/auth.ts:56-75, 88-95` | Needs a decision (Q3). Options: a one-time `PODBLOCK_SETUP_TOKEN` required for the admin sign-up, a CLI `npm run create-admin`, or email verification. |
| S-6 | Medium | **Shared-cache poisoning.** Verdicts are cached globally by URL, but the episode context (`podcastTitle`, `episodeTitle`, `website`) comes from the client and goes straight into the LLM prompt. An approved user can post crafted context, e.g. "everything is an ad", or analyse a URL with misleading metadata. That poisons the verdicts every other listener gets for that episode. | `src/app/api/analyze/route.ts:16-25`, `analyzer.ts:155-185` | Derive the context server-side from a Podcast Index episode id (Q9), or include a hash of the context in the detector key so poisoned verdicts stay isolated. |
| S-7 | Medium | **Outdated media parser on untrusted input.** `@ffmpeg-installer/ffmpeg@1.1.0` ships a 2018 ffmpeg and is unmaintained. It demuxes and decodes attacker-chosen files. The protocol whitelist limits file and network access but not decoder memory-safety bugs. | `package.json`, `audio.ts:14`, `next.config.ts:16` | Switch to a maintained static build such as `ffmpeg-static` or a pinned johnvansickle release (Q8). Re-check the "static ffmpeg crashes resolving hostnames" workaround (it is still harmless). Add `-t`, `-fs` and CPU limits. |
| S-8 | Medium | **No per-user spend limits.** An approved user (or a stolen session) can analyse unlimited arbitrary URLs. Usage is recorded but never enforced. | `usage.ts`, `analyze/route.ts` | Monthly audio-minute and detect-call caps per user, admin-configurable (Q4). Return 429 with a clear message. |
| S-9 | Medium | **Auth rate limiting is per-instance memory.** Better Auth enables rate limiting in production with `storage: "memory"` (confirmed in `create-context.mjs:172-175`). On Vercel each lambda has its own counter, so login brute-force protection barely works. | `auth.ts:33-82` | `rateLimit: { storage: "database" }`, which adds a table through the existing auto-migration. Also add stricter `customRules` for `/sign-in/email` and `/sign-up/email`. |
| S-10 | Medium | **No security headers.** There is no CSP, `frame-ancestors`/X-Frame-Options, `Referrer-Policy`, `X-Content-Type-Options`, HSTS or `Permissions-Policy`. The admin page can be framed (clickjacking). | `next.config.ts` | `headers()` in next.config. CSP: `default-src 'self'`, `img-src * data:` and `media-src *` (feeds are arbitrary hosts), `frame-ancestors 'none'`, and nonce'd scripts per Next 16 docs. Ship as Report-Only first. |
| S-11 | Low | `BETTER_AUTH_URL`/`baseURL` is unset (build warning), so the origin is derived from the request Host header. That weakens origin checks and OAuth callback correctness behind proxies. | `auth.ts`, `.env.example` | Require `BETTER_AUTH_URL` in production (see C-1). |
| S-12 | Low | Internal error text reaches clients: ffmpeg stderr, `ffmpeg not found at /abs/path`, provider messages, Better Auth internals. | `analyze/route.ts:84-90`, `admin/users/[id]/route.ts:57-59` | Map errors to stable user-facing codes and log the detail server-side. |
| S-13 | Low | `podcast.link` from the feed is rendered as `href` without a scheme check. React 19 neuters `javascript:`, but that is defence by accident. | `src/app/(app)/podcast/[id]/page.tsx:52-60`, `podcastIndex.ts:117` | Allow only `http(s)` in `toPodcast`. |
| S-14 | Low | Prompt injection via transcript audio. The worst case is wrong ads for that window, cached for everyone. | `llm/prompt.ts` | Accept the risk. Clamping already bounds the damage. Add an admin "re-analyse episode" action (cache purge). |
| S-15 | Low | Admin "set password" input is `type="text"` (shoulder-surfing, browser autofill history). | `AdminPanel.tsx:122-131` | Use `type="password"` with a show toggle, or generate a random password server-side. |

### 2.2 Correctness and edge cases

| ID | Sev | Gap | Files | Proposed fix |
|---|---|---|---|---|
| E-1 | Medium | **Time budget exceeds `maxDuration`.** The route allows 120 s, but ffmpeg (90 s) + transcription (90 s) + detection (90 s, and ×2 when the plain-mode retry fires) can reach 360 s. The function gets killed mid-write, the client sees a generic failure, and the per-process in-flight map is lost. | `analyze/route.ts:10`, `audio.ts:9`, `transcribe.ts:12`, `llm/detect.ts:5,84-92` | One deadline (`AbortSignal.timeout(maxDuration-10s)`) threaded through, with per-stage caps inside it. If transcription finishes but detection times out, return 503 with a `retryAfter`. The transcript is already persisted. |
| E-2 | Medium | **No retry or backoff on provider 429/5xx.** One transient error marks the window as errored. After 3 in a row the client gives up until the user clicks Retry. | `transcribe.ts`, `llm/detect.ts`, `useAdScanner.ts:128-144` | Server: one retry with jitter that honours `Retry-After`, only for 429/5xx/network errors. Client: exponential backoff instead of a fixed 8 s. |
| E-3 | Low | `plainOnly` fallback fires on **any** 400/422, including context-length errors, and then permanently downgrades that model for the life of the process. | `llm/detect.ts:84-92` | Fall back only when the error message names `thinking`/`response_format`, or retry plain once without memoising. |
| E-4 | Low | **Aborted `SharedTask` reuse race.** When the last waiter aborts, the controller aborts, but the map entry is only deleted in `finally` once the promise settles. A request arriving in that gap joins the aborted task, gets `AbortError`, and the route returns **499 to a live client**, which counts as a failure. | `analyzer.ts:34-83` | Delete the key from `inflight` synchronously on abort (or check `controller.signal.aborted` in `shared()`). Unit-test it. |
| E-5 | Low | Windows past the end of the audio (unknown duration, or feed duration wrong) come back as 502 "No audio at this position". They count toward the 3-strike error and are never cached. | `audio.ts:176`, `useAdScanner.ts:75` | Treat "no audio at `start > 0`" as an empty, cached window with an `end` flag in the response, so the client stops scanning. |
| E-6 | Medium (unverified) | **Seek accuracy on VBR MP3.** Input-side `-ss` over HTTP estimates the byte offset. If ffmpeg's estimate differs from the browser's, ad timestamps are offset from what is heard. This is the core feature, and there's no test. | `audio.ts:117-138` | Spike: build a fixture set (CBR MP3, VBR with/without Xing TOC, AAC/M4A) with known marker tones, and compare extracted-window timestamps against ground truth. Then decide on a fix (e.g. transcode from 0 for VBR without TOC, or align using overlapping windows). |
| E-7 | Low | DAI pin cache: 2 h in-memory TTL, shared across users. Signed CDN URLs can expire sooner, so a resumed episode then fails to load with only a generic error. | `audio.ts:184-218`, `Player.tsx:147-160,309-316` | On `<audio>` error, re-resolve once with cache bypass. Shorten the TTL or honour `Expires` in the URL/headers. |
| E-8 | Low | `rejectCrossSite` compares `Origin` host with the `Host` header and ignores `PODBLOCK_TRUSTED_ORIGINS`. Behind a proxy that rewrites Host (e.g. `tailscale serve` to localhost), legitimate POSTs get a 403. | `guard.ts:12-33` | Compare against `BETTER_AUTH_URL` plus trusted origins (shared helper). Add tests. |
| E-9 | Medium | **Podcast Index calls have no timeout.** A slow API hangs page renders until the platform timeout. | `podcastIndex.ts:56-64` | `AbortSignal.timeout(8_000)`. Map timeouts to `PodcastIndexError`. |
| E-10 | Low | `error.tsx` always blames the Podcast Index keys and there is no `global-error.tsx`, so root-layout failures show the framework default. | `src/app/error.tsx` | Show a generic message plus a digest. Add `global-error.tsx`. |
| E-11 | Low | Media Session `play` and `pause` both call `toggle`, so a "pause" from headphones while already paused starts playback. | `Player.tsx:575-576` | Use explicit `audio.play()` / `audio.pause()` handlers. |
| E-12 | Low | Stale or incorrect UI copy and keys. The empty transcript says "Transcribing the first minute…" (windows are 5 min). `key={segment.start}` / `key={ad.start}` can collide. | `NowPlayingPanel.tsx` | Fix the copy. Use `${start}-${end}` keys. |
| E-13 | Low | Only the first 100 episodes of a feed are reachable (no pagination). | `podcastIndex.ts:165-173`, `podcast/[id]/page.tsx:27` | Add "load more" using `since`/`max`. Product call (Q13). |
| E-14 | Low | The legacy `user_settings` table (from the per-user-keys era) still exists in DBs created by older builds. There are 41 sessions for 2 users, and expired sessions are never cleaned. | `.data/podblock.db` | Add a schema-versioned migration that drops it. Add a session/verification cleanup job (P-5). |

### 2.3 Error handling and failure modes

Mostly covered above (E-1, E-2, E-5, E-9, E-10, S-12). What's missing overall:
- **No error classification.** Everything is `new Error(string)`, and the routes turn it into 502 with the message. We need typed errors (`UpstreamError{provider,status,retryable}`, `ConfigError`, `InputError`) so routes can pick 400/429/502/503 and the client can decide whether to retry.
- **DB unavailable.** `getDb()` retries on the next call (good), but pages just 500. There's no readiness signal (see O-2).
- **Partial writes.** `transcribeWindow` inserts the transcript, then `addUsage`. If the usage write fails, the request fails even though the work succeeded and was stored. Use `db.batch([...], "write")` so both go in atomically.
- The client already handles aborts, stale episodes and errors well (good). Only the backoff is naive (E-2).

### 2.4 Test coverage

Current: 30 unit tests covering `stripHtml`/format helpers, `whisperLanguage`, `windowStartFor`, `mergeRanges`, `rejectCrossSite`, `isPublicUrl` (missing the bypass forms), `transcribe` and `detectAds`. There is no coverage tool, no DOM tests, no route tests and no E2E.

| ID | Sev | Untested area | Files |
|---|---|---|---|
| T-1 | High | Orchestration: cache hits and misses, detector-key invalidation, usage accounting, `SharedTask` dedupe and abort semantics | `analyzer.ts` |
| T-2 | High | Audio pipeline: loopback proxy, range passthrough, redirects, size and timeout caps, ffmpeg arguments, empty output | `audio.ts` |
| T-3 | High | Auth rules: admin bootstrap, approval gating, `approved` not user-writable via `/update-user`, banned users blocked, `requireAdmin` | `auth.ts`, `session.ts` |
| T-4 | High | Route handlers: input validation, 401/403/415, cross-site refusal, error mapping | `src/app/api/**` |
| T-5 | Medium | `parseAds` edge cases (ranges before the window, NaN, <3 s, chatter), `snapToSpeech`, `formatTranscript` | `llm/prompt.ts`, `ads/merge.ts` |
| T-6 | Medium | Client logic: auto-skip, ignore-after-manual-seek, hold-at-frontier, undo, scanner scheduling and cancellation | `Player.tsx`, `useAdScanner.ts`, `store/*` |
| T-7 | High | No end-to-end test of sign-up → approve → search → play → skip | none |

### 2.5 Logging, metrics and observability

| ID | Sev | Gap | Proposed fix |
|---|---|---|---|
| O-1 | High | There is one `console.error` in the whole server (`analyze/route.ts:89`). No request IDs, no stage timings, no cache hit/miss logging, no provider status or latency logging, no auth event logging. | A small structured JSON logger (`lib/server/log.ts`) with a request-scoped id. Log each analysis stage with `{urlKey, window, stage, ms, cached, provider, status, tokens}`. Log auth and admin actions as audit events. |
| O-2 | Medium | `/api/health` requires login and reports only whether config keys are set. There is no liveness or readiness endpoint for uptime checks, and the DB is never pinged. | Add unauthenticated `/api/healthz` (liveness, no details) and `/api/readyz` (a `SELECT 1` with a timeout). Keep the authed `/api/health` for the setup banner. |
| O-3 | Medium | No error tracking. Server exceptions only appear in platform logs, and client errors are invisible. | Use `instrumentation.ts` `onRequestError` to forward to Sentry (or similar, Q6) and add a client error boundary reporter. |
| O-4 | Low | No cost or quality metrics: $/listened hour, cache hit ratio, ads per hour, undo rate (a proxy for false positives). | Derive them from the logs. Optionally add cost estimates and undo counts (sent by the client) to the admin page. |

### 2.6 Config and secrets

| ID | Sev | Gap | Files | Proposed fix |
|---|---|---|---|---|
| C-1 | Medium | Env vars are read ad hoc in 7 places with no validation at startup. Misconfiguration only surfaces on the first request that needs it. | `config.ts`, `auth.ts`, `db.ts`, `podcastIndex.ts`, `audio.ts`, `next.config.ts` | One schema (e.g. zod) in `lib/server/env.ts`, validated in `instrumentation.ts` `register()`. In production, fail fast on missing `BETTER_AUTH_SECRET`/`BETTER_AUTH_URL`/`DATABASE_URL`. `doctor.mjs` should import the same schema. |
| C-2 | Low | `.env.example` is missing `BETTER_AUTH_URL`, `PODCAST_INDEX_API_SECRET_BASE64`, `PODBLOCK_DATA_DIR` and `DEV_ALLOWED_ORIGINS` (the last one is also absent from the README). | `.env.example`, `README.md` | Document them all, generated from the schema in C-1. |
| C-3 | Low | Secret hygiene is good: no secrets committed, API keys are server-only, the doctor masks the DB URL. The Podcast Index request signature uses SHA-1 because the API requires it. No action. | — | — |
| C-4 | Low | `DETECT_MODEL` is part of the verdict cache key, so switching models silently re-bills every episode for everyone. This is intended but undocumented operationally. | `analyzer.ts:24-26` | Document it in the runbook. |

### 2.7 Performance hotspots

| ID | Sev | Hotspot | Files | Proposed fix |
|---|---|---|---|---|
| P-1 | Medium | **Every request validates the session against the DB.** Every page render and API call runs `auth.api.getSession`, which is a Turso round-trip. The layout also runs it, then pages call `currentUser()` again. | `session.ts:16-30`, `(app)/layout.tsx:13`, pages | Enable Better Auth `session.cookieCache` (e.g. 5 min). Wrap `currentUser` in React `cache()` so it runs once per request. |
| P-2 | Medium | **Migrations on every cold start.** `getAuth()` runs `getMigrations()` (schema introspection) and `getDb()` runs the `CREATE TABLE IF NOT EXISTS` batch on each new lambda. | `auth.ts:103-118`, `db.ts:59-71` | Run migrations in an explicit step (`npm run migrate`, run from the deploy pipeline). At runtime, only verify a `schema_version` row. |
| P-3 | Low–Med | **Each POST /api/analyze re-reads and JSON-parses every window of the episode** (`episodeAnalysis`) to recompute ads. That is O(windows) per request and O(n²) per episode. A 3 h episode means about 36 × ~150 segments parsed per call. Each request also makes about 5 sequential DB round-trips. | `analyzer.ts:106-120, 194-214` | Return only this window's ads plus a merge of the stored ads. Keep `snapToSpeech` to the boundary segments by storing each window's first segment start. Combine the lookups into one query. |
| P-4 | Low–Med | **The transcript panel re-renders every line about 4×/s**, because `Transcript` subscribes to `currentTime` and passes new props. It also rescans for `activeIndex` linearly, and there is no virtualisation (3 h ≈ 3,000 buttons). `PlayerBar` subscribes to the entire `usePlayback()` and `usePlayer()` stores. | `NowPlayingPanel.tsx`, `Player.tsx:335-336, 413` | Subscribe to a derived `activeIndex` (binary search). `memo` the lines. Use `useShallow` selectors. Virtualise the list if profiling shows a need. |
| P-5 | Low | Unbounded growth: transcripts and verdicts are kept forever, as are expired sessions and verifications. Old-detector verdict rows linger after a model change. | `db.ts` | A scheduled cleanup (Vercel Cron or a script) with retention set by Q5. |
| P-6 | Low | Cross-instance duplicate work. `SharedTask` dedupes only within one lambda, so two listeners hitting different instances each pay for the window. | `analyzer.ts` | Accept for now. If it matters, add a DB lease row (`INSERT … ON CONFLICT DO NOTHING` + poll). |

### 2.8 Build and CI

| ID | Sev | Gap | Proposed fix |
|---|---|---|---|
| B-1 | High | **No CI.** There is no `.github/`, and nothing runs `check` or `build` on push or PR. | GitHub Actions: `npm ci` → typecheck → lint → test (with coverage) → build → `npm audit --omit=dev`. |
| B-2 | Medium | The Node version is unpinned (`engines >=20.9`, and the dev box runs Node 24). Dependencies use caret ranges; the lockfile exists (good). | Add `.nvmrc`, `engines` pinned to a major, `packageManager` field, and Dependabot/Renovate. |
| C-9 | Medium | **The build touches the database.** `currentUser()` awaits `getAuth()` (DB connect + migrations) *before* `headers()` marks the route dynamic. So `next build` prerender creates `.data/podblock.db` (verified). On Vercel with `DATABASE_URL` set at build time, it would connect to and migrate prod during the build, contradicting the comment in `db.ts:56`. | Call `await headers()` (or `connection()`) first in `currentUser`. Verify that a clean-dir build creates no `.data/`. |
| B-3 | Low | Leftover and untracked artifacts: `.venv/` (2.1 GB of old local-Whisper tooling), `AGENTS.md`/`CLAUDE.md` untracked (the `next dev` banner asks for them to be committed), and stale remote branches `TRANSCRIPTION`/`WASM`. `vercel-api` is ahead of `main`. | Decisions in Q10. |

### 2.9 Packaging and deployment

| ID | Sev | Gap | Proposed fix |
|---|---|---|---|
| D-1 | Medium | Vercel-only packaging. `outputFileTracingIncludes` ships only `linux-x64` ffmpeg. There is no Dockerfile or `output: "standalone"` for self-hosting, yet the app currently runs as `next dev` on the tailnet: a dev server with dev error overlays and no minification. | Depends on Q1. For self-hosting: `output: "standalone"`, a multi-stage Dockerfile with a pinned ffmpeg, and a documented `next start` run. |
| D-2 | Medium | No environment separation. Preview deployments would share the prod Turso DB and API keys. There is no backup or restore process for Turso. | Separate Turso DBs (or branches) per environment. Document the Turso PITR/backup command in the runbook. |
| D-3 | Low | No `vercel.json` (region pinning near Turso, function memory for ffmpeg). | Add after measuring. |

### 2.10 Docs

| ID | Sev | Gap | Proposed fix |
|---|---|---|---|
| X-1 | Low | The README is good (setup, architecture, config, limits). Missing: an ops runbook (rotate keys, re-analyse an episode, reset admin, back up the DB, read logs), a security model / `SECURITY.md`, `CONTRIBUTING.md` (how to run tests and E2E), `CHANGELOG`, and a `LICENSE` (the repo is public and has no license, Q11). | Add these as the relevant work lands. |

---

## 3. Ordered work items

Progress is tracked by checking items off (`[x]`); notes on what was learned follow each item. Blocked items are marked `[blocked: Q#]` and skipped until answered.

### New dependencies (each needs a one-line justification)

| Package | Kind | Why |
|---|---|---|
| `@vitest/coverage-v8` | dev | Vitest's own coverage provider, pinned to the Vitest version; needed for the coverage baseline and per-file targets (e.g. analyzer > 90%). |

Each item is one commit. Security fixes come first, after CI so every later commit is verified automatically. Items marked **(Q#)** are blocked on an open question.

### Phase 0: Safety net
1. [x] **CI workflow.** `.github/workflows/ci.yml`: `npm ci`, typecheck, lint, test, build, `npm audit --omit=dev`. Add `.nvmrc`. *Verify:* push the branch; the Actions run is green, and a deliberately broken test fails it (throwaway commit, not merged).
   - *Done:* Added `.github/workflows/ci.yml` (Node from `.nvmrc` = 24, npm cache, ci → typecheck → lint → test → build → `npm audit --omit=dev --audit-level=high`). Verified locally by running the same steps from a clean `git ls-files` checkout with `npm ci`: all green. **Not yet verified on GitHub: needs a push, which I haven't done.** Learned: npm 11 skips install scripts by default (`@ffmpeg-installer/linux-x64` postinstall is `chmod u+x`), but the tarball's binary is already executable, so ffmpeg still works.
2. [x] **Coverage tooling.** Add `@vitest/coverage-v8` and a `test:coverage` script, and upload the report in CI. No thresholds yet. *Verify:* CI artifact shows the baseline %, which gets recorded in the PR.
   - *Done:* `npm run test:coverage` (v8 provider, text-summary + html + json-summary). CI runs it and uploads `coverage/` as an artifact. **Baseline: 8.8% of lines overall; `lib/server` 23.0% (91/395), shared `lib` 84.8%, UI/app/store/hooks 0%.**

### Phase 1: Security
3. [x] **Fix SSRF address classification (S-1).** Replace `isPrivateAddress` with byte-level CIDR checks that unwrap mapped, compatible, NAT64 and 6to4 addresses. *Verify:* new `guard.test.ts` cases (`[::ffff:7f00:1]`, `[::ffff:169.254.169.254]`, `[64:ff9b::7f00:1]`, `[2002:7f00:1::]`, `[fec0::1]`, `[febf::1]`, `198.18.0.1`) fail before the change and pass after.
   - *Done:* Tests first: 18 of the new `guard.test.ts` cases failed on the old code. New `isPublicAddress` uses Node's built-in `net.BlockList` (no new dependency) with the full IANA special-purpose lists. IPv4-mapped, IPv4-compatible and NAT64 addresses are judged by their embedded IPv4 address. Anything outside 2000::/3 is private. Learned/deviation: 6to4 (2002::/16) and Teredo (2001::/32) are **blocked outright** rather than unwrapped, since no podcast host lives there and Teredo obfuscates the IPv4 address. `isPublicAddress` is exported for the connect-time check in #4.
4. [x] **Connect-time IP pinning (S-2).** An undici `Agent` with a validating `lookup`, used by `fetchPublic`. *Verify:* a unit test with a stubbed `lookup` returning public then private addresses is refused at connect time.
   - *Done:* New `src/lib/server/safeFetch.ts`: `fetchPublic` uses `node:http`/`node:https` with a `lookup` hook that rejects unless every resolved address passes `isPublicAddress`. IP literals are checked directly. Redirects are followed manually (max 5), re-checked per hop, and the final URL is returned. **No undici dependency**: Node's global `fetch` has no public connect hook, and a userland undici `Agent` must match Node's bundled version. 11 tests use a local server and a stub resolver (including one that returns public then private); the server records zero hits for refused requests. Added `audio.test.ts` characterization tests (real bundled ffmpeg, generated MP3 fixture, local range-serving server) *before* switching `audio.ts` over. They surfaced two things: **(a)** past the end of the file ffmpeg emits a header-only FLAC, so the "No audio at this position" error never fires (E-5 is really "empty FLAC sent to the transcription API"); **(b)** `extractWindow` ignores an already-aborted signal (recorded as `it.fails`, to be fixed in #18).
5. [x] **Safe redirects in `resolveAudioUrl` (S-3).** Route it through `fetchPublic`. *Verify:* a test with a local redirect fixture (guard injected) confirms the internal hop is never requested.
   - *Done:* Test first: with no address allowed, the fixture server must see zero requests. It failed (the old `fetch` with `redirect: "follow"` hit it). `resolveAudioUrl` now uses `fetchPublic` and takes the final URL from it. The route's after-the-fact `isPublicUrl(resolved)` check stays as a second layer.
6. [x] **Fix the open redirect (S-4).** Move `safeNext` into a shared util and use it in the login page, AuthForm and social `callbackURL`. *Verify:* tests for `/\evil.com`, `/\/evil.com`, `//x`, `%5C`, `javascript:`, and valid `/podcast/1?x=y`.
   - *Done:* New `src/lib/redirect.ts` `safeNext` rejects backslashes and control characters, parses against a sentinel origin, and rejects paths that normalise to `//host` (e.g. `/..//evil.com`, which the plan's list had missed). The old check accepted `/\evil.com`, `/\/evil.com`, `/<tab>/evil.com` and `/..//evil.com`. Used by the login page and again in `AuthForm` for both `location.assign` and the OAuth `callbackURL`. 19 tests.
7. [blocked] **Admin bootstrap hardening (S-5) (Q3).** *Verify:* an auth test on a temp DB: signing up with the admin email without the token or verification does not create an admin, and the intended path does.
   - *Blocked:* Q3 (admin bootstrap mechanism: setup token vs CLI vs email verification).
8. [x] **Better Auth hardening (S-9, S-11).** `rateLimit.storage = "database"` with custom rules, `baseURL` from the env, and `useSecureCookies` in production. *Verify:* an auth test where N+1 rapid failed sign-ins return 429; the build warning about the base URL is gone.
   - *Done:* `rateLimit: { storage: "database" }`; the existing auto-migration creates the `rateLimit` table. New `auth.test.ts` runs Better Auth in production mode on a temp SQLite DB. Test first: "counts live in the database" failed (`no such table: rateLimit`). Learned: **(a)** a "two instances" test can't catch per-instance memory, because Better Auth's memory store is one module-level `Map` per process; **(b)** Better Auth's defaults already give 3 attempts / 10 s on `/sign-in`, `/sign-up` and `/change-password`, so no custom rules were needed; **(c)** `BETTER_AUTH_URL` is already read from the env, and secure cookies are on automatically in production or with an https base URL, so S-11 moves to #34/#35 (require and document it). **(d) Self-hosting caveat:** the client IP comes only from `x-forwarded-for`. With no proxy in front (e.g. direct `next start`), every client shares one bucket per path, so strangers can lock everyone out of sign-in. That needs `advanced.ipAddress` config once Q1 is answered.
9. [x] **Security headers (S-10).** A CSP in Report-Only mode plus the other headers. *Verify:* `curl -I` on `next start` shows the headers; manual smoke test (play, search, sign-in, OAuth button) with no CSP reports in the console. Switch to enforce in a follow-up commit.
   - *Done:* Two commits: headers + CSP in report-only mode, then enforced. Tests first (`securityHeaders.test.ts`; the enforcement tests failed until the switch). Verified with a **browser smoke test** (headless Chromium via a scratchpad-only `playwright-core`, against `next start` on a temp DB with the real Podcast Index keys): sign-up → trending → podcast page → **episode plays** (`currentTime > 1`) → transcript panel → search → settings → admin, with zero CSP violations or page errors in both modes. An iframe of `/login` doesn't render. Decisions and learned: **no-nonce CSP** (the Next docs' "Without Nonces" pattern) because a nonce CSP would need restructuring the auth proxy, which skips `/login` and `/api/auth`. Trade-off: `script-src 'unsafe-inline'`, so the CSP limits but doesn't prevent inline-script XSS. Media and images are allowed from any http(s) host (arbitrary feeds). No `upgrade-insecure-requests` (it would break http-only podcast hosts). HSTS is production-only, without `includeSubDomains`. **Not verified:** the running `next dev` on :3001 hasn't reloaded the config yet (no CSP header seen), so dev mode under enforcement (HMR websocket, eval) is untested live. It's covered by `'self'` and `'unsafe-eval'` in dev. The smoke script lives in the scratchpad for now and becomes the Playwright E2E in #30.
10. [x] **Safe error surfaces (S-12, S-13, S-15).** An error→code mapping in routes, http(s)-only `podcast.link`, and the password field type. *Verify:* route tests assert that no stderr or paths appear in response bodies; a unit test for `toPodcast` with `javascript:`.
   - *Done:* New `src/lib/server/errors.ts`: `AppError(kind: config|audio|transcription|detection, internalMessage, {publicMessage})` plus `publicError()` → `{error, code}` with 503 for config, 502 otherwise, and a generic message for untagged errors. Errors are tagged at the source (`transcribe.ts`, `llm/detect.ts`, `llm/prompt.ts`, `audio.ts` wraps non-abort failures, `analyzer.ts` config). The analyze route logs the details and returns only the public message. The admin route passes Better Auth `APIError` messages through with their real status (was always 500) and hides everything else. `toPodcast` keeps `link` only if http(s). The admin password field is masked with a Show toggle. **Tests first, characterization before each change:** new `analyze/route.test.ts` (16), `admin/users/[id]/route.test.ts` (6), `podcastIndex.test.ts` (10) and `analyzer.test.ts` (3, config paths only; full suite in #25), plus kind assertions in the transcribe, detect and audio tests. The smoke test now also covers a second user signing up → pending page → admin approves → Set password (masked, Show toggles, saves). Learned: `JSON.stringify(Error)` is `{}`, so log assertions must stringify with `String()`. #15 extends `AppError` with retryability and deadlines rather than creating the module.
11. [blocked] **Replace the ffmpeg binary (S-7) (Q8).** *Verify:* `npm run doctor` shows the new version; the audio integration test (#20) passes; the Vercel preview analyses a real window.
   - *Blocked:* Q8 (OK to switch to a maintained ffmpeg build such as `ffmpeg-static`?). The audio characterization tests from #4 are ready to validate a swap.
12. [blocked] **Trusted episode context (S-6) (Q9).** *Verify:* a route test where client-supplied titles are ignored or cannot affect another user's cached verdict.
   - *Blocked:* Q9 (server-derived episode context vs. context-hashed verdict cache).
13. [blocked] **Per-user quotas (S-8) (Q4).** *Verify:* an analyzer test that returns 429 once the cap is reached; the admin page shows remaining quota.
   - *Blocked:* Q4 (quota values, hard block vs. notify, admin exemption).

### Phase 2: Correctness
14. [x] **Build must not touch the DB (C-9).** Call `headers()` before `getAuth()`. *Verify:* `next build` in a clean copy leaves no `.data/`, and there is no Better Auth log during prerender.
   - *Done:* `currentUser()` now awaits `headers()` before `getAuth()`. Test first (`session.test.ts`: a headers bailout must not call `getAuth`), plus characterization of the `currentUser`/`requireUser`/`requireAdmin` rules. **Verified:** the clean-copy `next build` no longer creates `.data/`, and both Better Auth build-time messages (the base URL warning and the default-secret error) are gone. They were symptoms of auth starting during prerender.
15. **Typed errors + deadline budget (E-1, §2.3).** Add `lib/server/errors.ts`, thread one deadline through, and map to 400/429/502/503. *Verify:* fake-timer tests where a slow stage aborts before `maxDuration` and returns 503 with `retryAfter`.
16. **Provider retry/backoff (E-2, E-3).** *Verify:* `transcribe`/`detect` tests: 429 with `Retry-After` retries once; 401 does not retry; a context-length 400 does not set `plainOnly`.
17. **Atomic writes (§2.3).** Put the transcript and usage writes in one `batch`. *Verify:* an analyzer test where a usage-write failure leaves no half state (or both rows exist).
18. **SharedTask abort race (E-4).** *Verify:* a unit test: waiter A aborts, waiter B joins right away and gets a fresh task.
19. **End-of-audio windows (E-5).** *Verify:* an analyzer test where empty extraction at `start > 0` is cached as empty with `end: true`; the scanner stops requesting.
20. **Audio pipeline integration tests (T-2).** Generate a tone fixture with the bundled ffmpeg and serve it from a local HTTP server with range support. Make the guard injectable for tests only. *Verify:* tests cover range seeking, redirect chains, the size cap and timeout, and run in CI in under 10 s.
21. **Seek-accuracy spike (E-6).** Fixture matrix plus a report committed in `docs/`. The fix follows as its own item if needed. *Verify:* the report shows measured offsets per format.
22. **Podcast Index timeouts + error pages (E-9, E-10).** *Verify:* a test where a stubbed hanging fetch rejects within 8 s; manual check that `global-error.tsx` renders.
23. **Cross-site check uses the configured origins (E-8).** *Verify:* `guard.test.ts` cases for a trusted origin behind a rewritten Host.
24. **Player fixes (E-7, E-11, E-12).** Re-resolve on load error, explicit media-session handlers, copy and keys. *Verify:* component tests (#28), plus a manual check with headphone buttons.

### Phase 3: Tests
25. **Analyzer tests (T-1)** on a temp-file libSQL DB with stubbed extract, transcribe and detect. *Verify:* coverage of `analyzer.ts` above 90%.
26. **Auth/session tests (T-3)**, including `approved` not being settable via `/api/auth/update-user`. *Verify:* the tests fail if `input: false` is removed.
27. **Route handler tests (T-4)** for all five API routes. *Verify:* every documented 4xx path is asserted.
28. **Client logic tests (T-6).** Add a DOM environment (happy-dom plus Testing Library). Extract the auto-skip decision from `Player.onTimeUpdate` into a pure function (a small refactor, behaviour-preserving) and test the scanner scheduling. *Verify:* tests for skip, ignore after a manual seek, hold and release, undo, and cancel-on-seek.
29. **Fake providers for E2E.** A local OpenAI-compatible stub and a Podcast Index stub. Add base-URL overrides via env for Podcast Index; transcription and detection already have them. *Verify:* `npm run dev` against the stubs lets you play a fixture episode with a known ad.
30. **Playwright E2E (T-7).** Admin sign-up → user sign-up → pending → approve → search → play → auto-skip → undo. Uses the pre-installed Chromium. *Verify:* green locally and in CI (separate job).

### Phase 4: Observability
31. **Structured logger + request ids (O-1).** *Verify:* one analyse request produces one JSON line per stage with timings; the admin actions log audit events.
32. **`/api/healthz` + `/api/readyz` (O-2).** *Verify:* `curl` without a cookie returns 200/`{ok:true}`; with the DB unreachable, readyz returns 503.
33. **Error tracking (O-3) (Q6).** *Verify:* a thrown test error appears in the chosen tool from both a server route and a client component.

### Phase 5: Config
34. **Env schema + fail-fast (C-1, S-11).** `doctor.mjs` imports the same schema. *Verify:* unit tests for the schema; `next start` with `BETTER_AUTH_SECRET` missing exits with a clear message.
35. **`.env.example` and README config table synced (C-2, C-4).** *Verify:* a script or test asserts that every schema key appears in `.env.example`.

### Phase 6: Performance
36. **Session cookie cache + `cache(currentUser)` (P-1).** *Verify:* DB query count per page load (with logging from #31) drops from N to 0–1.
37. **Explicit migrations (P-2, E-14).** Add `npm run migrate` and a `schema_version` table, and drop `user_settings`. *Verify:* a cold start issues no DDL; running migrate twice is a no-op; a test DB from the old schema migrates cleanly.
38. **Cheaper analyse path (P-3).** *Verify:* the analyzer tests still pass; a benchmark on a synthetic 36-window episode shows per-request DB time roughly flat as windows grow.
39. **Transcript/player render cost (P-4).** *Verify:* React Profiler shows the transcript panel committing ≤1×/s during playback with a 3 h transcript loaded.
40. **Retention/cleanup job (P-5) (Q5).** *Verify:* a test that seeds old rows, runs the job, and checks that only the expected rows remain.

### Phase 7: Build, packaging and repo hygiene
41. **Dependency automation + Node pinning (B-2).** *Verify:* the Dependabot config validates; CI uses `.nvmrc`.
42. **Self-host packaging (D-1) (Q1).** `output: "standalone"`, a Dockerfile and a compose example. *Verify:* `docker build` and `docker run`, then the E2E suite passes against the container.
43. **Environment separation + backups (D-2, D-3).** *Verify:* preview deploys point at a non-prod DB (visible via readyz metadata); the backup/restore runbook is exercised once.
44. **Repo cleanup (B-3) (Q10).** *Verify:* `git status` is clean, and the branch list matches the agreed set.

### Phase 8: Docs
45. **Runbook, SECURITY.md, CONTRIBUTING.md, CHANGELOG, LICENSE (X-1) (Q11).** *Verify:* a new contributor can go from clone to green `npm run check` and E2E using only the docs (dry-run on a clean checkout).

---

## 4. Open questions (need your input)

1. **Deployment target.** Vercel + Turso only, self-hosted on this box, or both? Today it runs as `next dev` on the tailnet. This decides items 42–43, the rate-limit storage choice, and whether ffmpeg needs arm64 or other builds.
2. **Audience and scale.** Friends and family (≤20 users) or open to the public? That sets how strict quotas, rate limits, email verification and abuse controls need to be.
3. **Admin bootstrap (S-5).** Which fix: a one-time setup token env var, a CLI `create-admin` script, or email verification (which needs an email provider)?
4. **Quotas (S-8).** What monthly limits per user (audio minutes / detect calls)? Hard block, or notify the admin? Is the admin exempt?
5. **Data retention.** How long should transcripts and verdicts be kept (forever / N days since last access)? Should old-detector verdicts be purged after a model change?
6. **Error tracking and logs.** Is Vercel's built-in logging enough, or do you want Sentry, Axiom or OpenTelemetry? Any budget?
7. **Email.** Add a transactional email provider (e.g. Resend) for verification and password reset, or keep admin-set passwords?
8. **ffmpeg (S-7).** OK to switch to `ffmpeg-static` or another maintained build? That changes the bundle size and the Vercel trace config.
9. **Episode context (S-6).** OK to change `/api/analyze` to take a Podcast Index episode id and look up the URL and metadata server-side? That drops support for analysing arbitrary audio URLs. Alternatively, keep URLs and scope verdict caching by a context hash.
10. **Repo hygiene.** Is `main` or `vercel-api` the production branch? Commit `AGENTS.md`/`CLAUDE.md`? Delete the 2.1 GB `.venv/` and the `TRANSCRIPTION`/`WASM` remote branches?
11. **License.** The repo is public with no license. Which license, or should it be made private?
12. **Real-API smoke test.** OK to spend a small amount on a nightly CI job that analyses one real window with real keys stored as GitHub secrets? Otherwise the E2E suite uses only stubs.
13. **Scope.** Are episode pagination (E-13) and other features in scope for "production quality", or strictly hardening?
