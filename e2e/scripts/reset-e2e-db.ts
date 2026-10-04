import path from "node:path";
import { fileURLToPath } from "node:url";
import { execFileSync } from "node:child_process";
import dotenv from "dotenv";
import { Client } from "pg";

// Prepares the dedicated E2E database (docs/lab-02/tests.md §1.1, "E2E ...
// real client + server + test DB") before Playwright boots the client and
// server webServer processes (see ../playwright.config.ts). Wired up as the
// `pretest:e2e` npm hook, so `npm run test:e2e` always runs against a fresh,
// seeded schema.
//
// This intentionally does NOT reuse server/scripts/test-db.lib.ts: that
// module's safety check requires the target database name to contain
// "test" (it exists to protect `toktickit_test`), which `toktickit_e2e`
// deliberately does not. Keeping this a separate, self-contained script
// means the E2E database can never accidentally satisfy — or be satisfied
// by — the test-DB safety net for `toktickit_test`, and this workspace
// stays independently installable (its own package.json / node_modules).

const here = path.dirname(fileURLToPath(import.meta.url));
const e2eRoot = path.resolve(here, "..");
const serverRoot = path.resolve(e2eRoot, "../server");

const REQUIRED_DATABASE_NAME = "toktickit_e2e";

function loadE2eDatabaseUrl(): string {
  const result = dotenv.config({ path: path.join(e2eRoot, ".env.e2e") });
  const url = result.parsed?.DATABASE_URL ?? process.env.DATABASE_URL;
  if (!url) {
    throw new Error(
      "e2e/.env.e2e is missing (or has no DATABASE_URL). Run:\n" +
        "  cp e2e/.env.e2e.example e2e/.env.e2e"
    );
  }
  return url;
}

/**
 * Refuses to run against anything but the dedicated `toktickit_e2e`
 * database. This is the harness's entire dev/test/e2e isolation guarantee:
 * `toktickit_e2e` can never equal `localdb` or `toktickit_test`, so this
 * one check is sufficient to keep destructive operations (push/seed) away
 * from the dev and Vitest test databases regardless of what a developer's
 * shell environment happens to have set.
 */
function assertIsE2eDatabase(rawUrl: string): void {
  let parsed: URL;
  try {
    parsed = new URL(rawUrl);
  } catch {
    throw new Error(`Could not parse DATABASE_URL "${rawUrl}".`);
  }
  const database = parsed.pathname.replace(/^\/+/, "");
  if (database !== REQUIRED_DATABASE_NAME) {
    throw new Error(
      `e2e/.env.e2e DATABASE_URL must point at "${REQUIRED_DATABASE_NAME}" ` +
        `(got "${database}"). Refusing to run E2E database setup against a ` +
        "database that isn't the dedicated E2E database — this must never " +
        "touch toktickit_test or localdb."
    );
  }
}

async function ensureDatabaseExists(e2eUrl: string): Promise<void> {
  const adminUrl = new URL(e2eUrl);
  const dbName = adminUrl.pathname.replace(/^\/+/, "");
  adminUrl.pathname = "/postgres";

  const admin = new Client({ connectionString: adminUrl.toString() });
  await admin.connect();
  try {
    await admin.query(`CREATE DATABASE "${dbName}"`);
    console.log(`Created database "${dbName}".`);
  } catch (error) {
    const code = (error as { code?: string }).code;
    if (code !== "42P04") {
      // 42P04 = duplicate_database — anything else is a real failure.
      throw error;
    }
    console.log(`Database "${dbName}" already exists.`);
  } finally {
    await admin.end();
  }
}

function runInServer(command: string, args: string[], env: NodeJS.ProcessEnv): void {
  execFileSync(command, args, {
    cwd: serverRoot,
    env,
    stdio: "inherit",
    shell: process.platform === "win32",
  });
}

/**
 * Clears the tables E2E specs write to, restarting their identity
 * sequences, so every `npm run test:e2e` run starts from the same empty
 * state instead of accumulating tickets forever (confirmed: `toktickit_e2e`
 * had reached 129+ rows before this existed). Runs once per E2E invocation
 * rather than once per test, since Playwright has no equivalent of
 * Vitest's `beforeEach`. Category and RelatedSystem are deliberately
 * excluded: they are read-only reference fixtures (docs/lab-02/tests.md
 * §1.3) that seed.ts upserts idempotently and specs must not depend on
 * mutating.
 *
 * "User" (and, via its `onDelete: Cascade` FK, "Session") is included here
 * even though `server/tests/setup/reset-db.ts` deliberately excludes User
 * for the toktickit_test suite — that exclusion is safe there because each
 * API test creates and scopes its own dedicated test-local Users rather
 * than mutating the seed. Lab 3's E2E specs are different: many of them
 * (authentication.spec.ts, staff-ticket-flow.spec.ts,
 * user-administration.spec.ts) create real, persisted Users through the
 * live UI/API — a login fixture, an admin-created account, a password-
 * reset target — that are never individually cleaned up afterward. Across
 * every `npm run test:e2e` invocation since Lab 3 added dynamic user
 * creation, those rows silently accumulated in `toktickit_e2e` (confirmed:
 * dozens of "E2E ... Fixture" rows had built up, visibly cluttering the
 * committed `artifacts/lab-03/screenshots/user-management/*.png`
 * evidence). TRUNCATE ... CASCADE on "User" also clears every Ticket,
 * Attachment, PublicComment and InternalNote that references one (all via
 * `onDelete: Cascade` or `Restrict`, and TRUNCATE's own CASCADE follows
 * the FK graph regardless of each relation's own onDelete rule) — a
 * superset of, not a conflict with, the explicit Attachment/Ticket
 * truncation below. `seed.ts` (called right after this function returns)
 * recreates every named seed account fresh on each run.
 */
async function resetTransactionalData(e2eUrl: string): Promise<void> {
  const client = new Client({ connectionString: e2eUrl });
  await client.connect();
  try {
    await client.query(
      'TRUNCATE TABLE "Attachment", "Ticket", "TicketCounter", "User", "Session" RESTART IDENTITY CASCADE;'
    );
    console.log("Cleared Ticket, Attachment, TicketCounter, User and Session.");
  } finally {
    await client.end();
  }
}

async function main(): Promise<void> {
  const e2eUrl = loadE2eDatabaseUrl();
  assertIsE2eDatabase(e2eUrl);

  await ensureDatabaseExists(e2eUrl);

  const childEnv: NodeJS.ProcessEnv = { ...process.env, DATABASE_URL: e2eUrl };

  // `prisma migrate deploy` (not `db push --accept-data-loss`): applies the
  // existing migration history additively, the same way
  // server/scripts/test-db.lib.ts prepares `toktickit_test`. `db push
  // --accept-data-loss` was tried first and rejected — Prisma's CLI detects
  // it is being invoked by an AI coding agent and hard-refuses that
  // destructive a command family without a human explicitly consenting
  // in-session (see PRISMA_USER_CONSENT_FOR_DANGEROUS_AI_ACTION in its
  // error output). No such consent was sought or given here, so this uses
  // the equivalent non-destructive command instead, which needs none.
  runInServer("npx", ["prisma", "generate"], childEnv);
  runInServer("npx", ["prisma", "migrate", "deploy"], childEnv);

  // Reset before seeding: seed.ts only upserts reference/requester rows so
  // ordering relative to it doesn't matter functionally, but resetting
  // first keeps the sequence "migrate -> clear -> seed" (schema, then
  // data) easy to reason about.
  await resetTransactionalData(e2eUrl);

  runInServer("npx", ["tsx", "prisma/seed.ts"], childEnv);

  console.log(`E2E database ready: ${e2eUrl}`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
