import fs from "node:fs";
import { expect, test } from "@playwright/test";
import { LOCAL_DEV_PASSWORD, loginAs, loginAsSeededUser } from "../support/auth.js";
import {
  createPaginationFixtureTickets,
  createRequesterOwnedFixtureTicket,
  PAGINATION_FIXTURE_TICKET_NUMBERS,
  seedPreExistingAttachment,
} from "../support/staffFixtures.js";

// Lab 3 IT Staff ticket-flow E2E journeys (docs/lab-03/tests.md §2.9,
// E2E-05..08). Like authentication.spec.ts, these drive the REAL IT Staff
// Ticket Queue (`/staff/tickets`, ui-spec.md §9) and IT Staff Ticket Detail
// (`/staff/tickets/:id`, ui-spec.md §10) screens exactly as a user would,
// against the real client + real server + the shared `toktickit_e2e`
// Postgres database — no mocking.
//
// Both tests sign in via `loginAsSeededUser` and then navigate DIRECTLY to
// `/staff/tickets` with `page.goto`, rather than asserting where login
// lands. `e2e/support/auth.ts`'s own comment documents a real gap this
// dispatch observed again first-hand: a successful (non-forced) login
// always redirects to the hardcoded `"/"` route (`LoginScreen.tsx`/
// `App.tsx`), which resolves to `/tickets` — a REQUESTER-only route — so an
// IT Staff login lands on the forbidden state (ui-spec.md §4.3) instead of
// the Ticket Queue. That is a real product bug (IT Staff has no working
// "land after login" destination today), reported here rather than fixed,
// since it's outside this dispatch's Ticket-Queue/Ticket-Detail scope.
// Navigating directly to `/staff/tickets` afterwards sidesteps it and lets
// these tests focus on the screens they actually own.
//
// `server/prisma/seed.ts` seeds exactly 8 Tickets — not enough to reach the
// Ticket Queue's smallest selectable page size (10), so E2E-05 below adds
// five extra fixture Tickets via `e2e/support/staffFixtures.ts` purely so
// pagination has a real second page to navigate to. Every other assertion
// in both tests uses seed.ts's own fixtures as-is.

const IT_STAFF_EMAIL = "priya.natarajan@example.edu";

const QUEUE_TABLE_ROWS = 'table.zen-staff-queue__table tbody tr';

// ---------------------------------------------------------------------------
// E2E-05 (AC-26..AC-33) — queue to detail
// ---------------------------------------------------------------------------
//
// tests.md E2E-05: "Search, filter, sort and paginate, then open a ticket
// from the queue." specification.md AC-26: default ordering. AC-27: search
// matches ticket number or summary. AC-28: each supported filter narrows
// the results. AC-29: each supported sort changes the ordering. AC-30: a
// paginated response/UI carries page/pageSize/totalItems/totalPages and
// holds at most pageSize rows. AC-32: an unassigned row is visibly distinct
// from an assigned one without reading colour. AC-33: empty vs. no-results
// are distinct states.

test.describe("E2E-05 queue to detail (AC-26..AC-33)", () => {
  test("search, filter, sort and paginate the IT Staff Ticket Queue, then open a ticket from the queue into its detail view", async ({
    page,
  }) => {
    await createPaginationFixtureTickets();

    await loginAsSeededUser(page, IT_STAFF_EMAIL);
    await page.goto("/staff/tickets");
    await expect(page.getByRole("heading", { name: "Ticket Queue" })).toBeVisible();

    const rows = page.locator(QUEUE_TABLE_ROWS);

    // Baseline: 8 seed.ts tickets + 5 pagination fixtures = 13. Asserting
    // this also doubles as the wait for the initial load to finish.
    await expect(rows).toHaveCount(13);

    // --- AC-32: unassigned vs. assigned owner token, without colour -------
    // TKT-2026-900001 (seed.ts) is unassigned; TKT-2026-900003 is owned by
    // Priya Natarajan.
    const unassignedRow = rows.filter({ hasText: "TKT-2026-900001" });
    await expect(unassignedRow.locator('[data-owner="unassigned"]')).toContainText(
      "Unassigned",
    );
    const assignedRow = rows.filter({ hasText: "TKT-2026-900003" });
    await expect(assignedRow.locator('[data-owner="assigned"]')).toContainText(
      "Priya Natarajan",
    );

    // --- AC-30: a paginated result carries page/pageSize/totalItems/
    // totalPages, and each page holds at most pageSize rows -------------------
    //
    // Deliberately BEFORE any search-box interaction below: the search box's
    // debounce effect (`StaffTicketQueueScreen.tsx`'s `searchInput` effect)
    // schedules a `setPage(DEFAULT_PAGE)` a fixed 300ms after the input's
    // value last changes — including a *programmatic* clear, like the "Clear
    // filters" action below performs. That timer's own guard against a
    // genuine no-op (`normalizedSearch !== previousSearchRef.current`) reads
    // a ref that is only updated from inside the timer itself, so a value
    // change that bypasses the box (as "Clear filters" does, setting
    // `searchInput` directly) leaves it stale; the previously-scheduled timer
    // then still fires ~300ms later and force-resets the page to 1 — even if
    // the user has since navigated to another page. Observed first-hand
    // while writing this test: interleaving the search/filter steps below
    // with a Prev/Next click intermittently snapped back to page 1 mid-
    // assertion. Real, reproducible latent bug in the app (a delayed,
    // un-cancelable page reset that can silently undo a later page change);
    // reported here rather than fixed, since it's outside this dispatch's
    // spec-writing scope. Running the pagination assertions first, before
    // `searchInput` is ever touched, avoids it entirely rather than papering
    // over it with a sleep.
    await page.locator("#my-tickets-page-size").selectOption("10");
    await expect(rows).toHaveCount(10);
    await expect(page.locator(".zen-pagination__summary")).toHaveText(
      "Showing 1–10 of 13",
    );
    const prevButton = page.getByRole("button", { name: "‹ Prev" });
    const nextButton = page.getByRole("button", { name: "Next ›" });
    await expect(prevButton).toBeDisabled();
    await expect(nextButton).toBeEnabled();

    await nextButton.click();
    await expect(rows).toHaveCount(3);
    await expect(page.locator(".zen-pagination__summary")).toHaveText(
      "Showing 11–13 of 13",
    );
    await expect(prevButton).toBeEnabled();
    await expect(nextButton).toBeDisabled();

    await prevButton.click();
    await expect(rows).toHaveCount(10);

    // --- AC-27: search matches ticket number or summary --------------------
    await page.locator("#staff-queue-search").fill("Wi-Fi drops");
    await expect(rows).toHaveCount(1);
    await expect(rows.first()).toContainText("TKT-2026-900002");
    await expect(rows.first()).not.toContainText("TKT-2026-900001");

    // --- AC-33: a search matching nothing shows the no-results state,
    // distinct from the empty-queue state, with a Clear filters action ------
    await page.locator("#staff-queue-search").fill("zzz-no-such-ticket-zzz");
    await expect(
      page.getByText("No tickets match these filters"),
    ).toBeVisible();
    // Scoped to the NoResultsState block itself: the controls row above it
    // also renders its own "Clear filters" button whenever filters are
    // non-default (ui-spec.md §9), so both are on screen at once here.
    await page
      .locator(".zen-no-results")
      .getByRole("button", { name: "Clear filters" })
      .click();
    // 10, not the full 13: the page size set to 10 for AC-30 above is still
    // in effect (`handleClearFilters` resets every filter/sort/search field
    // and the page number, but deliberately leaves page size untouched).
    await expect(rows).toHaveCount(10);

    // --- AC-28: each supported filter narrows the results -------------------
    // Status = New: the one seeded NEW ticket (900001) plus the 5 fixtures
    // (also NEW) = 6; a non-NEW ticket (900002, Open) must disappear. Every
    // count below stays within the 10-row page size still in effect from
    // AC-30 above, so it's never obscured by pagination.
    await page.locator("#staff-queue-status").selectOption("NEW");
    await expect(rows).toHaveCount(6);
    await expect(rows.filter({ hasText: "TKT-2026-900001" })).toHaveCount(1);
    await expect(rows.filter({ hasText: "TKT-2026-900002" })).toHaveCount(0);
    await page.locator("#staff-queue-status").selectOption("");
    await expect(rows).toHaveCount(10);

    // Owner = Unassigned: 900001, 900002, 900008 (seed.ts) + the 5 fixtures
    // = 8; an assigned ticket (900003) must disappear.
    await page.locator("#staff-queue-owner").selectOption("unassigned");
    await expect(rows).toHaveCount(8);
    await expect(rows.filter({ hasText: "TKT-2026-900003" })).toHaveCount(0);
    await page.getByRole("button", { name: "Clear filters" }).click();
    await expect(rows).toHaveCount(10);

    // --- AC-29: each supported sort changes the ordering ---------------------
    // First/last row checks, not full-list counts, so the 10-row page size
    // still in effect never hides the ticket each assertion looks for:
    // ascending puts the lowest ticket number (900001) first; descending
    // puts the highest (the last pagination fixture) first — both are within
    // whichever end of the sorted 13-row list page 1 shows.
    await page.locator("#staff-queue-sort").selectOption("ticketNumber-asc");
    await expect(rows.first()).toContainText("TKT-2026-900001");

    await page.locator("#staff-queue-sort").selectOption("ticketNumber-desc");
    await expect(rows.first()).toContainText(
      PAGINATION_FIXTURE_TICKET_NUMBERS[PAGINATION_FIXTURE_TICKET_NUMBERS.length - 1],
    );

    // --- Open a ticket from the queue into its detail view -------------------
    await page.locator("#staff-queue-search").fill("TKT-2026-900001");
    await expect(rows).toHaveCount(1);
    await rows
      .first()
      .getByRole("link", { name: "TKT-2026-900001", exact: true })
      .click();

    await expect(page).toHaveURL(/\/staff\/tickets\/\d+$/);
    await expect(page.getByRole("heading", { name: "Ticket Details" })).toBeVisible();
    await expect(page.getByText("TKT-2026-900001")).toBeVisible();
  });
});

// ---------------------------------------------------------------------------
// E2E-06 (AC-34, AC-37, AC-38) — staff operations
// ---------------------------------------------------------------------------
//
// tests.md E2E-06: "Claim, set IT Priority, perform a permitted status
// change." specification.md AC-34: claiming an unassigned Ticket makes IT
// Staff its Ticket Owner. AC-37: changing IT Priority changes it without
// touching Requested Priority. AC-38: a transition §5.1 permits, on a
// Ticket satisfying that row's precondition, succeeds.
//
// Uses TKT-2026-900001 (seed.ts): NEW, unassigned, Requested Priority LOW —
// exactly the "unassigned Ticket" AC-34 needs, and NEW's permitted next
// states (§5.1: Open, In Progress, Cancelled) include In Progress, whose
// only extra precondition (BR-24: a Ticket Owner) this test satisfies by
// claiming the ticket first. E2E-05 above never mutates this ticket, only
// searches/filters/sorts it, so it is still NEW/unassigned/LOW here
// regardless of test order within this file.

test.describe("E2E-06 staff operations (AC-34, AC-37, AC-38)", () => {
  test("claim an unassigned ticket, set its IT Priority, and perform a permitted status transition", async ({
    page,
  }) => {
    await loginAsSeededUser(page, "carlos.mendes@example.edu");
    await page.goto("/staff/tickets");
    await page.locator("#staff-queue-search").fill("TKT-2026-900001");
    await expect(page.locator(QUEUE_TABLE_ROWS)).toHaveCount(1);
    await page
      .locator(QUEUE_TABLE_ROWS)
      .first()
      .getByRole("link", { name: "TKT-2026-900001", exact: true })
      .click();
    await expect(page).toHaveURL(/\/staff\/tickets\/\d+$/);
    await expect(page.getByRole("heading", { name: "Ticket Details" })).toBeVisible();

    const ownerControl = page.locator(".zen-staff-detail__owner-control");
    const priorityControl = page.locator(".zen-staff-detail__it-priority-control");
    const statusControl = page.locator(".zen-staff-detail__status-control");
    const ownerSelect = page.locator("#staff-ticket-owner");
    const statusSelect = page.locator("#staff-ticket-status");

    // --- AC-34: claiming an unassigned ticket makes IT Staff its owner ------
    await expect(ownerSelect).toHaveValue("unassigned");
    const claimButton = page.getByRole("button", { name: "Claim" });
    await expect(claimButton).toBeVisible();
    await claimButton.click();

    await expect(ownerControl.getByText("Saved")).toBeVisible();
    await expect(claimButton).toHaveCount(0);
    await expect
      .poll(() =>
        ownerSelect.evaluate(
          (el) => (el as HTMLSelectElement).selectedOptions[0]?.textContent,
        ),
      )
      .toBe("Carlos Mendes");

    // --- AC-37: changing IT Priority changes it, not Requested Priority ------
    const requestedPriorityField = page.locator(".zen-staff-detail__field", {
      hasText: "Requested Priority",
    });
    await expect(requestedPriorityField).toContainText("Low");

    await page.getByRole("radio", { name: "High" }).click();
    await expect(priorityControl.getByText("Saved")).toBeVisible();
    await expect(page.getByRole("radio", { name: "High" })).toHaveAttribute(
      "aria-checked",
      "true",
    );
    // Requested Priority (read-only, BR-21) is untouched by the IT Priority
    // change above.
    await expect(requestedPriorityField).toContainText("Low");

    // --- AC-38: a §5.1-permitted transition succeeds -------------------------
    // NEW -> IN_PROGRESS is permitted (§5.1) and BR-24 (owner required to
    // enter In Progress) is already satisfied by the Claim above. It is
    // also NOT one of the three confirm-required destinations
    // (Close/Reopen/Cancel), so it saves immediately, same as Owner/IT
    // Priority.
    await expect(statusSelect).toHaveValue("NEW");
    await statusSelect.selectOption("IN_PROGRESS");
    await expect(statusControl.getByText("Saved")).toBeVisible();
    await expect(statusSelect).toHaveValue("IN_PROGRESS");
    await expect(page.locator(".zen-staff-detail__conflict-banner")).toHaveCount(0);

    // The Status select now offers only what §5.1 permits from In Progress
    // (Waiting for Requester, Resolved, Cancelled) — proof this is a real,
    // re-derived option list, not a leftover copy of NEW's destinations.
    await expect(
      statusSelect.locator('option[value="WAITING_FOR_REQUESTER"]'),
    ).toHaveCount(1);
    await expect(statusSelect.locator('option[value="OPEN"]')).toHaveCount(0);

    // --- Persistence: a fresh load reflects all three real, saved changes ---
    await page.reload();
    await expect(page.getByRole("heading", { name: "Ticket Details" })).toBeVisible();
    await expect
      .poll(() =>
        ownerSelect.evaluate(
          (el) => (el as HTMLSelectElement).selectedOptions[0]?.textContent,
        ),
      )
      .toBe("Carlos Mendes");
    await expect(page.getByRole("radio", { name: "High" })).toHaveAttribute(
      "aria-checked",
      "true",
    );
    await expect(page.locator("#staff-ticket-status")).toHaveValue("IN_PROGRESS");
  });
});

// ---------------------------------------------------------------------------
// E2E-07 (AC-21, AC-41, AC-42) — comment and note privacy
// ---------------------------------------------------------------------------
//
// tests.md E2E-07: "Post a Public Comment and an Internal Note; the
// Requester sees only the comment." specification.md AC-21: a Public
// Comment posted by IT Staff or the owning Requester is visible to both.
// AC-41: an Internal Note posted by IT Staff is visible to IT Staff and
// Administrators, never to the Requester. AC-42: `MessageThread`
// (ui-spec.md §8) is the single mechanism behind both threads — the same
// component, driven by a `variant` prop, not two independently-built
// surfaces that could drift apart.
//
// Needs a real, direct (non-forced-change) Requester login that owns the
// ticket under test, which no *seeded* Requester can give here (see
// `staffFixtures.ts`'s `createRequesterOwnedFixtureTicket` doc comment, and
// `auth.ts`'s own comment, for why) — so this uses that fixture rather than
// any of seed.ts's own tickets. IT Staff and the Requester are driven from
// two independent browser contexts (separate real sessions), never the
// same `page`/cookie jar re-logged-in, so this genuinely proves what each
// role's own session can and cannot see rather than relying on one
// session's client-side state being torn down cleanly.

test.describe("E2E-07 comment and note privacy (AC-21, AC-41, AC-42)", () => {
  test("IT Staff post a Public Comment and an Internal Note on a ticket; the owning Requester's own Ticket Detail shows only the Public Comment", async ({
    page,
    browser,
  }) => {
    const ticket = await createRequesterOwnedFixtureTicket(
      "comment-privacy",
      "TKT-2026-991001",
    );

    const PUBLIC_COMMENT_BODY =
      "Thanks for the report - I can see this on my end and I'm looking into it now.";
    const INTERNAL_NOTE_BODY =
      "Internal only: reproduced against the staging config, escalating to the network team.";

    // --- IT Staff posts a Public Comment AND an Internal Note --------------
    await loginAsSeededUser(page, IT_STAFF_EMAIL);
    await page.goto(`/staff/tickets/${ticket.id}`);
    await expect(page.getByRole("heading", { name: "Ticket Details" })).toBeVisible();

    // ui-spec.md §8: one shared `MessageThread` component, differentiated
    // only by its per-variant heading/badge/composer — asserted here on the
    // IT Staff screen where both variants render side by side.
    const publicThread = page.locator(".thread--public");
    const internalThread = page.locator(".thread--internal");
    await expect(publicThread.getByRole("heading", { name: "Comments" })).toBeVisible();
    await expect(
      internalThread.getByRole("heading", { name: "Internal notes" }),
    ).toBeVisible();
    await expect(
      internalThread.getByText("Private — not visible to the Requester"),
    ).toBeVisible();
    await expect(
      page.locator("[aria-label='Internal notes, not visible to the requester']"),
    ).toHaveCount(1);

    await page.locator("#message-thread-public-body").fill(PUBLIC_COMMENT_BODY);
    await publicThread.getByRole("button", { name: "Post comment" }).click();
    await expect(publicThread.getByText(PUBLIC_COMMENT_BODY)).toBeVisible();

    await page.locator("#message-thread-internal-body").fill(INTERNAL_NOTE_BODY);
    await internalThread.getByRole("button", { name: "Save internal note" }).click();
    await expect(internalThread.getByText(INTERNAL_NOTE_BODY)).toBeVisible();
    // ui-spec.md §8 "Per-entry": an Internal Note entry carries a 🔒 glyph
    // before the author, on top of everything a Public Comment entry has.
    await expect(
      internalThread.locator(".zen-message-thread__entry", {
        hasText: INTERNAL_NOTE_BODY,
      }),
    ).toContainText("🔒");

    // --- The owning Requester, in an independent session, views the same
    // ticket's own Ticket Detail ---------------------------------------------
    const requesterContext = await browser.newContext();
    try {
      const requesterPage = await requesterContext.newPage();
      await loginAs(requesterPage, ticket.requester.email, LOCAL_DEV_PASSWORD);
      await requesterPage.goto(`/tickets/${ticket.id}`);
      await expect(
        requesterPage.getByRole("heading", { name: "Ticket Details" }),
      ).toBeVisible();

      // AC-21: the Public Comment is visible to the Requester too.
      await expect(
        requesterPage.getByRole("heading", { name: "Comments" }),
      ).toBeVisible();
      await expect(requesterPage.getByText(PUBLIC_COMMENT_BODY)).toBeVisible();

      // AC-41/AC-42: the Internal Note is not visible to the Requester —
      // not merely visually hidden. ui-spec.md §7 gives the Requester
      // screen no Internal Notes surface at all (only the Public Comments
      // `MessageThread`), so every one of these must find NOTHING, by
      // `page.locator(...)` absence, never a CSS-visibility check.
      await expect(
        requesterPage.getByRole("heading", { name: "Internal notes" }),
      ).toHaveCount(0);
      await expect(requesterPage.locator(".thread--internal")).toHaveCount(0);
      await expect(
        requesterPage.locator("#message-thread-internal-body"),
      ).toHaveCount(0);
      await expect(requesterPage.getByText(INTERNAL_NOTE_BODY)).toHaveCount(0);
      await expect(
        requesterPage.getByText("Private — not visible to the Requester"),
      ).toHaveCount(0);
    } finally {
      await requesterContext.close();
    }
  });
});

// ---------------------------------------------------------------------------
// E2E-08 (AC-24, AC-43, AC-44) — requester side
// ---------------------------------------------------------------------------
//
// tests.md E2E-08: "Requester reports 'appears resolved'; staff see it; a
// Lab 2 attachment still downloads." specification.md AC-24: a Requester
// marking a ticket "Problem Appears Resolved" records the indication
// without changing the ticket's status (BR-26). AC-43: an Attachment
// created through the Lab 2 upload endpoint stays downloadable from IT
// Staff Ticket Detail once the download role guard is widened (api-spec.md
// §5: "Attachments created in Lab 2 stay downloadable from IT Staff Ticket
// Detail", FR-27). AC-44: the underlying persistence round-trips correctly.
//
// Attachment fixture note (revised per PR #83 review): `server/prisma/
// seed.ts` truncates and never re-inserts any "Attachment" row for
// `toktickit_e2e`, and the only OTHER seeded Attachment rows anywhere in
// the repo (`server/scripts/test-db-lab2-fixture.lib.ts`, used by
// `server/tests/lab-03/migration.test.ts`) live in a throwaway, Vitest-only
// Postgres database with hand-typed `storedFilename` values that were
// never actually written to disk — pointing an E2E download at one would
// 404 on real bytes that don't exist. A first version of this test worked
// around that by uploading a fresh attachment through the real UI within
// the test's own session and downloading that — which only proves the
// upload+download round trip works today, not that a *pre-existing*
// attachment (one this test's own session never created) survives the
// session/auth rewiring #70 did around the download route. Fixed: this now
// uses `seedPreExistingAttachment` (`../support/staffFixtures.ts`), which
// writes real bytes to `server/uploads/` and inserts the matching
// Attachment row with direct SQL BEFORE either login below — genuinely
// pre-existing from either session's point of view, the same shape a row
// literally created back in Lab 2 would have.

test.describe("E2E-08 requester side (AC-24, AC-43, AC-44)", () => {
  test("the Requester marks their own ticket Problem Appears Resolved and IT Staff can see it; a pre-existing attachment still downloads end to end", async ({
    page,
    browser,
  }) => {
    const ticket = await createRequesterOwnedFixtureTicket(
      "resolved-flow",
      "TKT-2026-991002",
    );
    const attachment = await seedPreExistingAttachment(ticket.id, "resolved-flow");

    // --- Requester: the pre-existing attachment is already listed (this
    // session never uploaded it); report the ticket appears resolved ------
    await loginAs(page, ticket.requester.email, LOCAL_DEV_PASSWORD);
    await page.goto(`/tickets/${ticket.id}`);
    await expect(page.getByRole("heading", { name: "Ticket Details" })).toBeVisible();

    await expect(
      page.getByRole("heading", { name: "Attachments (1 active / 1 total)" }),
    ).toBeVisible();
    await expect(page.getByText(attachment.originalFilename)).toBeVisible();

    const statusField = page.locator(".zen-ticket-detail__field", {
      hasText: "Current Status",
    });
    await expect(statusField).toContainText("Open");

    const resolveButton = page.getByRole("button", {
      name: "Problem appears resolved",
    });
    await expect(resolveButton).toBeVisible();
    await resolveButton.click();

    // ui-spec.md §7: confirm dialog copy.
    await expect(page.getByRole("dialog")).toContainText(
      "Let IT Staff know this looks resolved? They'll confirm before the ticket is closed.",
    );
    await page
      .getByRole("button", { name: "Yes, let IT Staff know" })
      .click();

    // Success: the button is replaced by a read-only note, and (BR-26) the
    // status badge itself is untouched.
    await expect(
      page.getByRole("button", { name: "Problem appears resolved" }),
    ).toHaveCount(0);
    await expect(
      page.getByText(/You reported this looks resolved on/),
    ).toBeVisible();
    await expect(statusField).toContainText("Open");

    // --- IT Staff, in an independent session, sees the resolution
    // indication and downloads the same attachment for real -----------------
    const staffContext = await browser.newContext();
    try {
      const staffPage = await staffContext.newPage();
      await loginAsSeededUser(staffPage, IT_STAFF_EMAIL);
      await staffPage.goto(`/staff/tickets/${ticket.id}`);
      await expect(
        staffPage.getByRole("heading", { name: "Ticket Details" }),
      ).toBeVisible();

      // AC-24/AC-43 indication: IT Staff Ticket Detail surfaces the
      // Requester's resolution report, in its own (staff-facing) wording.
      await expect(
        staffPage.getByText(/The requester reported this looks resolved on/),
      ).toBeVisible();
      // BR-26 from the staff side too: Status still reads the ticket's real,
      // unchanged status, not anything resolution-shaped.
      await expect(staffPage.locator("#staff-ticket-status")).toHaveValue("OPEN");

      // --- AC-43/AC-44: the PRE-EXISTING attachment downloads for real,
      // through a session that never created it -----------------------------
      const staffRow = staffPage.locator(".zen-attachment-list__item", {
        hasText: attachment.originalFilename,
      });
      await expect(staffRow).toBeVisible();

      const downloadPromise = staffPage.waitForEvent("download");
      await staffRow.getByRole("button", { name: "Download" }).click();
      const download = await downloadPromise;

      expect(download.suggestedFilename()).toBe(attachment.originalFilename);
      const downloadedPath = await download.path();
      if (!downloadedPath) {
        throw new Error(
          "Playwright did not save the downloaded attachment to a local path.",
        );
      }
      const downloadedBytes = fs.readFileSync(downloadedPath);
      // Byte-for-byte, not just "some file arrived": proves the download is
      // the real, pre-existing attachment content written directly to
      // server/uploads/ by seedPreExistingAttachment, not an empty or
      // truncated response.
      expect(downloadedBytes.equals(attachment.bytes)).toBe(true);
    } finally {
      await staffContext.close();
    }
  });
});
