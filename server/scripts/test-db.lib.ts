import path from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";
import { readFileSync } from "node:fs";
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

const require = createRequire(import.meta.url);

/**
 * Resolves the on-disk entry script for a package's CLI binary, without
 * going through `npx` or a shell.
 *
 * `require.resolve("<pkg>/package.json")` finds exactly the copy of the
 * package Node's own module resolution would use (respecting the same
 * node_modules lookup, workspaces, etc.). Its `bin` field then says where
 * the executable script lives, relative to the package directory — as a
 * bare string for a single-binary package, or as an object keyed by binary
 * name for a package that publishes more than one. Either way this returns
 * an absolute path to a plain JS/TS entry file that can be handed straight
 * to `process.execPath`.
 */
function resolvePackageBin(packageName: string): string {
  const packageJsonPath = require.resolve(`${packageName}/package.json`);
  const packageDir = path.dirname(packageJsonPath);
  const packageJson = JSON.parse(readFileSync(packageJsonPath, "utf-8")) as {
    bin?: string | Record<string, string>;
  };

  if (!packageJson.bin) {
    throw new Error(
      `Package "${packageName}" has no "bin" field in its package.json.`
    );
  }

  const binRelativePath =
    typeof packageJson.bin === "string"
      ? packageJson.bin
      : packageJson.bin[packageName];

  if (!binRelativePath) {
    throw new Error(
      `Package "${packageName}" has no "${packageName}" entry in its ` +
        '"bin" field.'
    );
  }

  return path.join(packageDir, binRelativePath);
}

/**
 * Runs a package's CLI (e.g. `prisma`, `tsx`) the same way on every
 * platform, without a shell.
 *
 * There is no `npx` and no `.cmd`/`.bat` shim involved: this resolves the
 * package's own entry script and runs it directly with the current Node
 * binary (`process.execPath`), passing arguments as an array. That sidesteps
 * both problems a shell-based approach runs into on Windows — plain "npx"
 * failing with ENOENT because `execFileSync` doesn't do PATHEXT resolution,
 * and spawning `npx.cmd` directly being refused with EINVAL since the fix
 * for CVE-2024-27980 unless `shell: true` is set — and it avoids what
 * `shell: true` costs everywhere else: with a shell, arguments are
 * concatenated into one command line and re-split by the shell's own
 * quoting rules, so any argument containing a space (a very real
 * possibility here — see the seed path built from `serverRoot`, which is
 * wherever the repository happens to be checked out) silently becomes two
 * arguments instead of one. Passing an argv array straight to
 * `execFileSync` with no `shell` option means nothing re-parses it: each
 * element arrives at the child process exactly as written, on every OS.
 */
export function runPackageBin(
  packageName: string,
  args: string[],
  options: { cwd: string; env?: NodeJS.ProcessEnv; stdio?: "inherit" | "pipe" }
): void {
  execNodeScript(resolvePackageBin(packageName), args, options);
}

/**
 * Runs a JS/TS entry script with the current Node binary, passing `args` as
 * a literal argv array and no `shell` option. This is the exact invocation
 * `runPackageBin` uses once it has resolved a package's bin script; it is
 * exported separately so the argv round-trip property (an argument survives
 * byte-for-byte, regardless of spaces or shell metacharacters) can be
 * exercised directly in tests against a throwaway script, without needing a
 * real npm package as a stand-in.
 */
export function execNodeScript(
  scriptPath: string,
  args: string[],
  options: { cwd: string; env?: NodeJS.ProcessEnv; stdio?: "inherit" | "pipe" }
): void {
  execFileSync(process.execPath, [scriptPath, ...args], {
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
// Note the bracketed form: the WHATWG `URL` parser reports an IPv6 host as
// "[::1]", brackets included, so the bare "::1" spelling would never match
// anything and the alias would slip through the dev/test check below.
const LOOPBACK_HOSTNAMES = new Set([
  "localhost",
  "127.0.0.1",
  "::1",
  "[::1]",
]);

function normalizeHost(hostname: string): string {
  const lower = hostname.toLowerCase();
  return LOOPBACK_HOSTNAMES.has(lower) ? "localhost" : lower;
}

export interface DatabaseIdentity {
  host: string;
  port: number;
  database: string;
}

/**
 * Parses a Postgres connection string down to the (host, port, database)
 * triple that actually identifies *which database* it points at, ignoring
 * incidentals like credentials, query-string options (e.g. `?schema=public`)
 * or leading/trailing/doubled slashes in the path that don't change the
 * target (`.../toktickit_test`, `.../toktickit_test/` and
 * `.../toktickit_test//` all name the same database). Throws if the URL
 * can't be parsed or has no database name — an ambiguous URL must never be
 * treated as "safely different" from another one.
 */
export function parseDatabaseIdentity(rawUrl: string): DatabaseIdentity {
  let parsed: URL;
  try {
    parsed = new URL(rawUrl);
  } catch {
    throw new Error(`Could not parse database URL "${rawUrl}".`);
  }

  // Collapse any run of slashes to one, then strip a leading and/or
  // trailing slash. Stripping only the leading slash (as a prior version of
  // this function did) left "/toktickit_test/" as "toktickit_test/" — a
  // string that no longer equals the no-slash spelling, so two URLs naming
  // the same database could be judged "different" and bypass the dev/test
  // safety check below.
  const database = decodeURIComponent(
    parsed.pathname.replace(/\/+/g, "/").replace(/^\/|\/$/g, "")
  );
  if (!database) {
    throw new Error(`Database URL "${rawUrl}" has no database name.`);
  }

  return {
    host: normalizeHost(parsed.hostname),
    port: parsed.port ? Number(parsed.port) : 5432, // Postgres default
    database,
  };
}

export function sameDatabase(a: DatabaseIdentity, b: DatabaseIdentity): boolean {
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
  // Reuse the same slash-normalising parse as the dev/test safety check
  // (parseDatabaseIdentity) instead of re-deriving the database name with
  // its own ad hoc regex, so there is exactly one place that decides what a
  // URL's path segment means.
  const dbName = parseDatabaseIdentity(testDatabaseUrl).database;

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
  runPackageBin("prisma", ["generate"], { cwd: serverRoot, env: childEnv });

  runPackageBin("prisma", ["migrate", "deploy"], {
    cwd: serverRoot,
    env: childEnv,
  });

  runPackageBin("tsx", ["prisma/seed.ts"], { cwd: serverRoot, env: childEnv });

  process.env.DATABASE_URL = testDatabaseUrl;

  return testDatabaseUrl;
}
