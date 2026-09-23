import { randomUUID } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import dotenv from "dotenv";
import { Client } from "pg";
import { createPlainLoginFixtureUser, type FixtureUser } from "./auth.js";

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

// `server/prisma/seed.ts`'s own 8 fixture tickets (SEED_TICKETS), hardcoded
// here rather than queried, since E2E-05's row-count assertions need to know
// this exact closed set at fill time, not just "however many exist".
const SEED_TICKET_NUMBERS = [
  "TKT-2026-900001",
  "TKT-2026-900002",
  "TKT-2026-900003",
  "TKT-2026-900004",
  "TKT-2026-900005",
  "TKT-2026-900006",
  "TKT-2026-900007",
  "TKT-2026-900008",
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

    // `testDir` covers the whole `e2e/` root (both lab-02 and lab-03), and
    // every other spec file in the shared `toktickit_e2e` database creates
    // its own real Tickets through the real create-ticket flow (the real
    // per-year sequence allocator, ticketNumber.ts) — none of which are
    // cleaned up afterward, since each of those specs owns and asserts on
    // its own tickets independently. E2E-05's row-count assertions below
    // need an exact, closed total (8 seed + 5 pagination fixtures = 13), so
    // this deletes every OTHER Ticket first. Safe: this file is last
    // alphabetically among every current spec, so nothing downstream in a
    // full `npm run test:e2e` run still depends on a ticket this removes —
    // and within this file, E2E-05 runs before E2E-07/08 create their own
    // (`createRequesterOwnedFixtureTicket`) fixture tickets, so this can
    // never delete something a later test in this same file just made.
    const keep = [...SEED_TICKET_NUMBERS, ...PAGINATION_FIXTURE_TICKET_NUMBERS];
    await client.query('DELETE FROM "Ticket" WHERE "ticketNumber" != ALL($1::text[])', [
      keep,
    ]);

    // Idempotent: also drop any leftover rows from a previous run of THIS
    // fixture (by its own ticket numbers, preserved by `keep` above) before
    // inserting fresh ones — same convention as `auth.ts`'s
    // `createFixtureUser`.
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

// ---------------------------------------------------------------------------
// Requester-owned fixture ticket (E2E-07, E2E-08)
// ---------------------------------------------------------------------------
//
// E2E-07 (Comment and note privacy) and E2E-08 (Requester side) each need a
// real, direct (non-forced-change) Requester login that OWNS the ticket
// under test — exactly `e2e/support/auth.ts`'s own
// `createPlainLoginFixtureUser` rationale (every *seeded* active Requester
// is migrated-forward from Lab 2 and therefore `mustChangePassword: true`,
// which would force these tests through /change-password before they could
// ever reach Ticket Detail). Neither existing fixture helper covers "a
// fixture Requester that also owns a specific fixture Ticket", so this adds
// that combination, following the same idempotent direct-`pg` pattern as
// `createPaginationFixtureTickets` above and `auth.ts`'s own
// `createFixtureUser`.

export interface RequesterOwnedFixtureTicket {
  id: number;
  ticketNumber: string;
  requester: FixtureUser;
}

// Reuses the same stable, always-present seeded Category/RelatedSystem
// names `createPaginationFixtureTickets` already relies on.
const REQUESTER_FIXTURE_TICKET_CATEGORY_NAME = FIXTURE_CATEGORY_NAME;
const REQUESTER_FIXTURE_TICKET_RELATED_SYSTEM_NAME = FIXTURE_RELATED_SYSTEM_NAME;

/**
 * Creates (or replaces) one fixture Ticket, in status `OPEN` (never
 * terminal, so ui-spec.md §7's "Problem Appears Resolved" button is always
 * visible on it), owned by a fresh fixture Requester with
 * `mustChangePassword: false` (`auth.ts`'s `createPlainLoginFixtureUser`,
 * keyed by the same `discriminator`).
 *
 * Deletes any stale Ticket row for `ticketNumber` BEFORE (re)creating the
 * fixture Requester, not after: `Ticket.requesterId` is `onDelete:
 * Restrict` (schema.prisma), so if a previous, uncleaned run's Ticket still
 * referenced that Requester's old row, `createPlainLoginFixtureUser`'s own
 * `DELETE ... WHERE lower(email) = lower($1)` would fail with a foreign-key
 * violation. Deleting the ticket first removes that reference, so the
 * Requester row underneath it can always be safely dropped and recreated,
 * the same idempotent guarantee every other fixture helper in this repo
 * offers.
 */
export async function createRequesterOwnedFixtureTicket(
  discriminator: string,
  ticketNumber: string,
): Promise<RequesterOwnedFixtureTicket> {
  const deleteClient = new Client({ connectionString: loadE2eDatabaseUrl() });
  await deleteClient.connect();
  try {
    await deleteClient.query('DELETE FROM "Ticket" WHERE "ticketNumber" = $1', [
      ticketNumber,
    ]);
  } finally {
    await deleteClient.end();
  }

  const requester = await createPlainLoginFixtureUser(discriminator);

  const client = new Client({ connectionString: loadE2eDatabaseUrl() });
  await client.connect();
  try {
    const category = await client.query<{ id: number }>(
      'SELECT id FROM "Category" WHERE name = $1',
      [REQUESTER_FIXTURE_TICKET_CATEGORY_NAME],
    );
    const relatedSystem = await client.query<{ id: number }>(
      'SELECT id FROM "RelatedSystem" WHERE name = $1',
      [REQUESTER_FIXTURE_TICKET_RELATED_SYSTEM_NAME],
    );
    if (category.rowCount === 0 || relatedSystem.rowCount === 0) {
      throw new Error(
        "Seed rows this fixture depends on are missing — run " +
          "`npm --prefix e2e run db:e2e:reset` before this spec.",
      );
    }

    const inserted = await client.query<{ id: number }>(
      `INSERT INTO "Ticket"
         ("ticketNumber", "requesterId", "categoryId", "relatedSystemId",
          summary, description, "requestedPriority", "itPriority", status,
          "updatedAt")
       VALUES ($1, $2, $3, $4, $5, $6, 'MEDIUM'::"Priority", 'MEDIUM'::"Priority",
               'OPEN'::"TicketStatus", NOW())
       RETURNING id`,
      [
        ticketNumber,
        requester.id,
        category.rows[0].id,
        relatedSystem.rows[0].id,
        `E2E Requester-Flow Fixture (${discriminator})`,
        "Fixture ticket inserted for an E2E journey that needs a real, " +
          "non-forced-change Requester login owning a real ticket.",
      ],
    );

    return { id: inserted.rows[0].id, ticketNumber, requester };
  } finally {
    await client.end();
  }
}

export interface PreExistingAttachmentFixture {
  id: number;
  originalFilename: string;
  bytes: Buffer;
}

/**
 * Directly inserts a real, already-existing Attachment row (real bytes on
 * disk, real DB row) for `ticketId`, WITHOUT going through the upload
 * route or any test session's own request — this is the point. Used by
 * `staff-ticket-flow.spec.ts`'s E2E-08 to prove AC-43 ("an Attachment
 * created in Lab 2 stays downloadable from IT Staff Ticket Detail")
 * against an attachment that genuinely pre-dates the test's own actions,
 * not one the test itself just uploaded through the current session —
 * uploading fresh and then downloading only proves the upload+download
 * round trip works today, not that a *pre-existing* row survives the
 * session/auth rewiring #70 did around it.
 *
 * There is no real Lab-2-era Attachment row reachable from `toktickit_e2e`
 * to point at instead (`server/prisma/seed.ts` never seeds one, and the
 * only other seeded Attachment rows anywhere in the repo, in
 * `server/scripts/test-db-lab2-fixture.lib.ts`, live in a throwaway,
 * Vitest-only Postgres database with fabricated `storedFilename` values
 * that were never actually written to disk — pointing an E2E download at
 * one would 404 on real bytes that don't exist). This function creates
 * the closest honest equivalent reachable from this database: writes real
 * bytes to the same `server/uploads/` directory
 * `services/attachmentStorage.ts`'s `storeAttachmentFile` writes to (same
 * default, unconfigured by `ATTACHMENTS_DIR` for the E2E webServer — see
 * `playwright.config.ts`), with the same `<uuid>.<ext>` naming convention,
 * then inserts the matching Attachment row with direct SQL — never through
 * `POST /api/tickets/:id/attachments`, so nothing in this test's own
 * session ever created it.
 */
export async function seedPreExistingAttachment(
  ticketId: number,
  discriminator: string,
): Promise<PreExistingAttachmentFixture> {
  // Mirrors services/attachmentStorage.ts's own uploads-dir resolution
  // (default: `server/uploads/`, relative to that file's location) —
  // duplicated here rather than imported, since e2e/ is an independent
  // package that never imports server/ source.
  const uploadsDir = path.resolve(e2eRoot, "..", "server", "uploads");
  fs.mkdirSync(uploadsDir, { recursive: true });

  const storedFilename = `${randomUUID()}.pdf`;
  const bytes = Buffer.from(`%PDF-1.4\n${" ".repeat(64 * 1024)}\n%%EOF\n`);
  fs.writeFileSync(path.join(uploadsDir, storedFilename), bytes);

  const originalFilename = `pre-existing-${discriminator}.pdf`;

  const client = new Client({ connectionString: loadE2eDatabaseUrl() });
  await client.connect();
  try {
    const inserted = await client.query<{ id: number }>(
      `INSERT INTO "Attachment"
         ("ticketId", "originalFilename", "storedFilename", "mimeType", "fileSize")
       VALUES ($1, $2, $3, 'application/pdf', $4)
       RETURNING id`,
      [ticketId, originalFilename, storedFilename, bytes.length],
    );
    return { id: inserted.rows[0].id, originalFilename, bytes };
  } finally {
    await client.end();
  }
}
