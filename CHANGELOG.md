# Changelog

## Unreleased

Production hardening; see `PRODUCTION_PLAN.md` for the full audit and the reasoning behind each change.

### Security

- Creating the admin account takes a one-time setup code (`PODBLOCK_SETUP_CODE`) or a provider-verified email.
- Closed ways around the private-network check for episode audio (IPv4 embedded in IPv6, NAT64, 6to4, Teredo, special-purpose ranges), and check the addresses actually connected to, on every redirect.
- Fixed an open redirect after sign-in (`/\evil.com`).
- Sign-in rate limits now hold across serverless instances.
- Security headers and an enforced content security policy.
- Error responses no longer include internal details; feed website links must be http(s).

### Fixed

- `next build` no longer opens the database.
- Analysis gives up cleanly before the function's time limit, retries rate limits and brief outages once, and never keeps paid work without recording its usage.
- A listener arriving while cancelled work winds down no longer gets an error.
- Windows past the end of an episode are no longer sent to be transcribed.
- "Try again" on the error page actually re-fetches, and a failing page no longer stops playback.
- An expired audio link is re-pinned once instead of failing; headphone pause can't start playback.
- Podcast Index calls time out after 8 s.
- The app's own requests work behind proxies that rewrite the Host header.

### Added

- Daily cleanup (Vercel Cron, `CRON_SECRET`): transcripts and verdicts are kept for 30 days.
- MIT license.
- Structured JSON logs with request ids, stage timings and an admin audit trail; unhandled errors logged with the reference shown to users.
- `/api/healthz` and `/api/readyz`.
- Startup configuration check (shared with `npm run doctor`), and documentation for every setting.
- Versioned database schema and `npm run migrate`.
- Tests: unit, integration (real ffmpeg, real Better Auth), client (happy-dom) and end-to-end (Playwright against fake providers); CI on Node 22 and 24; Dependabot.
- `docs/RUNBOOK.md`, `docs/seek-accuracy.md`, `SECURITY.md`, `CONTRIBUTING.md`.

### Changed

- ffmpeg is now 7.0.2 from the maintained `ffmpeg-static` package, instead of a 2018 build.
- Constant-bitrate MP3 and M4A windows are fetched by jumping to them (about 50× less downloaded late in an episode); variable-bitrate MP3 keeps the exact read.
- Session checks mostly come from a 60-second signed cookie instead of the database.
- A cached analysis request reads only the transcripts it needs.
- The transcript panel re-renders when the current line changes, not on every playback tick.
- The player backs off between retries and follows the server's `Retry-After`.
- Node.js 22 or newer is required.
