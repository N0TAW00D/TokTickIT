import path from "node:path";
import { fileURLToPath } from "node:url";
import dotenv from "dotenv";
import { Client } from "pg";
import { expect, type Page } from "@playwright/test";
import { LOCAL_DEV_PASSWORD } from "../../server/prisma/seedConstants.js";

// Shared Lab 3 authentication helpers (docs/lab-03/ui-spec.md §5 Login,
// §6 Change Password), for reuse across every `e2e/lab-03/*.spec.ts` file —
// not just `authentication.spec.ts`. Lab 3 replaced Lab 2's dev-only
// "Development Requester Selector" (`GET /api/requesters`,
// `X-Requester-Id`) with real session-cookie authentication
// (`POST /api/auth/login`), so every Lab 3 spec that needs to be signed in
// as someone drives THIS real Login screen — never the old selector, which
// e2e/lab-02/*.spec.ts still (separately, out of this dispatch's scope)
// uses.

export { LOCAL_DEV_PASSWORD };

/** ui-spec.md §5 field ids (client/src/screens/LoginScreen.tsx FIELD_IDS). */
const LOGIN_EMAIL_INPUT = "#login-email";
const LOGIN_PASSWORD_INPUT = "#login-password";

/**
 * The one safe-failure message the Login screen ever shows for a rejected
 * attempt (ui-spec.md §5 "Failure"/"Rate-limited" states, api-spec.md §2.1
 * BR-08/BR-38): byte-identical whether the cause is a wrong password, an
 * unknown email, an inactive account, or the rate limiter — the client
 * never learns which. Exported so specs assert against this single source
 * of truth instead of re-typing the literal string.
 */
export const SAFE_LOGIN_FAILURE_MESSAGE =
  "We couldn't sign you in. Check your email and password and try again.";

/**
 * Drives the real Login screen (ui-spec.md §5) exactly as a user would:
 * navigate to `/login`, fill email + password, submit, and wait for the
 * app to leave `/login`. Never pokes `localStorage`/cookies directly and
 * never calls `POST /api/auth/login` out of band — every session this
 * helper creates is a real one the browser itself holds via the
 * `toktickit.sid` cookie.
 *
 * Deliberately does NOT assert *where* the app lands: a successful login
 * redirects to the caller's role landing page (ui-spec.md §4.2) UNLESS
 * `mustChangePassword` is set, in which case it redirects to
 * `/change-password` instead (ui-spec.md §6 "Forced" path) — callers that
 * care which one happened assert that themselves right after calling this.
 */
export async function loginAs(
  page: Page,
  email: string,
  password: string,
): Promise<void> {
  await page.goto("/login");
  await expect(page.locator(LOGIN_EMAIL_INPUT)).toBeVisible();

  await page.locator(LOGIN_EMAIL_INPUT).fill(email);
  await page.locator(LOGIN_PASSWORD_INPUT).fill(password);
  await page.getByRole("button", { name: /^Sign in$/ }).click();

  // Web-first wait for the redirect (either the role landing page or
  // `/change-password`) rather than a fixed sleep — `LoginScreen` only
  // navigates away once the real `POST /api/auth/login` call resolves.
  await expect(page).not.toHaveURL(/\/login$/);
}

/**
 * Convenience wrapper for the common case: every seeded account
 * (`server/prisma/seed.ts`) shares one password, `LOCAL_DEV_PASSWORD`
 * (`server/prisma/seedConstants.ts`).
 */
export async function loginAsSeededUser(page: Page, email: string): Promise<void> {
  await loginAs(page, email, LOCAL_DEV_PASSWORD);
}

// ---------------------------------------------------------------------------
// Dedicated fixture users (direct DB access)
// ---------------------------------------------------------------------------
//
// Every ACTIVE Requester `server/prisma/seed.ts` upserts is one of the same
// rows migrated forward from Lab 2's `RequesterUser` table
// (`server/prisma/migrations/20260914120000_evolve_user_model_roles_sessions/
// migration.sql`: "mustChangePassword: defaults true, so every migrated
// Requester must ..."), and `seed.ts`'s `upsertUser` only ever *updates*
// name/role/isActive for a row that already exists there — it never touches
// `mustChangePassword` on that path. So every seeded active Requester is,
// by design, ALSO flagged `mustChangePassword: true` (confirmed directly
// against `toktickit_e2e`). Seeded IT Staff/Administrator rows are
// Lab-3-native (never migrated) and freshly `create`d with the flag false —
// but logging in as one currently redirects to the hardcoded `"/"` route
// (`client/src/App.tsx`, `client/src/screens/LoginScreen.tsx`), which
// resolves to the REQUESTER-only `/tickets` route regardless of the
// caller's actual role, landing a non-Requester on the forbidden state
// instead of their own role's landing page — a real gap this dispatch's
// job is to report, not to fix (out of scope: it isn't part of the
// Login/Change-Password/Logout surface these four tests own).
//
// So no *seeded* account reliably gives E2E-01/E2E-04 a plain
// (non-forced-change) Requester login without either hitting the
// migrated-Requester forced-change redirect or the IT-Staff landing gap
// above. Rather than depend on either quirk — or on Issue #73's (not yet
// merged) admin-created-user flow, the normal way an account would
// otherwise end up with a chosen `mustChangePassword` value — this inserts
// dedicated fixture `User` rows directly against the real `toktickit_e2e`
// Postgres database, the same database the real server/client under test
// are already reading and writing (no mocking is introduced: the row is
// real, and every login against it is a real `POST /api/auth/login` call).
// This is infrastructure equivalent to `e2e/scripts/reset-e2e-db.ts`'s own
// direct `pg` access, just scoped to one row instead of the whole database.

const here = path.dirname(fileURLToPath(import.meta.url));
const e2eRoot = path.resolve(here, "..");

function loadE2eDatabaseUrl(): string {
  // Mirrors scripts/reset-e2e-db.ts's own loader: prefer the freshly
  // parsed `.env.e2e` value, fall back to whatever the process already
  // has (e.g. inherited from playwright.config.ts's own `dotenv.config`
  // call in the parent process).
  const result = dotenv.config({ path: path.join(e2eRoot, ".env.e2e") });
  const url = result.parsed?.DATABASE_URL ?? process.env.DATABASE_URL;
  if (!url) {
    throw new Error(
      "e2e/.env.e2e is missing (or has no DATABASE_URL) — cannot create the " +
        "forced-password-change fixture user.",
    );
  }
  if (!url.endsWith("/toktickit_e2e")) {
    // Same guard as reset-e2e-db.ts and playwright.config.ts: this must
    // never run against toktickit_test or localdb.
    throw new Error(
      `DATABASE_URL must point at "toktickit_e2e" (got "${url}"). Refusing ` +
        "to create/mutate a fixture user against a database that isn't the " +
        "dedicated E2E database.",
    );
  }
  return url;
}

export interface FixtureUser {
  id: number;
  email: string;
  name: string;
}

// A specific, known-good seeded account (server/prisma/seed.ts
// SEED_ACTIVE_IT_STAFF) to copy a real `LOCAL_DEV_PASSWORD` bcrypt hash
// from. Deliberately NOT "any row, picked with `LIMIT 1`": `toktickit_e2e`
// is a single shared database (this worktree's own instructions point every
// spec at it), so an unscoped, unordered `LIMIT 1` can silently pick up a
// row some other concurrent activity — a different worktree's own run
// against the same database, or a leftover row from a previous, differently
// -behaved version of this very helper — left behind with a hash of some
// OTHER password entirely, producing a fixture that mysteriously can't log
// in with `LOCAL_DEV_PASSWORD`. Naming one exact, stable row removes that
// nondeterminism.
const KNOWN_SEEDED_EMAIL = "priya.natarajan@example.edu";

/**
 * Creates (or replaces) one active REQUESTER fixture user with a chosen
 * `mustChangePassword` value, directly against `toktickit_e2e`. Idempotent:
 * safe to call even if a previous, uncleaned run left the same fixture row
 * behind (`DELETE` cascades any of its `Session` rows via the schema's
 * `onDelete: Cascade`, then a fresh row is inserted).
 *
 * The fixture's password hash is copied straight from `KNOWN_SEEDED_EMAIL`'s
 * row rather than computed here, so this file never needs its own bcrypt
 * dependency or a copy of `hashPassword`.
 */
async function createFixtureUser(
  emailLocalPart: string,
  name: string,
  mustChangePassword: boolean,
): Promise<FixtureUser> {
  const email = `${emailLocalPart}@toktickit.local`;

  const client = new Client({ connectionString: loadE2eDatabaseUrl() });
  await client.connect();
  try {
    const seededHash = await client.query<{ passwordHash: string }>(
      'SELECT "passwordHash" FROM "User" WHERE lower(email) = lower($1)',
      [KNOWN_SEEDED_EMAIL],
    );
    if (seededHash.rowCount === 0) {
      throw new Error(
        `Seeded account "${KNOWN_SEEDED_EMAIL}" not found — run ` +
          "`npm --prefix e2e run db:e2e:reset` before this spec.",
      );
    }
    const passwordHash = seededHash.rows[0].passwordHash;

    // Idempotent: drop any leftover fixture row (and its cascaded
    // Sessions) from a previous, uncleaned run before inserting a fresh
    // one.
    await client.query('DELETE FROM "User" WHERE lower(email) = lower($1)', [email]);

    // "updatedAt" has no DB-level default (schema.prisma's `@updatedAt` is
    // enforced by Prisma Client at write time, not by the column itself —
    // see migration.sql's `"updatedAt" TIMESTAMP(3) NOT NULL` with no
    // `DEFAULT`), so this raw insert — which bypasses Prisma Client — must
    // set it explicitly. `mustChangePassword` is likewise set explicitly
    // (not left to the schema default) so this helper's behaviour doesn't
    // silently change if that default is ever edited.
    const inserted = await client.query<{ id: number }>(
      `INSERT INTO "User" (name, email, "passwordHash", role, "isActive", "mustChangePassword", "updatedAt")
       VALUES ($1, $2, $3, 'REQUESTER'::"Role", true, $4, NOW())
       RETURNING id`,
      [name, email, passwordHash, mustChangePassword],
    );

    return { id: inserted.rows[0].id, email, name };
  } finally {
    await client.end();
  }
}

/**
 * A fixture Requester with `mustChangePassword: false` — a plain, ready-to-
 * use login, for journeys (E2E-01, E2E-04) that must NOT hit the forced
 * Change Password redirect. `discriminator` keeps each caller's row
 * distinct and identifiable in the database (e.g. `"login-journey"`,
 * `"logout-journey"`).
 */
export async function createPlainLoginFixtureUser(discriminator: string): Promise<FixtureUser> {
  return createFixtureUser(
    `e2e-plain-login-${discriminator}`,
    `E2E Plain Login Fixture (${discriminator})`,
    false,
  );
}

/**
 * A fixture Requester with `mustChangePassword: true`, for E2E-02's "first
 * login forced password change" journey.
 */
export async function createMustChangePasswordFixtureUser(): Promise<FixtureUser> {
  return createFixtureUser("e2e-must-change-password", "E2E Forced Change Fixture", true);
}
