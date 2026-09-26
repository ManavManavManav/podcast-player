# Contributing

## Setup

You need Node.js 22 or newer (24 is what CI uses; `nvm use` reads `.nvmrc`).

```bash
git clone https://github.com/ManavManavManav/podcast-player.git
cd podcast-player
npm ci
npm run check            # typecheck, lint, unit and integration tests
```

That's enough for development against the fake providers (no keys needed):

```bash
npm run fake-providers   # in one terminal; prints the settings to use
# put those settings in .env.local, plus BETTER_AUTH_SECRET and PODBLOCK_ADMIN_EMAIL
npm run dev              # open the Local address it prints (port 3000 unless that's taken)
```

For real podcasts, copy `.env.example` to `.env.local` and fill in the keys (see the README), then `npm run doctor`.

## Tests

| Command | What |
|---|---|
| `npm test` | Unit and integration tests (Vitest). The audio tests run the bundled ffmpeg against a local server; the auth and analyzer tests use a throwaway SQLite database. |
| `npm run test:coverage` | The same, with a report in `coverage/`. |
| `npm run build && npm run test:e2e` | End-to-end tests in Chromium against the production build, the fake providers and a throwaway database. The first time, install the browser: `npx playwright install chromium`. |

Client code is tested in a DOM (`// @vitest-environment happy-dom` at the top of the file) with Testing Library.

## How changes are made here

- **Tests first.** Write the failing test, then the change. When changing code that isn't covered yet, first add tests that pin down what it does today.
- **One change per commit**, with a message saying why.
- **Settings:** a new environment variable goes in `src/lib/server/envSchema.mjs` (with its rules), `.env.example` and the README's configuration table; a test fails if one is missing.
- **Database:** append a step to `APP_MIGRATIONS` in `src/lib/server/migrations.ts`; never edit a past one. Better Auth's tables migrate themselves when its expected schema changes.
- **Server logs:** use `log.info/warn/error("area.event", { fields })` from `src/lib/server/log.ts`, not `console`. List new events in `docs/RUNBOOK.md`.
- **Errors shown to listeners:** throw `AppError` (`src/lib/server/errors.ts`) with a kind; routes turn it into a safe message.
- **Detection prompt:** bump `PROMPT_VERSION` in `src/lib/server/llm/prompt.ts` when changing the instructions, so old verdicts are redone.
- **Next.js 16** differs from older versions; its docs are in `node_modules/next/dist/docs/`.

## CI

`.github/workflows/ci.yml` runs on pushes to `main` and `vercel-api` and on pull requests. It runs typecheck, lint, tests with coverage, the build and a dependency audit on Node 22 and 24, plus the end-to-end tests. Dependabot proposes dependency updates weekly.
