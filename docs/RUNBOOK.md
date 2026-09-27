# Operating Podblock

For whoever runs a Podblock server. Setup is in the [README](../README.md); this covers keeping it running.

## Health and configuration

| Check | What it tells you |
|---|---|
| `GET /api/healthz` | The server process is up. No sign-in, no details. Returns **500** if the configuration check failed at startup (see below). |
| `GET /api/readyz` | The database answers within 3 s: `200 {"ok":true,"database":"ok"}` or `503 {"ok":false,"database":"unavailable"}`. The reason is in the log (`readyz.database`). |
| `npm run doctor` | Checks Node, ffmpeg and `.env.local` with the same rules the server applies at startup. Prints what's wrong, never values. |

**At startup** the server checks its settings (`src/lib/server/envSchema.mjs`). Problems that would make features silently not work are logged as `config.warning`. In production, a broken configuration (a missing or short `BETTER_AUTH_SECRET`, no `DATABASE_URL` on Vercel, malformed URLs or emails) is logged as `config.invalid`, and the server then answers **every request with 500**, including `/api/healthz`, until it's fixed. It doesn't exit, so point your uptime check at `/api/healthz`.

## Logs

The server writes one JSON object per line to stdout/stderr (Vercel's log viewer, or `next start`'s output). Every line has `time`, `level` and `event`. Lines from a request also carry a `requestId` (from `x-request-id`, else `x-vercel-id`). Configured secrets are replaced with `[redacted]`. Set the level with `PODBLOCK_LOG_LEVEL` (`debug`, `info`, `warn`, `error`, `silent`).

| Event | When |
|---|---|
| `analysis.transcribed` | A window was transcribed: `extractMs`, `transcribeMs`, `bytes`, `audioSeconds`, `segments`, `userId`. |
| `analysis.detected` | A window was checked for ads: `detector`, `detectMs`, `ads`, `inputTokens`, `outputTokens`. |
| `analysis.end_of_audio` | A window past the end of the file (nothing paid for). |
| `analysis.failed` / `analysis.stopped` | A window failed (with `code` and the full `err`), or hit the 110 s deadline. |
| `provider.retry` / `provider.retry_skipped` | Transcription or detection answered 429/5xx or dropped the connection, and was retried (or `Retry-After` was too long to wait). |
| `podcastindex.failed` | A Podcast Index call failed or timed out (8 s). |
| `request.error` | An unhandled error while rendering a page or running a route. Its `digest` is the **Reference** shown on the error page, so a listener's report can be found by it. |
| `admin.action` | An admin approved, disabled, re-enabled or deleted an account, or set a password (`adminId`, `action`, `targetEmail`, `ok`). Passwords are never logged. |
| `auth` | Better Auth's own messages. |
| `schema.migrated` | The database schema was brought up to date. |
| `retention.cleanup` | The daily cleanup ran: how many transcripts, verdicts, sessions, verifications and rate-limit rows it removed. `retention.not_configured` means `CRON_SECRET` isn't set. |
| `config.warning` / `config.invalid` | See above. |

## Deploying

1. `npm run doctor` locally with the production settings, or check them in Vercel's project settings.
2. **Migrate first** when the schema changed: `DATABASE_URL=... DATABASE_AUTH_TOKEN=... npm run migrate`. It's safe to run repeatedly and prints `Migrated (...)` or `Already up to date (...)`. The server would also migrate on its own on first use, but doing it before the deploy keeps that off the first listener's request.
3. Deploy, then check `/api/readyz`.

## Accounts

- **Creating the admin account:** set `PODBLOCK_ADMIN_EMAIL` and `PODBLOCK_SETUP_CODE` (`openssl rand -hex 12`), open `/signup`, and enter the code; the form asks for it until the admin exists. A refused attempt is logged as `auth.owner_signup_refused`. Signing in with GitHub or Google (verified email) works without the code.
- **Approving people:** Users in the account menu. A newly approved person gets in straight away ("Check again").
- **Disabling someone:** Users → Disable. Their sessions are revoked, but a signed session cookie can stay valid for up to **60 seconds** (the session cookie cache), so allow a minute.
- **Someone forgot their password:** Users → Set password, then tell them the new one privately. There's no email reset (open question Q7).
- **The admin forgot their password:** there is no in-app recovery yet. Keep it in a password manager. (Tracked with Q7.)
- **Changing who the admin is:** approve that person's account first, then set `PODBLOCK_ADMIN_EMAIL` to its email and restart. On startup it becomes an un-banned admin (only approved or provider-verified accounts are promoted this way). The previous admin keeps the admin role until changed in the database.

## Keys and settings

| Change | Effect |
|---|---|
| `TRANSCRIBE_API_KEY`, `DETECT_API_KEY`, `PODCAST_INDEX_*` | Takes effect on restart or redeploy; nothing else to do. |
| `BETTER_AUTH_SECRET` | **Signs everyone out.** Rotate it if it may have leaked. |
| `DETECT_MODEL` (or the detection prompt's `PROMPT_VERSION`) | Stored verdicts are keyed by model and prompt version, so every episode listened to afterwards is **re-detected and billed again** (transcripts are reused). |
| `TRANSCRIBE_MODEL` | Stored transcripts are kept and reused; only new windows use the new model. |

## Housekeeping

Transcripts and verdicts are kept for **30 days** (`RETENTION_DAYS` in `src/lib/server/retention.ts`); after that, listening again pays for the analysis again. Vercel Cron calls `/api/cron/cleanup` daily at 04:30 UTC (`vercel.json`) with `CRON_SECRET`; it also removes verdicts whose transcript is gone, expired sessions and verifications, and old rate-limit counters. Check the Cron Jobs tab in Vercel, or the `retention.cleanup` log line. To run it by hand: `curl -H "Authorization: Bearer $CRON_SECRET" https://<your site>/api/cron/cleanup`.

## Re-analysing an episode

If an episode's ads were detected badly, delete its verdicts; the next listen re-detects them (transcripts are kept, so only detection is paid for again). In the database (Turso shell, or any SQLite tool on `.data/podblock.db`), match on part of the audio URL:

```sql
DELETE FROM analysis_verdict
WHERE url_key IN (SELECT url_key FROM analysis_window WHERE url LIKE '%part-of-the-episode-url%');
```

To redo the transcripts too, also run `DELETE FROM analysis_window WHERE url LIKE '%part-of-the-episode-url%';`.

## Backups

- **Local SQLite** (`.data/podblock.db`): a consistent copy while the server runs:

  ```bash
  node -e 'require("@libsql/client").createClient({ url: "file:.data/podblock.db" }).execute("VACUUM INTO '"'"'backup.db'"'"'")'
  ```

  To restore, stop the server and replace `.data/podblock.db` with the backup (delete any `podblock.db-wal` and `-shm` files next to it).
- **Turso:** Turso keeps point-in-time history and has a CLI to dump or branch a database. Check their current documentation for the exact commands on your plan. Test a restore into a *new* database once, before you need it.

## When things go wrong

| Symptom | Look for |
|---|---|
| "Ad detection paused: …" in the player | `analysis.failed` lines: `code` `transcription`/`detection` point at the provider (check its status page and your credit), `audio` at the podcast host, `config` at missing keys. |
| Every page and `/api/healthz` return 500 | `config.invalid` at startup. |
| `/api/readyz` returns 503 | `readyz.database`: wrong `DATABASE_URL` or token, or the database is down. |
| Search or episode pages fail | `podcastindex.failed`: the Podcast Index keys, or their API being slow or down. |
| A listener sends an error Reference | `request.error` with that `digest`. |
| Sign-in answers 429 | Rate limiting (3 attempts per 10 s per address). Behind a proxy that doesn't send `X-Forwarded-For`, all visitors share one limit. |
| Costs higher than expected | The Users page shows each person's usage this month; `analysis.transcribed` and `analysis.detected` lines show per-window cost. |
