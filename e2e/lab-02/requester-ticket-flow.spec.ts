import { expect, request as playwrightRequest, test, type Page } from "@playwright/test";

// Requester ticketing E2E journey (docs/lab-02/tests.md §2, E2E-01..E2E-05).
//
// This commit adds E2E-04. E2E-05 lands next; E2E-01, E2E-02 and E2E-03 are
// earlier rows of the same table that depend on PRs not yet merged into
// this stack (the attachment uploader, the full create+search+download
// journey) and are written into this same file by another slice — room is
// deliberately left for them above the `test.describe` blocks.
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
