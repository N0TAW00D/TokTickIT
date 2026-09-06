# TokTickIT

Full-stack app with a React + Vite client and an Express + Prisma server backed by PostgreSQL.

## Prerequisites

- Node.js 20+
- Docker (for local PostgreSQL)

## Setup

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

## Project structure

```
client/   React + TypeScript + Vite frontend
server/   Express + TypeScript + Prisma backend
docs/     Lab notes and reference material
```
