# TokTickIT

Full-stack app with a React + Vite client and an Express + Prisma server backed by PostgreSQL.

## Prerequisites

- Node.js 20+
- Docker (for local PostgreSQL)

## Setup

### 0. Install everything

From the repository root:

```bash
npm run bootstrap
```

Installs `server/`, `client/`, and `e2e/` dependencies (each stays an independent npm package —
this is not an npm workspace) and the Playwright Chromium browser, in that order. This is the one
command a clean checkout needs before any `.env` copying or test run below; the per-package
`npm install` steps in sections 1–4 do the same installs individually, for anyone who wants to run
them by hand instead.

`server/package.json`, `client/package.json`, and `e2e/package.json` each commit an `allowScripts`
allowlist (npm 11 blocks a dependency's `preinstall`/`install`/`postinstall` scripts unless the
project explicitly approves them — `npm install-scripts ls` shows what would otherwise be skipped).
Because those approvals are committed rather than left to each developer's local npm config, plain
`npm install` (what `bootstrap` and every step below run) already executes everything a fresh clone
needs — no separate `npm install-scripts approve` step, and no manual `npm run db:generate`, either:
`server/tests/setup/global-setup.ts` and `e2e/scripts/reset-e2e-db.ts` both run `prisma generate`
themselves before they need the generated client.

### 1. Database

```bash
cd server
cp .env.example .env
npm install
npm run db:start     # starts PostgreSQL via docker-compose
npm run db:migrate   # applies all Prisma migrations (creates tables from empty)
npm run db:seed      # loads reference data + Development Requesters (idempotent, safe to re-run)
```

`db:migrate` and `db:seed` both target the database in `server/.env` (the dev database,
`localdb` by default). Re-running `db:seed` never creates duplicate rows — it `upsert`s every
row by its natural key (see `server/prisma/seed.ts`).

### 2. Server

```bash
cd server
npm run dev          # starts the API on http://localhost:3000
npm test             # runs the Vitest + Supertest suite against a dedicated test database
```

#### Automated-test database

Server tests run against their own PostgreSQL database, `toktickit_test`, on the same Postgres
instance as `localdb` — never against the dev database. One-time setup:

```bash
cd server
cp .env.test.example .env.test   # points DATABASE_URL at the toktickit_test database
```

That's it — `npm test` takes care of the rest automatically every run, including on a fresh
checkout that has never run `npm run db:generate`: it (re)generates the Prisma Client, creates the
`toktickit_test` database if it doesn't exist yet, applies all migrations, and seeds it, before
any test runs (see `server/tests/setup/global-setup.ts`). Each test also truncates `Ticket`,
`Attachment`, and `TicketCounter` beforehand for isolation, while the seeded reference data
(Categories, Related Systems, Requesters) is left in place.

If you want to prepare the test database without running the tests (e.g. to inspect it), run:

```bash
npm run db:test:reset
```

The test setup refuses to run if `server/.env.test` is missing, or if it points at the same
database as `server/.env`, or at a database whose name doesn't contain `test` — this is a
safety net against accidentally wiping the dev database.

### 3. Client

```bash
cd client
npm install
npm run dev           # starts the app on http://localhost:5173
npm test              # runs the Vitest suite
```

### 4. End-to-end (Playwright)

E2E and responsive tests run against a third dedicated database, `toktickit_e2e` — separate from
both `localdb` and `toktickit_test`, so the E2E suite can never touch either. One-time setup:

```bash
cd e2e
cp .env.e2e.example .env.e2e   # points DATABASE_URL at toktickit_e2e, VITE_API_BASE_URL at the server
npm install
npx playwright install chromium
```

Then, from `e2e/`:

```bash
npm run test:e2e
```

`test:e2e` first runs `db:e2e:reset` (its `pretest:e2e` hook — see `e2e/scripts/reset-e2e-db.ts`),
which creates `toktickit_e2e` if needed, applies all Prisma migrations, and seeds it, then runs
Playwright. Playwright's `webServer` config (`e2e/playwright.config.ts`) boots the real API (`tsx
src/index.ts`, `DATABASE_URL` pointed at `toktickit_e2e`) and the real client (`vite dev`,
`VITE_API_BASE_URL` pointed at the API) itself — nothing needs to be started by hand first, and
`reuseExistingServer` is always `false` — locally and in CI — so a stray dev server or a stale
process from another checkout on :3000/:5173 can never be silently adopted; if either port is
already occupied, Playwright fails fast instead of running the suite against it.

Only one spec exists so far, `e2e/lab-02/harness.smoke.spec.ts`: it proves the harness boots the
whole stack by asserting the Requester Selection screen lists the seeded active Requesters (and
not the inactive one) — data that can only come from a real API call against the real database.
The full E2E and responsive suites (`e2e/lab-02/requester-ticket-flow.spec.ts`,
`e2e/lab-02/responsive.spec.ts`) are added by later Lab 2 slices (see `docs/lab-02/tests.md`).

### 5. Full suite

From the repository root:

```bash
npm run test:all      # server unit/API tests, then client tests, then the e2e suite
```

Runs `test:server` (`cd server && npm test`), `test:client` (`cd client && npm test`), and
`test:e2e` (`cd e2e && npm run test:e2e`) in that order, stopping at the first failure. This
assumes `npm run bootstrap` (section 0) — or the equivalent per-package `npm install` /
`npx playwright install chromium` steps above — has already been run at least once, and that
`server/.env.test` and `e2e/.env.e2e` have been copied from their `.example` files.

## Project structure

```
client/   React + TypeScript + Vite frontend
server/   Express + TypeScript + Prisma backend
e2e/      Playwright end-to-end + responsive tests (own package.json, own toktickit_e2e database)
docs/     Lab notes and reference material
```
