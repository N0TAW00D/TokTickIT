import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { expect, request as playwrightRequest, test, type Page } from "@playwright/test";

// Requester ticketing E2E journey (docs/lab-02/tests.md §2, E2E-01..E2E-05).
//
// This slice adds E2E-03, E2E-04 and E2E-05. E2E-01 and E2E-02 are the
// remaining rows of the same table; they depend on the Ticket Detail
// attachment download wiring (a separate PR) and are added to this file by
// a later slice.
//
// Every block here is independent of the others' execution order: each
// asserts against the specific ticket it creates (by number and by URL),
// never an absolute count, and E2E-04 checks its Requester's count as a
// before/after delta.
//
// Driven against the REAL client + REAL server + the shared `toktickit_e2e`
// Postgres database, exactly like e2e/lab-02/responsive.spec.ts and
// e2e/lab-02/submission-evidence.spec.ts — no mocked components. Where a
// specific state needs a failing backend (E2E-04's create failure), a
// Playwright `page.route(...)` intercept stubs that ONE request; nothing in
// the app is swapped out and the real server process keeps running.

// server/src/index.ts hardcodes port 3000 (see the SERVER_URL comment in
// ../playwright.config.ts); duplicated here the same way responsive.spec.ts
// and submission-evidence.spec.ts duplicate it rather than re-deriving it.
const SERVER_URL = "http://localhost:3000";

const DESKTOP = { width: 1280, height: 900 } as const;

/**
 * Clicks the "Submit ticket" button reliably. Clicking it immediately
 * after `.fill()`ing the Summary/Description fields is flaky in headless
 * Chromium: the just-blurred field's layout hasn't settled (the character
 * counter width changes, the textarea can reflow) at the instant Playwright
 * computes the click point, so the click occasionally lands on the form
 * background instead of the button and no submit fires. Clicking a stable,
 * never-moving element (the page's own `<h1>`) first forces any pending
 * blur/layout settling to finish — exactly what a real user tabbing away
 * from a field would cause — before the real click on Submit. Same
 * workaround as submission-evidence.spec.ts.
 */
async function clickSubmitTicket(page: Page): Promise<void> {
  await page.getByRole("heading", { name: "Create Ticket" }).click();
  await page.getByRole("button", { name: "Submit ticket" }).click();
}

/**
 * Drives the real Development Requester Selection screen (ui-spec.md §6)
 * exactly as a user would: pick the Requester by name, click Continue,
 * land on `/tickets`. Never pokes localStorage directly. Same shape as the
 * `loginAs` helper in submission-evidence.spec.ts.
 */
async function loginAs(page: Page, requesterName: string): Promise<void> {
  await page.goto("/select-requester");
  await page
    .getByLabel("Development Requester")
    .selectOption({ label: requesterName });
  await page.getByRole("button", { name: /Continue/ }).click();
  await expect(page).toHaveURL(/\/tickets$/);
}

interface SeededRequester {
  id: number;
  name: string;
}

/** Resolves a seeded active Requester's id via the real GET /api/requesters. */
async function requesterByName(
  api: Awaited<ReturnType<typeof playwrightRequest.newContext>>,
  name: string,
): Promise<SeededRequester> {
  const response = await api.get("/api/requesters");
  if (!response.ok()) {
    throw new Error(
      `GET /api/requesters failed: ${response.status()} ${await response.text()}`,
    );
  }
  const requesters: SeededRequester[] = await response.json();
  const found = requesters.find((r) => r.name === name);
  if (!found) {
    throw new Error(
      `Seeded active requester "${name}" not found via GET /api/requesters — check server/prisma/seed.ts.`,
    );
  }
  return found;
}

/** How many tickets a Requester currently owns, straight from the API's `meta`. */
async function ownedTicketCount(
  api: Awaited<ReturnType<typeof playwrightRequest.newContext>>,
  requesterId: number,
): Promise<number> {
  const response = await api.get("/api/tickets", {
    headers: { "X-Requester-Id": String(requesterId) },
  });
  if (!response.ok()) {
    throw new Error(
      `GET /api/tickets failed: ${response.status()} ${await response.text()}`,
    );
  }
  const body: { meta: { totalItems: number } } = await response.json();
  return body.meta.totalItems;
}

// ---------------------------------------------------------------------------
// E2E-03 (AC-03, AC-09, AC-37) — cross-requester isolation
// ---------------------------------------------------------------------------
//
// docs/lab-02/tests.md E2E-03: create a ticket as Requester A -> Change
// Requester to B -> B's My Tickets does not list A's ticket -> visiting
// `/tickets/:idOfA` shows the "Ticket not found" state.
//
// specification.md AC-03 (a Requester only ever sees their own tickets),
// AC-09 (changing the Requester reloads My Tickets for the new id), AC-37
// (`GET /api/tickets/:id` for a ticket the caller does not own is a 404,
// surfaced as "Ticket not found").
//
// Requester A is "David Lee" (this test creates one real ticket for him).
// Requester B is "Michael Brown", who only *views* here and never has a
// ticket created for him by any spec, so he is reliably empty. That lets
// the isolation check anchor on his empty-state screen — a settled state
// only reachable when his list genuinely has zero rows — BEFORE asserting
// A's ticket is absent. Asserting `toHaveCount(0)` on the ticket number
// alone would also pass transiently while B's list is still loading.

test.describe("E2E-03 cross-requester isolation (AC-03, AC-09, AC-37)", () => {
  test("a ticket created by Requester A is absent from Requester B's list and 404s on direct navigation", async ({
    page,
  }) => {
    await page.setViewportSize(DESKTOP);

    // --- Requester A creates a ticket through the real form ---------------
    await loginAs(page, "David Lee");
    await page.goto("/tickets/new");
    await expect
      .poll(() => page.locator("#create-ticket-category option").count())
      .toBeGreaterThan(1);
    await expect
      .poll(() => page.locator("#create-ticket-related-system option").count())
      .toBeGreaterThan(1);
    await page.locator("#create-ticket-category").selectOption({ index: 1 });
    await page
      .locator("#create-ticket-related-system")
      .selectOption({ index: 1 });
    const summary = "E2E-03: David Lee's private ticket";
    await page.locator("#create-ticket-summary").fill(summary);
    await page
      .locator("#create-ticket-description")
      .fill(
        "This ticket belongs to David Lee and must never appear for another Requester or load on direct navigation by one.",
      );
    await clickSubmitTicket(page);

    // Success panel names the official number (ui-spec.md §8: "Ticket
    // TKT-YYYY-NNNNNN created"). Capture it and the ticket's own URL.
    const successHeading = page.getByRole("heading", {
      name: /^Ticket TKT-\d{4}-\d{6} created$/,
    });
    await expect(successHeading).toBeVisible();
    const ticketNumber = (await successHeading.textContent())!
      .replace(/^Ticket /, "")
      .replace(/ created$/, "")
      .trim();

    await page.getByRole("button", { name: "View ticket" }).click();
    await expect(page).toHaveURL(/\/tickets\/\d+$/);
    const ticketPath = new URL(page.url()).pathname; // /tickets/:idOfA
    await expect(
      page.getByRole("heading", { name: "Ticket Details" }),
    ).toBeVisible();

    // Requester A does see it in their own list.
    await page.goto("/tickets");
    await expect(
      page.locator(`a[href="${ticketPath}"]`).first(),
    ).toBeVisible();

    // --- Change Requester to B (ui-spec.md §4 menu) ----------------------
    await page.locator('button[aria-haspopup="menu"]').click();
    await page.getByRole("menuitem", { name: "Change Requester" }).click();
    await expect(page).toHaveURL(/\/select-requester$/);
    await page
      .getByLabel("Development Requester")
      .selectOption({ label: "Michael Brown" });
    await page.getByRole("button", { name: /Continue/ }).click();
    await expect(page).toHaveURL(/\/tickets$/);

    // --- AC-03: B's My Tickets does not list A's ticket ------------------
    // Positive anchor first: Michael Brown owns zero tickets, so his list
    // settles on the empty state (ui-spec.md §9). That heading is only
    // reachable when `GET /api/tickets` for him returns zero rows — drop
    // the server's caller-scoping and this list renders A's ticket instead
    // and the empty-state assertion fails.
    await expect(
      page.getByRole("heading", {
        name: "You haven't created any tickets yet.",
      }),
    ).toBeVisible();
    await expect(page.getByText(ticketNumber)).toHaveCount(0);
    await expect(page.locator(`a[href="${ticketPath}"]`)).toHaveCount(0);

    // --- AC-37: direct navigation to A's ticket 404s for B --------------
    await page.goto(ticketPath);
    await expect(
      page.getByRole("heading", { name: "Ticket not found" }),
    ).toBeVisible();
    await expect(
      page.getByText(
        "This ticket doesn't exist or isn't associated with the current development requester.",
      ),
    ).toBeVisible();
    await expect(
      page.getByRole("button", { name: /Back to My Tickets/ }),
    ).toBeVisible();
  });
});

// ---------------------------------------------------------------------------
// E2E-04 (AC-17, BR-26) — create failure preserves input
// ---------------------------------------------------------------------------
//
// specification.md AC-17: "Given the backend is unreachable, when the user
// submits valid data, then a safe error state is shown, every entered value
// and the pending attachment list are preserved, and the Submit button
// returns to enabled." BR-26: "If a create request fails for any reason,
// the client retains all form input and the pending attachment selection;
// nothing is persisted server-side."
//
// The pending-attachment-list half of AC-17/BR-26 is exercised by C-14 (a
// UI component test) — the Create Ticket screen on this stack still renders
// an Attachments placeholder ("Attachments are added after the ticket is
// created."), so there is no pending-attachment list to preserve here yet.
// This E2E covers the field-value + safe-error + re-enable half end to end.

test.describe("E2E-04 create failure preserves input (AC-17, BR-26)", () => {
  test("a failed create shows a safe error, keeps every entered value, and re-enables Submit", async ({
    page,
  }) => {
    await page.setViewportSize(DESKTOP);
    // Any seeded active Requester works — this test never persists a ticket
    // (the POST is intercepted and fails). It asserts BR-26 by comparing
    // this Requester's ticket count before and after the failed submit, so
    // it does not care whether they already own tickets and does not
    // depend on any other spec's execution order.
    const api = await playwrightRequest.newContext({ baseURL: SERVER_URL });
    const david = await requesterByName(api, "David Lee");
    const countBefore = await ownedTicketCount(api, david.id);

    await loginAs(page, "David Lee");

    await page.goto("/tickets/new");

    // Reference-data selects must have loaded real options before the form
    // counts as ready (ui-spec.md §8 "Loading reference data" state).
    await expect
      .poll(() => page.locator("#create-ticket-category option").count())
      .toBeGreaterThan(1);
    await expect
      .poll(() => page.locator("#create-ticket-related-system option").count())
      .toBeGreaterThan(1);

    // Fill a VALID form (CreateTicketScreen validateField: Category/Related
    // System required, priority pre-selected "Medium", summary 5-140 trimmed,
    // description 20-5000 trimmed). Field ids are the implementation's, not
    // frozen doc copy — the doc pins the field labels and states, not DOM ids.
    await page.locator("#create-ticket-category").selectOption({ index: 1 });
    await page
      .locator("#create-ticket-related-system")
      .selectOption({ index: 1 });
    await page.locator("#create-ticket-priority").selectOption("HIGH");
    const summaryText = "E2E-04: create request forced to fail on submit";
    const descriptionText =
      "This description is comfortably over the twenty character minimum so the form is genuinely valid before the create call is made to fail.";
    await page.locator("#create-ticket-summary").fill(summaryText);
    await page.locator("#create-ticket-description").fill(descriptionText);

    // Snapshot the two <select> values so the "preserved" assertions below
    // compare against what was actually chosen, not a hard-coded id.
    const categoryValue = await page
      .locator("#create-ticket-category")
      .inputValue();
    const relatedValue = await page
      .locator("#create-ticket-related-system")
      .inputValue();

    // AC-17 "backend is unreachable": abort the create request itself. This
    // is the "stub one request, swap nothing in the app" approach — the real
    // server keeps running; only this one POST never reaches it. `route.abort`
    // makes the client `fetch` reject, hitting CreateTicketScreen's generic
    // `.catch` branch, the same code path a genuinely down server produces.
    let interceptedCreatePost = false;
    await page.route("**/api/tickets", async (route) => {
      if (route.request().method() !== "POST") {
        await route.continue();
        return;
      }
      interceptedCreatePost = true;
      await route.abort("failed");
    });

    await clickSubmitTicket(page);

    // Safe error state (ui-spec.md §8 "API failure on submit" — this exact
    // string is pinned by the frozen ui-spec, so it is asserted verbatim).
    // ErrorState renders role="alert" (ui-spec.md §5.4).
    await expect(
      page
        .getByRole("alert")
        .filter({
          hasText:
            "Could not create the ticket. Please check your connection and try again.",
        }),
    ).toBeVisible();
    expect(interceptedCreatePost).toBe(true);

    // Every entered value is still present in the live form (AC-17/BR-26) —
    // re-read from the inputs, not merely "not reset in state".
    await expect(page.locator("#create-ticket-summary")).toHaveValue(summaryText);
    await expect(page.locator("#create-ticket-description")).toHaveValue(
      descriptionText,
    );
    await expect(page.locator("#create-ticket-category")).toHaveValue(
      categoryValue,
    );
    await expect(page.locator("#create-ticket-related-system")).toHaveValue(
      relatedValue,
    );
    await expect(page.locator("#create-ticket-priority")).toHaveValue("HIGH");

    // Submit returns to enabled and reads "Submit ticket" again, not the
    // busy "Submitting…" label (ui-spec.md §8, AC-17).
    const submit = page.getByRole("button", { name: "Submit ticket" });
    await expect(submit).toBeVisible();
    await expect(submit).toBeEnabled();

    // Nothing was persisted (BR-26): this Requester owns exactly as many
    // tickets as before the aborted submit — asserted as a delta, not an
    // absolute count, so the test holds whatever else they own.
    await page.unroute("**/api/tickets");
    expect(await ownedTicketCount(api, david.id)).toBe(countBefore);
    await api.dispose();
  });
});

// ---------------------------------------------------------------------------
// E2E-05 (AC-29, AC-30) — empty vs no-results
// ---------------------------------------------------------------------------
//
// specification.md AC-29: "Given the current Requester owns zero tickets,
// when My Tickets loads, then the empty-state message and a Create Ticket
// call-to-action are shown (not the no-results state)." AC-30: "Given a
// filter/search that matches nothing, when applied, then the no-results
// state is shown with filters still visible and a Clear Filters action."
// BR-37: the two are different states with different messages; no-results
// keeps the active filters visible and offers Clear Filters.
//
// ui-spec.md §9 pins: the empty state hides the search/filter bar entirely
// (nothing to filter yet); the no-results state keeps it visible and
// populated. All the on-screen copy asserted below ("You haven't created
// any tickets yet.", "+ Create your first ticket", "No tickets match your
// search or filters.", "Clear filters") is pinned verbatim by the frozen
// ui-spec.md §9 States table.
//
// Requester: "Jennifer Anderson". NOT "Michael Brown" (whom
// submission-evidence.spec.ts reserves as a never-write, always-empty
// Requester and whose `beforeAll` throws if he owns any ticket) — this test
// must create a ticket for its subject Requester, so it needs a different
// one. submission-evidence.spec.ts only ever uses Jennifer Anderson for the
// Create Ticket screen + her requesterId, never for My Tickets list/count
// assertions, and responsive.spec.ts uses David Lee — so the one ticket
// created here does not pollute either. `pretest:e2e` truncates
// Ticket/Attachment/TicketCounter before every run, and this test asserts
// its Requester's live ticket count is zero before trusting the empty state
// rather than assuming a starting count.
const EMPTY_STATE_REQUESTER = "Jennifer Anderson";

test.describe("E2E-05 empty vs no-results (AC-29, AC-30)", () => {
  let requesterId: number;

  test.beforeAll(async () => {
    const api = await playwrightRequest.newContext({ baseURL: SERVER_URL });
    requesterId = (await requesterByName(api, EMPTY_STATE_REQUESTER)).id;
    const owned = await ownedTicketCount(api, requesterId);
    if (owned !== 0) {
      throw new Error(
        `E2E-05 needs "${EMPTY_STATE_REQUESTER}" (id ${requesterId}) to own zero tickets ` +
          `for the empty-state assertion, but the API reports ${owned}. Another spec ` +
          "created tickets for this Requester — pick a different genuinely-empty seeded " +
          "active Requester for EMPTY_STATE_REQUESTER, or investigate what created them.",
      );
    }
    await api.dispose();
  });

  test("a zero-ticket Requester sees the empty state; after creating one, a non-matching search shows the visibly-different no-results state", async ({
    page,
  }) => {
    await page.setViewportSize(DESKTOP);
    await loginAs(page, EMPTY_STATE_REQUESTER);

    // --- AC-29: empty state -------------------------------------------------
    // Landed on /tickets already (loginAs asserts the URL). The empty state
    // is on screen BEFORE anything is trusted about it.
    const emptyHeading = page.getByRole("heading", {
      name: "You haven't created any tickets yet.",
    });
    await expect(emptyHeading).toBeVisible();
    await expect(
      page.getByRole("button", { name: "+ Create your first ticket" }),
    ).toBeVisible();

    // ui-spec.md §9 / AC-29: the search + filter bar is hidden entirely in
    // the true-empty state. Capture the fact for the "visibly different"
    // comparison below.
    const searchBox = page.locator("#my-tickets-search");
    await expect(searchBox).toHaveCount(0);
    const noResultsMessage = page.getByText(
      "No tickets match your search or filters.",
    );
    await expect(noResultsMessage).toHaveCount(0);
    const emptyStateHadSearchBar = (await searchBox.count()) > 0;

    // --- create exactly one ticket, through the real Create Ticket form ----
    await page.goto("/tickets/new");
    await expect
      .poll(() => page.locator("#create-ticket-category option").count())
      .toBeGreaterThan(1);
    await expect
      .poll(() => page.locator("#create-ticket-related-system option").count())
      .toBeGreaterThan(1);
    await page.locator("#create-ticket-category").selectOption({ index: 1 });
    await page
      .locator("#create-ticket-related-system")
      .selectOption({ index: 1 });
    const onlyTicketSummary = "E2E-05: the one and only ticket for this Requester";
    await page.locator("#create-ticket-summary").fill(onlyTicketSummary);
    await page
      .locator("#create-ticket-description")
      .fill(
        "This description clears the twenty character minimum so the single seeding ticket is created through the real form and the real API.",
      );
    await clickSubmitTicket(page);
    await expect(
      page.getByRole("heading", { name: /^Ticket TKT-\d{4}-\d{6} created$/ }),
    ).toBeVisible();

    // --- AC-30: no-results state -----------------------------------------
    await page.goto("/tickets");
    // The Requester now genuinely owns a ticket: the list (not the empty
    // state) is what renders, the search bar is present again, and the one
    // row is the ticket just created.
    await expect(searchBox).toBeVisible();
    await expect
      .poll(() => page.locator(".zen-my-tickets__table tbody tr").count())
      .toBe(1);
    await expect(
      page.locator(".zen-my-tickets__table tbody tr").first(),
    ).toContainText(onlyTicketSummary);

    // A search that matches nothing (debounced 300ms in the app; a
    // web-first assertion waits it out — no fixed sleep).
    await searchBox.fill("zzz-no-ticket-will-ever-match-this-string-zzz");

    await expect(noResultsMessage).toBeVisible();
    // AC-30 / BR-37: filters stay visible and populated, and a Clear filters
    // action is offered right in the no-results block (scoped to it — the
    // My Tickets header also carries a "Clear filters" button whenever a
    // filter is non-default, so an unscoped role query matches two).
    await expect(searchBox).toBeVisible();
    await expect(searchBox).toHaveValue(
      "zzz-no-ticket-will-ever-match-this-string-zzz",
    );
    await expect(
      page
        .locator(".zen-no-results")
        .getByRole("button", { name: "Clear filters" }),
    ).toBeVisible();
    // Not the empty state (AC-29 vs AC-30 are different states, BR-37).
    await expect(emptyHeading).toHaveCount(0);
    const noResultsStateHasSearchBar = await searchBox.isVisible();

    // --- the two states are visibly different (BR-37, ui-spec.md §9) -------
    // Empty: no search bar, "You haven't created any tickets yet." + a
    // primary "create your first ticket" CTA, no no-results message.
    // No-results: search bar present and populated, "No tickets match your
    // search or filters." + Clear filters, no empty-state heading.
    expect(emptyStateHadSearchBar).toBe(false);
    expect(noResultsStateHasSearchBar).toBe(true);
    expect(noResultsStateHasSearchBar).not.toBe(emptyStateHadSearchBar);
  });
});

// ---------------------------------------------------------------------------
// E2E-01 (AC-01, AC-15, AC-16, AC-23, AC-33) — full requester journey
// ---------------------------------------------------------------------------
//
// tests.md §2 E2E-01: "select Requester -> create ticket + 1 attachment ->
// confirmation shows official number -> find via search in My Tickets ->
// open detail -> download attachment (200)."
//
// specification.md: AC-01 "one Ticket is saved and the official Ticket
// Number is displayed"; AC-15 confirmation shows the returned Ticket Number
// + "View ticket"/"Create another"; AC-16 the saved ticket's requesterId
// equals the Requester selected before entering the app and its status is
// NEW; AC-23 a search term matching a Ticket Number substring shows only
// matching owned tickets; AC-33 "the file is served with a
// Content-Disposition: attachment header" (api-spec.md §4.3: 200 + the raw
// bytes + `Content-Disposition: attachment; filename="<originalFilename>"`).
//
// Requester: "Sarah Johnson" — a seeded active Requester that no other
// describe block in this file seeds (E2E-04 uses David Lee, E2E-05 uses
// Jennifer Anderson). submission-evidence.spec.ts also seeds Sarah but runs
// as a separate file and asserts relative counts. Every assertion here is
// keyed to the one ticket / attachment this test creates, by number and by
// id — never an absolute count — so this block is order-independent.

/** Repo path of this spec's directory (e2e/lab-02), for building fixtures. */
const here = path.dirname(fileURLToPath(import.meta.url));

/**
 * Writes a small, valid PDF to the gitignored `e2e/test-results/` tree and
 * returns its path — the same runtime-fixture approach
 * submission-evidence.spec.ts uses (nothing binary is committed). A
 * `%PDF-1.4 ... %%EOF` envelope is a real PDF as far as the server's
 * content sniff is concerned: server/src/validation/attachmentFile.ts
 * `sniffMimeType` keys `application/pdf` off the leading `%PDF-` bytes
 * (api-spec.md §4.1 "checked by both extension and content sniff").
 */
function writePdfFixture(fileName: string): string {
  const dir = path.resolve(here, "../test-results/attachment-journeys");
  fs.mkdirSync(dir, { recursive: true });
  const filePath = path.join(dir, fileName);
  fs.writeFileSync(
    filePath,
    `%PDF-1.4\n${"TokTickIT E2E attachment payload. ".repeat(64)}\n%%EOF\n`,
  );
  return filePath;
}

test.describe("E2E-01 full requester attachment journey (AC-01, AC-15, AC-16, AC-23, AC-33)", () => {
  test("select Requester -> create a ticket with one attachment -> the confirmation shows the official ticket number -> find it via My Tickets search -> open its detail -> download the attachment (HTTP 200)", async ({
    page,
  }) => {
    await page.setViewportSize(DESKTOP);
    await loginAs(page, "Sarah Johnson");

    // Sarah's seeded id, resolved through the real API, so the AC-16
    // ownership check below compares against a known fact.
    const api = await playwrightRequest.newContext({ baseURL: SERVER_URL });
    const sarah = await requesterByName(api, "Sarah Johnson");

    // --- create a ticket WITH one attachment, through the real form ------
    await page.goto("/tickets/new");
    await expect
      .poll(() => page.locator("#create-ticket-category option").count())
      .toBeGreaterThan(1);
    await expect
      .poll(() => page.locator("#create-ticket-related-system option").count())
      .toBeGreaterThan(1);

    await page.locator("#create-ticket-category").selectOption({ index: 1 });
    await page
      .locator("#create-ticket-related-system")
      .selectOption({ index: 1 });
    const summaryText = "E2E-01: full requester journey with one attachment";
    await page.locator("#create-ticket-summary").fill(summaryText);
    await page
      .locator("#create-ticket-description")
      .fill(
        "This description is comfortably over the twenty character minimum so the ticket is genuinely valid and created through the real form and API.",
      );

    // One valid PDF selected through AttachmentUploader's real file input.
    // setInputFiles is programmatic (bypasses the input's `accept` hint on
    // purpose — the same path submission-evidence.spec.ts's demo-4 test
    // uses). The queued row + the "Attachments (1/5)" count header prove it
    // passed the component's client-side validation before submit
    // (ui-spec.md §8: "Valid files show name + size + Remove. The count
    // header reads Attachments (n/5)").
    const ATTACHMENT_NAME = "e2e-01-report.pdf";
    await page
      .locator("#create-ticket-attachments-input")
      .setInputFiles(writePdfFixture(ATTACHMENT_NAME));
    await expect(
      page.getByRole("heading", { name: "Attachments (1/5)", level: 2 }),
    ).toBeVisible();
    await expect(
      page
        .locator(
          ".zen-attachment-uploader__item:not(.zen-attachment-uploader__item--rejected)",
        )
        .locator(".zen-attachment-uploader__name"),
    ).toHaveText(ATTACHMENT_NAME);

    // The POST /api/tickets response body is the source of truth for "the
    // official Ticket Number" (AC-01) and the owner/status (AC-16) — capture
    // it rather than trusting only the on-screen string.
    const createResponsePromise = page.waitForResponse(
      (res) =>
        res.url().endsWith("/api/tickets") &&
        res.request().method() === "POST",
    );
    await clickSubmitTicket(page);
    const createResponse = await createResponsePromise;
    expect(createResponse.status()).toBe(201);
    const createdTicket: {
      id: number;
      ticketNumber: string;
      status: string;
      requester: { id: number };
    } = await createResponse.json();

    // AC-16: the saved ticket is owned by the Requester chosen before
    // entering the app, and its status is NEW.
    expect(createdTicket.requester.id).toBe(sarah.id);
    expect(createdTicket.status).toBe("NEW");
    expect(createdTicket.ticketNumber).toMatch(/^TKT-\d{4}-\d{6}$/);

    // AC-01 / AC-15: the confirmation state shows that exact official
    // number, plus the two frozen actions (ui-spec.md §8 "Success").
    await expect(
      page.getByRole("heading", {
        name: `Ticket ${createdTicket.ticketNumber} created`,
      }),
    ).toBeVisible();
    await expect(
      page.getByRole("button", { name: "View ticket" }),
    ).toBeVisible();
    await expect(
      page.getByRole("button", { name: "Create another" }),
    ).toBeVisible();
    // The lone attachment uploaded cleanly: no "could not be uploaded"
    // warning callout (ui-spec.md §8 "Success with a failed attachment"
    // renders a role="note"; the clean-success panel does not).
    await expect(page.getByRole("note")).toHaveCount(0);

    // --- find the ticket via search in My Tickets (AC-23) ---------------
    await page.goto("/tickets");
    const searchBox = page.locator("#my-tickets-search");
    await expect(searchBox).toBeVisible();
    const rows = page.locator(".zen-my-tickets__table tbody tr");
    // Positive anchor before the filtered count assertion: the new ticket
    // is genuinely present in the unfiltered, settled list first. (A past
    // bug in this file asserted a filtered result before the list had
    // finished loading and passed transiently.)
    await expect(
      page.getByRole("link", {
        name: createdTicket.ticketNumber,
        exact: true,
      }),
    ).toBeVisible();

    await searchBox.fill(createdTicket.ticketNumber);
    // Search is debounced 300ms in the app; the web-first assertions below
    // wait it out — no fixed sleep.
    await expect.poll(() => rows.count()).toBe(1);
    await expect(rows.first()).toContainText(summaryText);
    const ticketLink = page.getByRole("link", {
      name: createdTicket.ticketNumber,
      exact: true,
    });
    await expect(ticketLink).toBeVisible();

    // --- open its detail ----------------------------------------------
    await ticketLink.click();
    await expect(page).toHaveURL(
      new RegExp(`/tickets/${createdTicket.id}$`),
    );
    await expect(
      page.getByRole("heading", { name: "Ticket Details" }),
    ).toBeVisible();

    // The attachment uploaded during create is an active row here — the
    // positive anchor before the download step.
    const attachmentRow = page
      .locator(".zen-attachment-list__item")
      .filter({ hasText: ATTACHMENT_NAME });
    await expect(attachmentRow).toHaveCount(1);
    const downloadButton = attachmentRow.getByRole("button", {
      name: "Download",
    });
    await expect(downloadButton).toBeVisible();

    // --- download the attachment: prove HTTP 200 + the bytes flow ------
    // tests.md §2 E2E-01 "download attachment (200)", AC-33 "served with a
    // Content-Disposition: attachment header". Proven three ways against
    // the real server's response, not the app's behaviour: (a) the GET
    // /api/attachments/:id/download call is answered 200, (b) that
    // response carries `Content-Disposition: attachment; filename="..."`
    // (api-spec.md §4.3) — asserted on the header directly, since the
    // client falls back to `originalFilename` when the header is missing
    // so the download-event filename alone would not prove it — and (c)
    // the app's scripted `<a download>` save
    // (client/src/tickets/downloadFile.ts) surfaces to Playwright as a
    // `download` event, i.e. the bytes actually reached the browser.
    const downloadResponsePromise = page.waitForResponse((res) =>
      /\/api\/attachments\/\d+\/download$/.test(res.url()),
    );
    const downloadEventPromise = page.waitForEvent("download");
    await downloadButton.click();

    const downloadResponse = await downloadResponsePromise;
    expect(downloadResponse.request().method()).toBe("GET");
    expect(downloadResponse.status()).toBe(200);
    const contentDisposition =
      downloadResponse.headers()["content-disposition"] ?? "";
    expect(contentDisposition).toMatch(/^attachment;/);
    expect(contentDisposition).toContain(`filename="${ATTACHMENT_NAME}"`);

    const download = await downloadEventPromise;
    expect(download.suggestedFilename()).toBe(ATTACHMENT_NAME);

    await api.dispose();
  });
});

// ---------------------------------------------------------------------------
// E2E-02 (AC-21, AC-34, AC-36) — attachment failure + soft-removal journey
// ---------------------------------------------------------------------------
//
// tests.md §2 E2E-02: "on Ticket Detail, an upload forced to fail shows the
// retry affordance and a successful retry adds it; then remove an
// attachment with a reason -> row shows 'Removed' + reason -> download
// blocked in UI."
//
// specification.md: AC-21 "the user can retry the upload from Ticket
// Detail"; AC-34 "the attachment is marked Removed with the date and
// reason, disappears from the active list, and its download endpoint
// returns 410"; AC-36 "its metadata (name, size, type, removed date,
// reason) is visible and no download or preview control is offered"
// (BR-33). api-spec.md §4.4 (DELETE reason 3-200 trimmed) and §4.3
// (410 ATTACHMENT_REMOVED).
//
// NOTE ON THE "retry affordance": ui-spec.md §10's state table names an
// "Upload failed -- retry" per-row affordance with `Retry` + `Dismiss`
// buttons, but the components as built on lab2-staging do NOT render that.
// A failed upload from the Ticket Detail "+ Add attachment" control
// (AttachmentSection.handleQueuedChange -> catch) renders a single
// `role="alert"` callout ("Could not upload \"<file>\". Please check your
// connection and try again.") and clears the queue; the user retries by
// re-selecting the file through the same Add control. This test asserts the
// affordance that actually exists (the role="alert" naming the file, then a
// working re-add) — see the report for the human decision this needs.
//
// Requester: "Sarah Johnson", same rationale as E2E-01. The ticket and its
// attachment are created here and every assertion is keyed to that
// ticket/attachment id.

test.describe("E2E-02 attachment failure and soft-removal journey (AC-21, AC-34, AC-36)", () => {
  test("a forced-fail upload on Ticket Detail shows the failure affordance and a retry adds the attachment; removing it with a reason shows the Removed row and blocks download", async ({
    page,
  }) => {
    await page.setViewportSize(DESKTOP);
    await loginAs(page, "Sarah Johnson");

    const api = await playwrightRequest.newContext({ baseURL: SERVER_URL });
    const sarah = await requesterByName(api, "Sarah Johnson");

    // Seed one attachment-free ticket for Sarah through the real API, then
    // drive the attachment journey through the UI on its detail screen.
    const categories: Array<{ id: number }> = await (
      await api.get("/api/categories")
    ).json();
    const relatedSystems: Array<{ id: number }> = await (
      await api.get("/api/related-systems")
    ).json();
    const seedResponse = await api.post("/api/tickets", {
      headers: { "X-Requester-Id": String(sarah.id) },
      data: {
        categoryId: categories[0].id,
        relatedSystemId: relatedSystems[0].id,
        requestedPriority: "MEDIUM",
        summary: "E2E-02: attachment failure and soft-removal journey",
        description:
          "This ticket exists so the forced-fail upload, the retry, and the soft-removal flow can be driven end to end on its Ticket Detail screen.",
      },
    });
    expect(seedResponse.status()).toBe(201);
    const ticket: { id: number } = await seedResponse.json();

    await page.goto(`/tickets/${ticket.id}`);
    await expect(
      page.getByRole("heading", { name: "Ticket Details" }),
    ).toBeVisible();
    await expect(
      page.getByRole("heading", {
        name: "Attachments (0 active / 0 total)",
        level: 2,
      }),
    ).toBeVisible();

    // Force the FIRST upload POST for this ticket to fail, then let every
    // later one through to the real server. `route.abort` makes the client
    // `fetch` reject, hitting AttachmentSection.handleQueuedChange's catch
    // branch — the same path a genuinely failing upload takes. The real
    // server process keeps running; only this one request never reaches it.
    let failedFirstUpload = false;
    await page.route(
      `**/api/tickets/${ticket.id}/attachments`,
      async (route) => {
        if (route.request().method() === "POST" && !failedFirstUpload) {
          failedFirstUpload = true;
          await route.abort("failed");
          return;
        }
        await route.continue();
      },
    );

    const ATTACHMENT_NAME = "e2e-02-evidence.pdf";
    const fixturePath = writePdfFixture(ATTACHMENT_NAME);

    // --- first attempt: the upload fails ------------------------------
    await page
      .locator("#ticket-detail-attachments-input")
      .setInputFiles(fixturePath);
    // The failure affordance that actually renders (see the block comment):
    // a role="alert" callout naming the file. This is what the user acts on.
    const uploadAlert = page
      .getByRole("alert")
      .filter({ hasText: ATTACHMENT_NAME });
    await expect(uploadAlert).toBeVisible();
    await expect(uploadAlert).toContainText("Could not upload");
    expect(failedFirstUpload).toBe(true);
    // BR-27: an upload that fails from Ticket Detail leaves the ticket's
    // attachments untouched — no row, count unchanged.
    await expect(
      page.getByRole("heading", {
        name: "Attachments (0 active / 0 total)",
        level: 2,
      }),
    ).toBeVisible();
    await expect(page.locator(".zen-attachment-list__item")).toHaveCount(0);

    // --- retry: re-select the same file, this POST reaches the server --
    await page
      .locator("#ticket-detail-attachments-input")
      .setInputFiles(fixturePath);
    const attachmentRow = page
      .locator(".zen-attachment-list__item")
      .filter({ hasText: ATTACHMENT_NAME });
    await expect(attachmentRow).toHaveCount(1);
    await expect(
      page.getByRole("heading", {
        name: "Attachments (1 active / 1 total)",
        level: 2,
      }),
    ).toBeVisible();
    await expect(
      attachmentRow.getByRole("button", { name: "Download" }),
    ).toBeVisible();

    // --- remove that attachment with a reason (AC-34) ------------------
    const REMOVAL_REASON = "E2E-02 removing the uploaded evidence file";
    await attachmentRow.getByRole("button", { name: "Remove" }).click();
    const dialog = page.getByRole("dialog", { name: "Remove attachment" });
    await expect(dialog).toBeVisible();
    // Target the textarea by its id — an implementation detail, but the
    // "Reason for removal" label carries a trailing required-asterisk span
    // so a strict label match is brittle. ui-spec.md §10 pins the field
    // (required, 3-200 chars), not a DOM id.
    await dialog.locator("#remove-attachment-reason").fill(REMOVAL_REASON);
    await dialog
      .getByRole("button", { name: "Remove attachment" })
      .click();

    // AC-34: the row moves to the Removed presentation and a role="status"
    // toast confirms (ui-spec.md §10 "On success ... a role=\"status\"
    // toast confirms").
    await expect(
      page.getByRole("status").filter({ hasText: ATTACHMENT_NAME }),
    ).toBeVisible();
    const removedRow = page.locator(".zen-attachment-list__item--removed");
    await expect(removedRow).toHaveCount(1);
    await expect(removedRow).toContainText(ATTACHMENT_NAME);
    // ui-spec.md §10: removed rows read `Removed <date> · "<reason>"`. The
    // date text is not a frozen literal; the ` · "<reason>"` shape is.
    await expect(removedRow).toContainText("Removed");
    await expect(removedRow).toContainText(`· "${REMOVAL_REASON}"`);
    // AC-34: disappears from the active list.
    await expect(
      page.getByRole("heading", {
        name: "Attachments (0 active / 1 total)",
        level: 2,
      }),
    ).toBeVisible();

    // AC-36 / BR-33: no download (nor preview / remove) control on the
    // removed row — the UI offers no way to download it.
    await expect(
      removedRow.getByRole("button", { name: "Download" }),
    ).toHaveCount(0);
    await expect(
      removedRow.getByRole("button", { name: "Preview" }),
    ).toHaveCount(0);
    await expect(
      removedRow.getByRole("button", { name: "Remove" }),
    ).toHaveCount(0);

    // AC-34: the download endpoint itself now returns 410 for that
    // attachment (api-spec.md §4.3 "410 ATTACHMENT_REMOVED"). Read the
    // attachment's id from the real ticket state, then hit the endpoint
    // directly — the UI has removed every affordance, so this is the
    // remaining way to prove "download blocked".
    const ticketState: {
      attachments: Array<{
        id: number;
        isRemoved: boolean;
        originalFilename: string;
      }>;
    } = await (
      await api.get(`/api/tickets/${ticket.id}`, {
        headers: { "X-Requester-Id": String(sarah.id) },
      })
    ).json();
    const removed = ticketState.attachments.find(
      (attachment) => attachment.originalFilename === ATTACHMENT_NAME,
    );
    expect(removed?.isRemoved).toBe(true);
    const blockedDownload = await api.get(
      `/api/attachments/${removed!.id}/download`,
      { headers: { "X-Requester-Id": String(sarah.id) } },
    );
    expect(blockedDownload.status()).toBe(410);

    await page.unroute(`**/api/tickets/${ticket.id}/attachments`);
    await api.dispose();
  });
});
