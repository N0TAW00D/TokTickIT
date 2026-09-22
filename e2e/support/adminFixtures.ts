import path from "node:path";
import { fileURLToPath } from "node:url";
import dotenv from "dotenv";
import { Client } from "pg";

// Fixture data/cleanup for e2e/lab-03/user-administration.spec.ts (E2E-09,
// AC-48/AC-49/AC-51). Unlike `staffFixtures.ts`, this spec creates its
// fixture Users through the REAL Administrator User Management UI (the
// Create User dialog), not via a direct `pg` insert — driving the actual
// `POST /api/users` flow is the point of AC-48. This file's one job is
// pre-test cleanup: deleting any leftover row from a previous, uncleaned
// run (e.g. a CI retry re-running the same test against the same
// `toktickit_e2e` database, which `pretest:e2e` only resets once per whole
// `npm run test:e2e` invocation, not per retry) so the Create dialog never
// hits a stale `EMAIL_IN_USE` from this spec's own earlier attempt.
//
// Same direct-`pg`/`.env.e2e` loading convention as `auth.ts` and
// `staffFixtures.ts` (each Lab 3 support file keeps its own small copy of
// this loader rather than sharing one, matching their existing style).

const here = path.dirname(fileURLToPath(import.meta.url));
const e2eRoot = path.resolve(here, "..");

function loadE2eDatabaseUrl(): string {
  const result = dotenv.config({ path: path.join(e2eRoot, ".env.e2e") });
  const url = result.parsed?.DATABASE_URL ?? process.env.DATABASE_URL;
  if (!url) {
    throw new Error(
      "e2e/.env.e2e is missing (or has no DATABASE_URL) — cannot reset the " +
        "user-administration fixture users.",
    );
  }
  if (!url.endsWith("/toktickit_e2e")) {
    // Same guard as auth.ts/staffFixtures.ts/reset-e2e-db.ts: never run
    // against toktickit_test or localdb.
    throw new Error(
      `DATABASE_URL must point at "toktickit_e2e" (got "${url}"). Refusing ` +
        "to delete rows from a database that isn't the dedicated E2E database.",
    );
  }
  return url;
}

/**
 * Deletes any existing `User` row (and, via the schema's `onDelete:
 * Cascade`, any `Session` row it owns) for each of `emails`, so the Create
 * User dialog this spec drives always starts from a clean slate rather than
 * risking a spurious `EMAIL_IN_USE` from a previous run's leftover row.
 * Case-insensitive, matching every other email lookup in this codebase
 * (email is not `@unique` in schema.prisma — see seed.ts's own comment —
 * its uniqueness is a case-insensitive index).
 */
export async function resetUserAdministrationFixtures(emails: string[]): Promise<void> {
  const client = new Client({ connectionString: loadE2eDatabaseUrl() });
  await client.connect();
  try {
    await client.query(
      'DELETE FROM "User" WHERE lower(email) = ANY($1::text[])',
      [emails.map((email) => email.toLowerCase())],
    );
  } finally {
    await client.end();
  }
}
