import path from "node:path";
import { fileURLToPath } from "node:url";
import dotenv from "dotenv";
import { Client } from "pg";

// Direct-`pg` fixture data for e2e/lab-03/staff-ticket-flow.spec.ts (E2E-05,
// AC-26...AC-33), following the same real-database-fixture pattern as
// `e2e/support/auth.ts`'s own `createPlainLoginFixtureUser`/
// `createMustChangePasswordFixtureUser` (see that file's header comment for
// the full rationale for inserting fixture rows directly against
// `toktickit_e2e` rather than mocking, or extending `server/prisma/seed.ts`
// itself).
//
// `server/prisma/seed.ts` seeds exactly 8 Tickets (`SEED_TICKETS`) —
// nowhere near the IT Staff Ticket Queue's smallest selectable page size
// (`client/src/components/Pagination.tsx`'s `PAGE_SIZE_OPTIONS`: 10/20/50),
// so there is no way to drive that screen's page-size control to a real
// two-page result using seed.ts's fixtures alone. This inserts five extra,
// deliberately low-priority, unassigned, NEW tickets — ticket numbers
// "TKT-2026-990001".."TKT-2026-990005", well outside both the real
// ticket-number allocator's band (docs/lab-02/specification.md §7.3) and
// seed.ts's own "900xxx" fixture band, so neither can ever collide with
// these — purely to push the queue's total past 10 so the spec can exercise
// an actual Prev/Next page transition (AC-30), not just a single-page
// boundary check.

const here = path.dirname(fileURLToPath(import.meta.url));
const e2eRoot = path.resolve(here, "..");

function loadE2eDatabaseUrl(): string {
  // Mirrors auth.ts's own loader: prefer the freshly parsed `.env.e2e`
  // value, fall back to whatever the process already has.
  const result = dotenv.config({ path: path.join(e2eRoot, ".env.e2e") });
  const url = result.parsed?.DATABASE_URL ?? process.env.DATABASE_URL;
  if (!url) {
    throw new Error(
      "e2e/.env.e2e is missing (or has no DATABASE_URL) — cannot create the " +
        "pagination fixture tickets.",
    );
  }
  if (!url.endsWith("/toktickit_e2e")) {
    // Same guard as auth.ts/reset-e2e-db.ts/playwright.config.ts: never run
    // against toktickit_test or localdb.
    throw new Error(
      `DATABASE_URL must point at "toktickit_e2e" (got "${url}"). Refusing ` +
        "to create/mutate fixture tickets against a database that isn't the " +
        "dedicated E2E database.",
    );
  }
  return url;
}

/**
 * Ticket numbers this helper owns — exported so the spec can assert against
 * them without re-typing the pattern.
 */
export const PAGINATION_FIXTURE_TICKET_NUMBERS = [
  "TKT-2026-990001",
  "TKT-2026-990002",
  "TKT-2026-990003",
  "TKT-2026-990004",
  "TKT-2026-990005",
] as const;

// One real seeded Requester/Category/RelatedSystem row (server/prisma/seed.ts)
// to hang these fixture tickets off of — any would do; these three are
// simply stable, always-present seeded names.
const FIXTURE_REQUESTER_EMAIL = "jennifer.anderson@example.edu";
const FIXTURE_CATEGORY_NAME = "Software";
const FIXTURE_RELATED_SYSTEM_NAME = "Email";

/**
 * Creates (or replaces) five extra unassigned, NEW, LOW-priority fixture
 * Tickets purely so the IT Staff Ticket Queue has more than one page's
 * worth of rows at the smallest page size (10). Idempotent: deletes any
 * previous run's rows (by ticket number) before inserting fresh ones, same
 * convention as `auth.ts`'s `createFixtureUser`.
 */
export async function createPaginationFixtureTickets(): Promise<void> {
  const client = new Client({ connectionString: loadE2eDatabaseUrl() });
  await client.connect();
  try {
    const requester = await client.query<{ id: number }>(
      'SELECT id FROM "User" WHERE lower(email) = lower($1)',
      [FIXTURE_REQUESTER_EMAIL],
    );
    const category = await client.query<{ id: number }>(
      'SELECT id FROM "Category" WHERE name = $1',
      [FIXTURE_CATEGORY_NAME],
    );
    const relatedSystem = await client.query<{ id: number }>(
      'SELECT id FROM "RelatedSystem" WHERE name = $1',
      [FIXTURE_RELATED_SYSTEM_NAME],
    );
    if (
      requester.rowCount === 0 ||
      category.rowCount === 0 ||
      relatedSystem.rowCount === 0
    ) {
      throw new Error(
        "Seed rows this pagination fixture depends on are missing — run " +
          "`npm --prefix e2e run db:e2e:reset` before this spec.",
      );
    }
    const requesterId = requester.rows[0].id;
    const categoryId = category.rows[0].id;
    const relatedSystemId = relatedSystem.rows[0].id;

    // Idempotent: drop any leftover fixture rows from a previous, uncleaned
    // run before inserting fresh ones.
    await client.query(
      'DELETE FROM "Ticket" WHERE "ticketNumber" = ANY($1::text[])',
      [PAGINATION_FIXTURE_TICKET_NUMBERS],
    );

    for (const [index, ticketNumber] of PAGINATION_FIXTURE_TICKET_NUMBERS.entries()) {
      // "updatedAt" has no DB-level default (see auth.ts's identical note
      // for "User"), so this raw insert must set it explicitly.
      await client.query(
        `INSERT INTO "Ticket"
           ("ticketNumber", "requesterId", "categoryId", "relatedSystemId",
            summary, description, "requestedPriority", "itPriority", status,
            "updatedAt")
         VALUES ($1, $2, $3, $4, $5, $6, 'LOW'::"Priority", 'LOW'::"Priority",
                 'NEW'::"TicketStatus", NOW())`,
        [
          ticketNumber,
          requesterId,
          categoryId,
          relatedSystemId,
          `E2E Pagination Fixture ${index + 1}`,
          "Fixture ticket inserted solely to give the IT Staff Ticket Queue enough rows to paginate across two pages.",
        ],
      );
    }
  } finally {
    await client.end();
  }
}
