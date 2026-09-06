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

function readDatabaseUrl(envFileName: string): string | undefined {
  const result = dotenv.config({
    path: path.join(serverRoot, envFileName),
    processEnv: {},
  });
  return result.parsed?.DATABASE_URL;
}

/**
 * Resolves the test database URL from `server/.env.test` and asserts it is
 * safe to run destructive operations (migrate/seed/truncate) against it —
 * i.e. that it is not accidentally the same database the dev server uses.
 */
export function resolveTestDatabaseUrl(): string {
  const testDatabaseUrl = readDatabaseUrl(".env.test");

  if (!testDatabaseUrl) {
    throw new Error(
      "server/.env.test is missing (or has no DATABASE_URL). Run:\n" +
        "  cp server/.env.test.example server/.env.test"
    );
  }

  const devDatabaseUrl = readDatabaseUrl(".env");
  if (devDatabaseUrl && devDatabaseUrl === testDatabaseUrl) {
    throw new Error(
      "server/.env.test points at the same DATABASE_URL as server/.env. " +
        "Refusing to run test-database operations against the dev database."
    );
  }

  const parsed = new URL(testDatabaseUrl);
  const dbName = parsed.pathname.replace(/^\//, "");
  if (!dbName.toLowerCase().includes("test")) {
    throw new Error(
      `server/.env.test database name "${dbName}" does not contain "test". ` +
        "Refusing to run test-database operations against a database that " +
        "doesn't look like a dedicated test database."
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

  execFileSync("npx", ["prisma", "migrate", "deploy"], {
    cwd: serverRoot,
    env: childEnv,
    stdio: "inherit",
  });

  execFileSync("npx", ["tsx", "prisma/seed.ts"], {
    cwd: serverRoot,
    env: childEnv,
    stdio: "inherit",
  });

  process.env.DATABASE_URL = testDatabaseUrl;

  return testDatabaseUrl;
}
