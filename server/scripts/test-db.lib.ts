import path from "node:path";
import { fileURLToPath } from "node:url";
import { execFileSync } from "node:child_process";
import dotenv from "dotenv";
import { Client } from "pg";

// Shared logic for preparing the dedicated automated-test database.
// Used by both the standalone `npm run db:test:reset` script and the Vitest
// global setup, so there is exactly one place that knows how to create,
// migrate and seed the test database (docs/lab-02/tests.md §1.3, §5).

const here = path.dirname(fileURLToPath(import.meta.url));
export const serverRoot = path.resolve(here, "..");

const PG_DUPLICATE_DATABASE = "42P04";

// On Windows, npm installs shims as `npx.cmd` (not `npx`), and
// `execFileSync` looks up the exact filename it is given without going
// through the shell's PATHEXT resolution. Passing plain "npx" therefore
// fails there with `spawnSync npx ENOENT`, even though `npx` works fine
// interactively. Resolving the binary name once, here, keeps every caller
// (resetTestDatabase() below, and the idempotency test) cross-platform
// without repeating the platform check or resorting to `shell: true`
// (which would reintroduce shell-quoting concerns for no benefit).
const NPX_BIN = process.platform === "win32" ? "npx.cmd" : "npx";

/**
 * Runs an `npx <args>` command the same way on every platform. Use this
 * instead of calling `execFileSync("npx", ...)` directly.
 */
export function runNpx(
  args: string[],
  options: { cwd: string; env?: NodeJS.ProcessEnv; stdio?: "inherit" | "pipe" }
): void {
  execFileSync(NPX_BIN, args, {
    cwd: options.cwd,
    env: options.env,
    stdio: options.stdio ?? "inherit",
  });
}

function readDatabaseUrl(envFileName: string): string | undefined {
  const result = dotenv.config({
    path: path.join(serverRoot, envFileName),
    processEnv: {},
  });
  return result.parsed?.DATABASE_URL;
}

// Hostnames that all mean "this machine" for a locally-run Postgres. Two
// DATABASE_URLs that differ only by which of these they use still point at
// the exact same server, so the dev/test safety check below must treat them
// as identical rather than as "different hosts".
const LOOPBACK_HOSTNAMES = new Set(["localhost", "127.0.0.1", "::1"]);

function normalizeHost(hostname: string): string {
  const lower = hostname.toLowerCase();
  return LOOPBACK_HOSTNAMES.has(lower) ? "localhost" : lower;
}

interface DatabaseIdentity {
  host: string;
  port: number;
  database: string;
}

/**
 * Parses a Postgres connection string down to the (host, port, database)
 * triple that actually identifies *which database* it points at, ignoring
 * incidentals like credentials, query-string options (e.g. `?schema=public`)
 * or trailing slashes that don't change the target. Throws if the URL can't
 * be parsed or has no database name — an ambiguous URL must never be
 * treated as "safely different" from another one.
 */
function parseDatabaseIdentity(rawUrl: string): DatabaseIdentity {
  let parsed: URL;
  try {
    parsed = new URL(rawUrl);
  } catch {
    throw new Error(`Could not parse database URL "${rawUrl}".`);
  }

  const database = decodeURIComponent(parsed.pathname.replace(/^\//, ""));
  if (!database) {
    throw new Error(`Database URL "${rawUrl}" has no database name.`);
  }

  return {
    host: normalizeHost(parsed.hostname),
    port: parsed.port ? Number(parsed.port) : 5432, // Postgres default
    database,
  };
}

function sameDatabase(a: DatabaseIdentity, b: DatabaseIdentity): boolean {
  return a.host === b.host && a.port === b.port && a.database === b.database;
}

/**
 * Resolves the test database URL from `server/.env.test` and asserts it is
 * safe to run destructive operations (migrate/seed/truncate) against it —
 * i.e. that it is not accidentally the same database the dev server uses.
 *
 * The dev/test comparison is done on the *parsed* connection identity
 * (host, port, database name), not the raw URL string, so that two
 * differently-written URLs which resolve to the same database (different
 * casing, `localhost` vs `127.0.0.1`, an extra `?schema=public`, a
 * different but equivalent form, ...) are still correctly recognised as
 * the same database. A URL that can't be parsed is treated as ambiguous
 * and refused rather than assumed safe.
 */
export function resolveTestDatabaseUrl(): string {
  const testDatabaseUrl = readDatabaseUrl(".env.test");

  if (!testDatabaseUrl) {
    throw new Error(
      "server/.env.test is missing (or has no DATABASE_URL). Run:\n" +
        "  cp server/.env.test.example server/.env.test"
    );
  }

  const testIdentity = parseDatabaseIdentity(testDatabaseUrl);

  const devDatabaseUrl = readDatabaseUrl(".env");
  if (devDatabaseUrl) {
    const devIdentity = parseDatabaseIdentity(devDatabaseUrl);
    if (sameDatabase(devIdentity, testIdentity)) {
      throw new Error(
        "server/.env.test resolves to the same database as server/.env " +
          `(host "${testIdentity.host}", port ${testIdentity.port}, ` +
          `database "${testIdentity.database}"). Refusing to run ` +
          "test-database operations against the dev database."
      );
    }
  }

  if (!testIdentity.database.toLowerCase().includes("test")) {
    throw new Error(
      `server/.env.test database name "${testIdentity.database}" does not ` +
        'contain "test". Refusing to run test-database operations against ' +
        "a database that doesn't look like a dedicated test database."
    );
  }

  return testDatabaseUrl;
}

async function ensureDatabaseExists(testDatabaseUrl: string): Promise<void> {
  const target = new URL(testDatabaseUrl);
  const dbName = target.pathname.replace(/^\//, "");

  const adminUrl = new URL(testDatabaseUrl);
  adminUrl.pathname = "/postgres";

  const admin = new Client({ connectionString: adminUrl.toString() });
  await admin.connect();
  try {
    await admin.query(`CREATE DATABASE "${dbName}"`);
  } catch (error) {
    const code = (error as { code?: string }).code;
    if (code !== PG_DUPLICATE_DATABASE) {
      throw error;
    }
    // Database already exists — nothing to do.
  } finally {
    await admin.end();
  }
}

/**
 * Ensures the dedicated test database exists, is fully migrated, and is
 * seeded with the Lab 2 reference/fixture data. Safe to call repeatedly.
 * Returns the resolved test DATABASE_URL.
 */
export async function resetTestDatabase(): Promise<string> {
  const testDatabaseUrl = resolveTestDatabaseUrl();

  await ensureDatabaseExists(testDatabaseUrl);

  const childEnv = { ...process.env, DATABASE_URL: testDatabaseUrl };

  // On a fresh checkout, `src/generated/prisma` doesn't exist yet — it's
  // git-ignored, and `npm install` alone never creates it. `prisma migrate
  // deploy` (unlike `migrate dev`) does not regenerate the client either, so
  // without this the seed script below, and every test file that imports
  // `src/lib/prisma.ts`, would fail with ERR_MODULE_NOT_FOUND. Running it
  // here means `npm test` alone is sufficient on a clean checkout.
  runNpx(["prisma", "generate"], { cwd: serverRoot, env: childEnv });

  runNpx(["prisma", "migrate", "deploy"], { cwd: serverRoot, env: childEnv });

  runNpx(["tsx", "prisma/seed.ts"], { cwd: serverRoot, env: childEnv });

  process.env.DATABASE_URL = testDatabaseUrl;

  return testDatabaseUrl;
}
