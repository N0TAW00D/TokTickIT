import { expect, request as playwrightRequest, test, type Page } from "@playwright/test";

// Requester ticketing E2E journey (docs/lab-02/tests.md §2, E2E-01..E2E-05).
//
// This slice adds ONLY E2E-04 and E2E-05. E2E-01, E2E-02 and E2E-03 are
// earlier rows of the same table that depend on PRs not yet merged into
// this stack (the attachment uploader, the full create+search+download
// journey) and are written into this same file by another slice — room is
// deliberately left for them above these two `test.describe` blocks.
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
    // (the POST is intercepted and fails), so it cannot pollute other specs.
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

    // Nothing was persisted (BR-26): with the intercept removed, a fresh
    // reload of the same Requester's My Tickets still shows the empty state,
    // i.e. the aborted attempt created no ticket.
    await page.unroute("**/api/tickets");
    const api = await playwrightRequest.newContext({ baseURL: SERVER_URL });
    const david = await requesterByName(api, "David Lee");
    expect(await ownedTicketCount(api, david.id)).toBe(0);
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
