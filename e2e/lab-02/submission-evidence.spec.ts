import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { expect, request as playwrightRequest, test, type Page } from "@playwright/test";

// Submission-evidence screenshots for the CPE 334 Lab 2 PDF's "Answer Part
// 6" and "Answer Part 7" headings (labsheet §8.2 Create Ticket, §8.4 My
// Tickets — see docs/lab-02/ui-spec.md §8, §9 for this repo's contract for
// those screens). Unlike e2e/lab-02/responsive.spec.ts (default-state
// screenshots at three viewports), every test here targets one specific,
// named application STATE the labsheet grades Part 6/7 on — loading,
// validation failure, submitting, success, API failure with values
// preserved, empty vs. no-results, cross-Requester rejection, etc. — and
// asserts that state is genuinely on screen before capturing it.
//
// Driven against the REAL client + REAL server + the shared `toktickit_e2e`
// Postgres database, the same way responsive.spec.ts is — no mocked
// components. Where a specific state requires an unavailable/failing
// backend (Requester Selection failure, Create Ticket API failure), a
// Playwright route intercept stubs the network response for that one
// request rather than anything in the app being swapped out.
//
// Labsheet demonstration 4 ("one valid and one invalid attachment upload")
// is covered by the "demonstration 4" test in the Create Ticket describe
// below: `lab2-staging` now renders the real `AttachmentUploader`
// (client/src/components/AttachmentUploader.tsx) on the Create Ticket
// screen, so two files can be selected through its real file input and the
// valid/invalid split asserted on screen before the capture.

const here = path.dirname(fileURLToPath(import.meta.url));

// Mirrors responsive.spec.ts's SCREENSHOT_ROOT derivation (`here` is
// e2e/lab-02, repo root is two levels up), one directory deeper into a
// `submission/` folder so these never collide with — or disturb — the
// existing create-ticket/my-tickets/ticket-detail default-state shots.
const SUBMISSION_ROOT = path.resolve(
  here,
  "../../artifacts/lab-02/screenshots/submission",
);
const PART6_DIR = path.join(SUBMISSION_ROOT, "part-6-create-ticket");
const PART7_DIR = path.join(SUBMISSION_ROOT, "part-7-my-tickets");
const PART8_DIR = path.join(SUBMISSION_ROOT, "part-8-ticket-detail");

// server/src/index.ts hardcodes port 3000 (see the SERVER_URL comment in
// ../playwright.config.ts); duplicated here for the same reason
// responsive.spec.ts duplicates it.
const SERVER_URL = "http://localhost:3000";

const DESKTOP = { width: 1280, height: 900 };

function shot(dir: string, name: string): string {
  return path.join(dir, name);
}

test.beforeAll(() => {
  fs.mkdirSync(PART6_DIR, { recursive: true });
  fs.mkdirSync(PART7_DIR, { recursive: true });
  fs.mkdirSync(PART8_DIR, { recursive: true });
});

/**
 * Clicks the "Submit ticket" button reliably.
 *
 * Clicking it immediately after `.fill()`ing the Summary/Description
 * fields is flaky in headless Chromium here: the just-blurred field's
 * layout hasn't fully settled (the character counter's width changes, the
 * textarea can reflow) at the exact instant Playwright computes the click
 * coordinates, so the click occasionally lands on the `<form>` background
 * behind the button instead of the button itself — no submit ever fires.
 * Clicking a stable, never-moving element (the page's own `<h1>`) first
 * forces any pending blur/layout settling to finish, exactly as a real
 * user tabbing or clicking away from a field would, before the real
 * click on Submit.
 */
async function clickSubmitTicket(page: Page): Promise<void> {
  await page.getByRole("heading", { name: "Create Ticket" }).click();
  await page.getByRole("button", { name: "Submit ticket" }).click();
}

/**
 * Drives the real Requester Selection screen (ui-spec.md §6) exactly as a
 * user would, for a Requester chosen by name. Lands on `/tickets`.
 */
async function loginAs(page: Page, requesterName: string): Promise<void> {
  await page.goto("/select-requester");
  await page
    .getByLabel("Development Requester")
    .selectOption({ label: requesterName });
  await page.getByRole("button", { name: /Continue/ }).click();
  await expect(page).toHaveURL(/\/tickets$/);
}

/**
 * Switches the current Requester through the real "Change Requester" UI
 * flow (ui-spec.md §4) — RequesterBadge menu -> `/select-requester` -> pick
 * `requesterName` -> Continue -> back on `/tickets`. This is the same full
 * reload AC-09 describes, never a direct localStorage/context poke.
 */
async function changeRequesterTo(page: Page, requesterName: string): Promise<void> {
  await page.locator(".zen-requester-badge__trigger").click();
  await page.getByRole("menuitem", { name: "Change Requester" }).click();
  await expect(page).toHaveURL(/\/select-requester$/);
  await page
    .getByLabel("Development Requester")
    .selectOption({ label: requesterName });
  await page.getByRole("button", { name: /Continue/ }).click();
  await expect(page).toHaveURL(/\/tickets$/);
}

// ---------------------------------------------------------------------------
// Answer Part 6 — Development Requester Selection screen
// (ui-spec.md §6, labsheet §8.1)
// ---------------------------------------------------------------------------

test.describe("Part 6 — Development Requester Selection", () => {
  test("initial state, dropdown populated, selected display, Change Requester action", async ({
    page,
  }) => {
    await page.setViewportSize(DESKTOP);

    await page.goto("/select-requester");
    await expect(
      page.getByRole("heading", { name: "Select Development Requester" }),
    ).toBeVisible();
    const select = page.getByLabel("Development Requester");
    await expect(select).toHaveValue("");
    await expect(page.getByRole("button", { name: /Continue/ })).toBeDisabled();
    await page.screenshot({
      path: shot(PART6_DIR, "01-requester-selection-initial.png"),
      fullPage: true,
    });

    // Prove the dropdown is populated from the real GET /api/requesters
    // response (server/prisma/seed.ts's 4 active Requesters), not a mock —
    // and that the inactive one is excluded.
    const optionTexts = await select.locator("option").allTextContents();
    for (const activeName of [
      "David Lee",
      "Jennifer Anderson",
      "Michael Brown",
      "Sarah Johnson",
    ]) {
      expect(optionTexts).toContain(activeName);
    }
    expect(optionTexts).not.toContain("Robert Wilson");

    // Headless Chromium does not paint a native <select>'s OS-level popup
    // into a page screenshot — clicking it open produces no visible change
    // in the capture. Temporarily switching the SAME real <select> (with
    // its real, API-sourced <option>s) into an inline listbox via the
    // `size` attribute is the standard way to make a native select's open,
    // populated state screenshot-able; nothing here is mocked markup.
    await select.evaluate((el: HTMLSelectElement) => {
      el.setAttribute("size", String(el.options.length));
      el.style.height = "auto";
    });
    await page.screenshot({
      path: shot(PART6_DIR, "02-requester-dropdown-populated.png"),
      fullPage: true,
    });
    await select.evaluate((el: HTMLSelectElement) => {
      el.removeAttribute("size");
      el.style.height = "";
    });

    await select.selectOption({ label: "Jennifer Anderson" });
    await page.getByRole("button", { name: /Continue/ }).click();
    await expect(page).toHaveURL(/\/tickets$/);

    // Selected-user display in the app shell (ui-spec.md §4) after choosing.
    const badge = page.locator(".zen-requester-badge__trigger");
    await expect(badge).toContainText("Jennifer Anderson");
    await page.screenshot({
      path: shot(PART6_DIR, "03-selected-requester-app-shell.png"),
      fullPage: true,
    });

    // The Change Requester action itself.
    await badge.click();
    await expect(
      page.getByRole("menuitem", { name: "Change Requester" }),
    ).toBeVisible();
    await page.screenshot({
      path: shot(PART6_DIR, "04-change-requester-menu-open.png"),
      fullPage: true,
    });
  });

  test("loading state", async ({ page }) => {
    await page.setViewportSize(DESKTOP);

    let releaseRequesters: () => void = () => {};
    const gate = new Promise<void>((resolve) => {
      releaseRequesters = resolve;
    });
    await page.route("**/api/requesters", async (route) => {
      await gate;
      await route.continue();
    });

    const navigation = page.goto("/select-requester");
    await expect(page.getByRole("status")).toBeVisible();
    await expect(page.getByRole("button", { name: /Continue/ })).toBeDisabled();
    await page.screenshot({
      path: shot(PART6_DIR, "05-requester-selection-loading.png"),
      fullPage: true,
    });

    releaseRequesters();
    await navigation;
    // Let the now-unblocked request resolve so the page (and route) settle
    // cleanly before the test ends.
    await expect(page.getByLabel("Development Requester")).toBeVisible();
  });

  test("failure state (API stubbed to fail)", async ({ page }) => {
    await page.setViewportSize(DESKTOP);

    await page.route("**/api/requesters", (route) =>
      route.fulfill({
        status: 500,
        contentType: "application/json",
        body: JSON.stringify({ error: "INTERNAL", message: "Simulated failure" }),
      }),
    );

    await page.goto("/select-requester");
    const alert = page.getByRole("alert");
    await expect(alert).toContainText(
      "Could not load development requesters. Please check your connection and try again.",
    );
    await expect(page.getByRole("button", { name: "Retry" })).toBeVisible();
    await page.screenshot({
      path: shot(PART6_DIR, "06-requester-selection-failure.png"),
      fullPage: true,
    });
  });
});

// ---------------------------------------------------------------------------
// Answer Part 6 — Create Ticket screen, create mode (ui-spec.md §8,
// labsheet §8.2)
// ---------------------------------------------------------------------------

test.describe("Part 6 — Create Ticket (create mode)", () => {
  test("initial state and validation failure with field-level messages", async ({
    page,
  }) => {
    await page.setViewportSize(DESKTOP);
    await loginAs(page, "Jennifer Anderson");

    await page.goto("/tickets/new");
    // Reference-data dropdowns must have actually loaded real options
    // (demonstration 2 territory, but also required for "initial state" to
    // be a genuine ready screen rather than a loading one).
    await expect
      .poll(() => page.locator("#create-ticket-category option").count())
      .toBeGreaterThan(1);
    await expect
      .poll(() => page.locator("#create-ticket-related-system option").count())
      .toBeGreaterThan(1);

    // Demonstration 1 (first half): the Requester field is populated from
    // the Development Requester selected before entering the app.
    await expect(page.locator("#create-ticket-requester")).toHaveValue(
      "Jennifer Anderson",
    );
    await expect(page.locator("#create-ticket-summary")).toHaveValue("");
    await expect(
      page.getByRole("button", { name: "Submit ticket" }),
    ).toBeEnabled();
    await page.screenshot({
      path: shot(PART6_DIR, "07-create-ticket-initial.png"),
      fullPage: true,
    });

    // Leave Category/Related System unselected, and give Summary/
    // Description values too short to pass client validation
    // (CreateTicketScreen.tsx validateField: summary needs 5-140 trimmed
    // chars, description needs 20-5000).
    await page.locator("#create-ticket-summary").fill("Hi");
    await page.locator("#create-ticket-description").fill("too short");
    await clickSubmitTicket(page);

    await expect(page.getByText("Category is required.")).toBeVisible();
    await expect(page.getByText("Related System is required.")).toBeVisible();
    await expect(
      page.getByText("Summary must be between 5 and 140 characters."),
    ).toBeVisible();
    await expect(
      page.getByText("Description must be between 20 and 5000 characters."),
    ).toBeVisible();
    await page.screenshot({
      path: shot(PART6_DIR, "08-create-ticket-validation-failure.png"),
      fullPage: true,
    });
  });

  test("submitting/busy state, success state, and the requesterId evidence for demonstration 1", async ({
    page,
  }) => {
    await page.setViewportSize(DESKTOP);
    await loginAs(page, "Jennifer Anderson");

    const api = await playwrightRequest.newContext({ baseURL: SERVER_URL });
    const requesters: Array<{ id: number; name: string }> = await (
      await api.get("/api/requesters")
    ).json();
    const jennifer = requesters.find((r) => r.name === "Jennifer Anderson");
    if (!jennifer) {
      throw new Error(
        'Seeded active requester "Jennifer Anderson" not found via GET /api/requesters.',
      );
    }

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
    await page
      .locator("#create-ticket-summary")
      .fill("Submission evidence: busy and success state ticket");
    await page
      .locator("#create-ticket-description")
      .fill(
        "This description is long enough to satisfy the twenty character minimum required by validation.",
      );

    let releasePost: () => void = () => {};
    const gate = new Promise<void>((resolve) => {
      releasePost = resolve;
    });
    await page.route("**/api/tickets", async (route) => {
      if (route.request().method() !== "POST") {
        await route.continue();
        return;
      }
      await gate;
      await route.continue();
    });

    const responsePromise = page.waitForResponse(
      (res) =>
        res.url().endsWith("/api/tickets") && res.request().method() === "POST",
    );

    await clickSubmitTicket(page);

    const busyButton = page.getByRole("button", { name: "Submitting…" });
    await expect(busyButton).toBeVisible();
    await expect(busyButton).toBeDisabled();
    await page.screenshot({
      path: shot(PART6_DIR, "09-create-ticket-submitting.png"),
      fullPage: true,
    });

    releasePost();
    const response = await responsePromise;
    expect(response.status()).toBe(201);
    const ticket: {
      id: number;
      ticketNumber: string;
      requester: { id: number; name: string };
    } = await response.json();

    // Demonstration 1 (second half): the saved Ticket carries the matching
    // requesterId — real evidence from the actual POST /api/tickets
    // response body, not an assumption.
    expect(ticket.requester.id).toBe(jennifer.id);

    await expect(
      page.getByRole("heading", {
        name: `Ticket ${ticket.ticketNumber} created`,
      }),
    ).toBeVisible();
    await page.screenshot({
      path: shot(PART6_DIR, "10-create-ticket-success.png"),
      fullPage: true,
    });

    await page.getByRole("button", { name: "View ticket" }).click();
    await expect(page).toHaveURL(new RegExp(`/tickets/${ticket.id}$`));
    await expect(
      page.getByRole("heading", { name: "Ticket Details" }),
    ).toBeVisible();
    await expect(page.getByText(ticket.ticketNumber)).toBeVisible();
    // The created ticket's detail page shows the same Requester that was
    // selected before entering the app — visual confirmation to go with
    // the requesterId check above. Scoped to the ticket info card, not
    // just `getByText`, since the app shell's own Requester badge in the
    // header also reads "Jennifer Anderson" on every screen.
    await expect(
      page.locator(".zen-ticket-detail__card").getByText("Jennifer Anderson"),
    ).toBeVisible();
    await page.screenshot({
      path: shot(PART6_DIR, "12-demo1-ticket-detail-requester-match.png"),
      fullPage: true,
    });

    await api.dispose();
  });

  test("API failure on submit preserves entered form values", async ({
    page,
  }) => {
    await page.setViewportSize(DESKTOP);
    await loginAs(page, "Jennifer Anderson");

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
    const categoryValue = await page
      .locator("#create-ticket-category")
      .inputValue();
    const relatedValue = await page
      .locator("#create-ticket-related-system")
      .inputValue();
    const summaryText = "Backend failure preserved values evidence ticket";
    const descriptionText =
      "This description proves the entered values survive an API failure on submit without being cleared.";
    await page.locator("#create-ticket-summary").fill(summaryText);
    await page.locator("#create-ticket-description").fill(descriptionText);

    // Demonstration 5: simulate the backend failing on submit (a stubbed
    // 500 exercises the exact same client error-handling code path as a
    // stopped server — CreateTicketScreen.tsx's generic `.catch` branch —
    // deterministically and without taking down the shared dev stack).
    await page.route("**/api/tickets", async (route) => {
      if (route.request().method() !== "POST") {
        await route.continue();
        return;
      }
      await route.fulfill({
        status: 500,
        contentType: "application/json",
        body: JSON.stringify({
          error: "INTERNAL",
          message: "Simulated backend failure",
        }),
      });
    });

    await clickSubmitTicket(page);

    await expect(
      page.getByRole("alert").filter({ hasText: "Could not create the ticket" }),
    ).toBeVisible();
    // Form values still visibly there, per AC-17/BR-26 — not just "not
    // reset in state" but actually re-readable from the live inputs.
    await expect(page.locator("#create-ticket-summary")).toHaveValue(
      summaryText,
    );
    await expect(page.locator("#create-ticket-description")).toHaveValue(
      descriptionText,
    );
    await expect(page.locator("#create-ticket-category")).toHaveValue(
      categoryValue,
    );
    await expect(page.locator("#create-ticket-related-system")).toHaveValue(
      relatedValue,
    );
    await expect(
      page.getByRole("button", { name: "Submit ticket" }),
    ).toBeEnabled();
    await page.screenshot({
      path: shot(PART6_DIR, "11-create-ticket-api-failure-preserved.png"),
      fullPage: true,
    });
  });

  test("demonstration 2: desktop viewport shows real seeded reference data", async ({
    page,
  }) => {
    await page.setViewportSize(DESKTOP);
    await loginAs(page, "Jennifer Anderson");

    await page.goto("/tickets/new");
    const categorySelect = page.locator("#create-ticket-category");
    const relatedSelect = page.locator("#create-ticket-related-system");
    await expect.poll(() => categorySelect.locator("option").count()).toBeGreaterThan(1);
    await expect.poll(() => relatedSelect.locator("option").count()).toBeGreaterThan(1);

    const categoryTexts = await categorySelect.locator("option").allTextContents();
    const relatedTexts = await relatedSelect.locator("option").allTextContents();
    for (const expected of [
      "Account and Access",
      "Hardware",
      "Software",
      "Network",
    ]) {
      expect(categoryTexts).toContain(expected);
    }
    for (const expected of [
      "Email",
      "Campus Wi-Fi",
      "VPN",
      "LEB2 App",
      "Grade Submission App",
      "Printer",
      "Corporate Laptop",
    ]) {
      expect(relatedTexts).toContain(expected);
    }

    // Same headless-popup limitation as the Requester dropdown: force both
    // native <select>s into an inline listbox rendering (still the real,
    // database-backed <option>s from GET /api/categories and GET
    // /api/related-systems) so the screenshot visibly shows the seeded
    // data instead of a closed "Select…" box.
    for (const select of [categorySelect, relatedSelect]) {
      await select.evaluate((el: HTMLSelectElement) => {
        el.setAttribute("size", String(el.options.length));
        el.style.height = "auto";
      });
    }
    await page.screenshot({
      path: shot(PART6_DIR, "13-demo2-desktop-reference-data-populated.png"),
      fullPage: true,
    });
  });

  test("demonstration 4: one valid and one invalid attachment on the Create Ticket screen", async ({
    page,
  }) => {
    await page.setViewportSize(DESKTOP);
    await loginAs(page, "Jennifer Anderson");

    await page.goto("/tickets/new");
    await expect(
      page.getByRole("heading", { name: "Create Ticket", level: 1 }),
    ).toBeVisible();
    // Attachments section starts empty (ui-spec.md §8: the count header
    // reads "Attachments (n/5)").
    await expect(
      page.getByRole("heading", { name: "Attachments (0/5)", level: 2 }),
    ).toBeVisible();

    // Demonstration 4 (labsheet §8.2): select TWO files through the real
    // file input rendered by AttachmentUploader (client/src/components/
    // AttachmentUploader.tsx) — one VALID (a PDF within the 5 MB limit,
    // matching the `battery-report.pdf` row in ui-spec.md §8's
    // illustration) and one INVALID (a `.exe`, matching the same
    // illustration's `virus.exe` row). setInputFiles is programmatic, so it
    // bypasses the input's `accept=".jpg,.jpeg,.png,.webp,.pdf"` hint on
    // purpose — that is exactly the drag-and-drop / programmatic path the
    // component's own client-side MIME + extension check (`validateFile`)
    // exists to guard (see its comment). The two files are written to a
    // gitignored temp dir at runtime; nothing binary is committed.
    const fixtureDir = path.resolve(here, "../test-results/demo4-attachments");
    fs.mkdirSync(fixtureDir, { recursive: true });
    const validPdfPath = path.join(fixtureDir, "battery-report.pdf");
    const invalidExePath = path.join(fixtureDir, "virus.exe");
    // ~240 KB so the queued row shows a realistic "KB" size, well under the
    // 5 MB ceiling. A minimal but well-formed PDF envelope around the pad.
    fs.writeFileSync(
      validPdfPath,
      `%PDF-1.4\n${" ".repeat(240 * 1024)}\n%%EOF\n`,
    );
    fs.writeFileSync(invalidExePath, "MZ not a real attachment");

    await page
      .locator("#create-ticket-attachments-input")
      .setInputFiles([validPdfPath, invalidExePath]);

    // The valid file is queued: exactly one non-rejected row, showing name
    // + size + Remove, and the count header advances to "Attachments (1/5)"
    // (AC-18, AC-19, ui-spec.md §8).
    await expect(
      page.getByRole("heading", { name: "Attachments (1/5)", level: 2 }),
    ).toBeVisible();
    const queuedRow = page.locator(
      ".zen-attachment-uploader__item:not(.zen-attachment-uploader__item--rejected)",
    );
    await expect(queuedRow).toHaveCount(1);
    await expect(
      queuedRow.locator(".zen-attachment-uploader__name"),
    ).toHaveText("battery-report.pdf");
    await expect(
      queuedRow.locator(".zen-attachment-uploader__size"),
    ).toHaveText(/^\d+(\.\d+)?\s(KB|MB)$/);
    await expect(
      queuedRow.getByRole("button", { name: "Remove" }),
    ).toBeVisible();

    // The invalid file is rejected with its red per-file reason — the exact
    // string AttachmentUploader.tsx's `validateFile` returns for a bad type
    // — and is NOT added to the queue (AC-19). The rejection span carries
    // role="alert".
    const rejectedRow = page.locator(
      ".zen-attachment-uploader__item--rejected",
    );
    await expect(rejectedRow).toHaveCount(1);
    await expect(
      rejectedRow.locator(".zen-attachment-uploader__name"),
    ).toHaveText("virus.exe");
    await expect(rejectedRow.getByRole("alert")).toContainText(
      "Unsupported file type — not added.",
    );
    // "virus.exe" never became a queued file: still exactly one Remove
    // button on the whole screen (the valid row's).
    await expect(page.getByRole("button", { name: "Remove" })).toHaveCount(1);

    await page.screenshot({
      path: shot(PART6_DIR, "14-demo4-valid-and-invalid-attachment.png"),
      fullPage: true,
    });
  });
});

// ---------------------------------------------------------------------------
// Answer Part 7 — My Tickets screen (ui-spec.md §9, labsheet §8.4)
// ---------------------------------------------------------------------------

test.describe("Part 7 — My Tickets", () => {
  // Requester roles for this Part, kept disjoint from Part 6's Jennifer
  // Anderson and from each other so no test's fixtures contaminate another
  // test's evidence. Every ticket these tests screenshot is created here,
  // in this `beforeAll`, through the real `POST /api/tickets` endpoint —
  // nothing depends on tickets left behind by another spec or an earlier
  // run. PR #42's `pretest:e2e` hook TRUNCATEs Ticket/Attachment/
  // TicketCounter before every `npm run test:e2e`, so each Requester below
  // starts from zero and this Part builds exactly the fixtures its
  // assertions and screenshots need.
  //   - David Lee ("Requester A"): seeded here with a self-contained set of
  //     12 tickets — more than one page at the default page size of 10 (so
  //     `06-pagination-page2.png` is a genuine page 2) and spread across
  //     every seeded Category and all three priorities, so the search,
  //     filter and sort screenshots demonstrate real filtering that is
  //     asserted row by row against the rendered table.
  //   - Sarah Johnson ("Requester B"): seeded here with her OWN small,
  //     distinct pair of tickets, so the "switch to B" screenshot shows a
  //     genuinely different non-empty list.
  //   - Michael Brown ("Requester Empty"): must own zero tickets — used
  //     ONLY for the empty-state and cross-Requester-rejection tests. No
  //     test in this file ever creates a ticket for him; the `beforeAll`
  //     still asserts his live count is zero rather than assuming it.
  let davidId: number;
  let sarahId: number;
  let michaelId: number;
  // A ticket owned by David Lee that the search / filter screenshots key
  // off. Populated in the `beforeAll` from the real `POST /api/tickets`
  // response, so its id / number / category / priority are known facts,
  // not assumptions. Created LAST so it sits on page 1 of the default
  // newest-first list.
  let davidReferenceTicket: {
    id: number;
    ticketNumber: string;
    categoryName: string;
    priority: "LOW" | "MEDIUM" | "HIGH";
  };
  const davidTicketNumbers: string[] = [];
  const sarahTicketNumbers: string[] = [];

  test.beforeAll(async () => {
    const api = await playwrightRequest.newContext({ baseURL: SERVER_URL });

    const requesters: Array<{ id: number; name: string }> = await (
      await api.get("/api/requesters")
    ).json();
    function requesterIdByName(name: string): number {
      const found = requesters.find((r) => r.name === name);
      if (!found) {
        throw new Error(
          `Seeded active requester "${name}" not found via GET /api/requesters — check server/prisma/seed.ts.`,
        );
      }
      return found.id;
    }
    davidId = requesterIdByName("David Lee");
    sarahId = requesterIdByName("Sarah Johnson");
    michaelId = requesterIdByName("Michael Brown");

    const categories: Array<{ id: number; name: string }> = await (
      await api.get("/api/categories")
    ).json();
    const relatedSystems: Array<{ id: number; name: string }> = await (
      await api.get("/api/related-systems")
    ).json();
    function categoryIdByName(name: string): number {
      const found = categories.find((c) => c.name === name);
      if (!found) {
        throw new Error(
          `Seeded category "${name}" not found via GET /api/categories — check server/prisma/seed.ts.`,
        );
      }
      return found.id;
    }
    function relatedSystemIdByName(name: string): number {
      const found = relatedSystems.find((s) => s.name === name);
      if (!found) {
        throw new Error(
          `Seeded related system "${name}" not found via GET /api/related-systems — check server/prisma/seed.ts.`,
        );
      }
      return found.id;
    }

    // Precondition for the empty-state screenshot (ui-spec.md §9 "Empty —
    // Requester owns zero tickets"): checked live, not assumed. `pretest:e2e`
    // truncates the ticket tables before every run and no test here writes
    // for Michael Brown, so this should always hold — the assertion is a
    // tripwire for a future spec accidentally seeding him.
    const michaelTickets: { meta: { totalItems: number } } = await (
      await api.get("/api/tickets", {
        headers: { "X-Requester-Id": String(michaelId) },
      })
    ).json();
    if (michaelTickets.meta.totalItems !== 0) {
      throw new Error(
        `Expected Michael Brown (id ${michaelId}) to own zero tickets for the ` +
          `empty-state screenshot, but found ${michaelTickets.meta.totalItems}. ` +
          "Some other spec created tickets for him — pick a different " +
          "genuinely-empty active Requester, or stop seeding him.",
      );
    }

    // --- David Lee (Requester A): 12 self-created tickets -----------------
    // Ordered so the last one created (newest, therefore top of the default
    // list and on page 1) is the reference ticket the search / filter shots
    // assert on. Categories and priorities are spread deliberately: the
    // "filters applied" screenshot narrows to Network + High and every
    // remaining row is checked against that Category in the DOM.
    const davidFixtures: Array<{
      category: string;
      relatedSystem: string;
      priority: "LOW" | "MEDIUM" | "HIGH";
      summary: string;
      description: string;
    }> = [
      {
        category: "Hardware",
        relatedSystem: "Corporate Laptop",
        priority: "MEDIUM",
        summary: "Laptop fan runs at full speed constantly",
        description:
          "The corporate laptop fan spins at full speed within minutes of booting even with no heavy applications open.",
      },
      {
        category: "Hardware",
        relatedSystem: "Printer",
        priority: "LOW",
        summary: "Third-floor printer jams on every multi-page job",
        description:
          "The shared printer on the third floor jams on nearly every multi-page job and needs the tray cleared each time.",
      },
      {
        category: "Hardware",
        relatedSystem: "Corporate Laptop",
        priority: "HIGH",
        summary: "Corporate laptop will not power on at all",
        description:
          "The corporate laptop shows no lights and does not respond to the power button even after charging overnight.",
      },
      {
        category: "Software",
        relatedSystem: "LEB2 App",
        priority: "LOW",
        summary: "LEB2 app shows a stale course list after login",
        description:
          "The LEB2 application keeps showing last semester's course list and does not refresh after signing out and back in.",
      },
      {
        category: "Software",
        relatedSystem: "Grade Submission App",
        priority: "MEDIUM",
        summary: "Grade submission export fails partway through",
        description:
          "Exporting grades to a spreadsheet from the grade submission application fails with a generic error partway through.",
      },
      {
        category: "Software",
        relatedSystem: "LEB2 App",
        priority: "HIGH",
        summary: "Cannot sign in to LEB2 — unexpected error",
        description:
          "Signing in to the LEB2 application returns an unexpected error on every attempt since this morning, blocking all work.",
      },
      {
        category: "Account and Access",
        relatedSystem: "Email",
        priority: "MEDIUM",
        summary: "Mailbox over-quota warnings persist after archiving",
        description:
          "The mailbox keeps showing over-quota warnings even after archiving several gigabytes of old messages yesterday.",
      },
      {
        category: "Account and Access",
        relatedSystem: "Email",
        priority: "LOW",
        summary: "Department distribution list membership is wrong",
        description:
          "Messages sent to the department distribution list are not delivered to two team members who should be on it.",
      },
      {
        category: "Network",
        relatedSystem: "Campus Wi-Fi",
        priority: "LOW",
        summary: "Weak Wi-Fi signal in the ground-floor meeting room",
        description:
          "The Wi-Fi signal in the ground floor meeting room drops to one bar and disconnects during video calls.",
      },
      {
        category: "Network",
        relatedSystem: "VPN",
        priority: "MEDIUM",
        summary: "VPN is slow to establish a connection each morning",
        description:
          "The VPN client takes several minutes to establish a connection each morning before any internal site loads.",
      },
      {
        category: "Network",
        relatedSystem: "Campus Wi-Fi",
        priority: "HIGH",
        summary: "Campus Wi-Fi drops every few minutes on all devices",
        description:
          "The campus Wi-Fi connection drops roughly every five minutes on every device, forcing a manual reconnect each time.",
      },
      {
        category: "Network",
        relatedSystem: "VPN",
        priority: "HIGH",
        summary: "Cannot connect to VPN from the home network",
        description:
          "The VPN connection fails immediately from the home network with an authentication error, though the account works on site.",
      },
    ];

    for (const [index, fixture] of davidFixtures.entries()) {
      const response = await api.post("/api/tickets", {
        headers: { "X-Requester-Id": String(davidId) },
        data: {
          categoryId: categoryIdByName(fixture.category),
          relatedSystemId: relatedSystemIdByName(fixture.relatedSystem),
          requestedPriority: fixture.priority,
          summary: fixture.summary,
          description: fixture.description,
        },
      });
      if (response.status() !== 201) {
        throw new Error(
          `Seed POST /api/tickets for David Lee failed: ${response.status()} ${await response.text()}`,
        );
      }
      const created: {
        id: number;
        ticketNumber: string;
        category: { name: string };
        requestedPriority: "LOW" | "MEDIUM" | "HIGH";
      } = await response.json();
      davidTicketNumbers.push(created.ticketNumber);
      if (index === davidFixtures.length - 1) {
        davidReferenceTicket = {
          id: created.id,
          ticketNumber: created.ticketNumber,
          categoryName: created.category.name,
          priority: created.requestedPriority,
        };
      }
    }

    // Guard the two facts the rest of this Part relies on, so an edit to
    // davidFixtures above can't silently invalidate the screenshots.
    if (davidTicketNumbers.length <= 10) {
      throw new Error(
        "Part 7 needs David Lee to own more than one page of tickets (page " +
          `size 10); seeded only ${davidTicketNumbers.length}.`,
      );
    }
    if (
      davidReferenceTicket.categoryName !== "Network" ||
      davidReferenceTicket.priority !== "HIGH"
    ) {
      throw new Error(
        "Part 7 expects the David Lee reference ticket to be Network / HIGH " +
          `(got ${davidReferenceTicket.categoryName} / ${davidReferenceTicket.priority}).`,
      );
    }

    // Sarah Johnson (Requester B) gets her own real tickets through the
    // real POST /api/tickets endpoint — never inserted directly.
    const sarahFixtures = [
      {
        summary: "Sarah Johnson evidence ticket: mouse stopped working",
        description:
          "The wireless mouse disconnects randomly during the workday and needs a battery or driver check.",
        priority: "LOW" as const,
      },
      {
        summary: "Sarah Johnson evidence ticket: email sync delayed",
        description:
          "Incoming email is arriving with a delay of twenty to thirty minutes on the desktop client only.",
        priority: "MEDIUM" as const,
      },
    ];
    for (const [index, fixture] of sarahFixtures.entries()) {
      const response = await api.post("/api/tickets", {
        headers: { "X-Requester-Id": String(sarahId) },
        data: {
          categoryId: categories[index % categories.length].id,
          relatedSystemId: relatedSystems[index % relatedSystems.length].id,
          requestedPriority: fixture.priority,
          summary: fixture.summary,
          description: fixture.description,
        },
      });
      if (response.status() !== 201) {
        throw new Error(
          `Seed POST /api/tickets for Sarah Johnson failed: ${response.status()} ${await response.text()}`,
        );
      }
      const created: { ticketNumber: string } = await response.json();
      sarahTicketNumbers.push(created.ticketNumber);
    }

    await api.dispose();
  });

  test("Requester A's ticket list, then switching to Requester B makes A's ticket disappear", async ({
    page,
  }) => {
    await page.setViewportSize(DESKTOP);
    await loginAs(page, "David Lee");

    const rows = page.locator(".zen-my-tickets__table tbody tr");
    await expect(rows.first()).toBeVisible();
    await expect(
      page.getByRole("link", { name: davidReferenceTicket.ticketNumber, exact: true }),
    ).toBeVisible();
    await page.screenshot({
      path: shot(PART7_DIR, "01-requesterA-ticket-list.png"),
      fullPage: true,
    });

    await changeRequesterTo(page, "Sarah Johnson");
    await expect(rows.first()).toBeVisible();
    for (const ticketNumber of sarahTicketNumbers) {
      await expect(
        page.getByRole("link", { name: ticketNumber, exact: true }),
      ).toBeVisible();
    }
    // The core evidence: David's ticket is genuinely gone from Sarah's list.
    await expect(
      page.getByRole("link", {
        name: davidReferenceTicket.ticketNumber,
        exact: true,
      }),
    ).toHaveCount(0);
    await page.screenshot({
      path: shot(PART7_DIR, "02-after-switch-requesterB-ticket-list.png"),
      fullPage: true,
    });
  });

  test("search in use, with a matching result", async ({ page }) => {
    await page.setViewportSize(DESKTOP);
    await loginAs(page, "David Lee");
    await expect(
      page.locator(".zen-my-tickets__table tbody tr").first(),
    ).toBeVisible();

    await page
      .getByPlaceholder("Search by ticket number or summary")
      .fill(davidReferenceTicket.ticketNumber);

    const rows = page.locator(".zen-my-tickets__table tbody tr");
    await expect.poll(() => rows.count()).toBe(1);
    await expect(
      page.getByRole("link", { name: davidReferenceTicket.ticketNumber, exact: true }),
    ).toBeVisible();
    await page.screenshot({
      path: shot(PART7_DIR, "03-search-matching-result.png"),
      fullPage: true,
    });
  });

  test("filters applied: category, priority, and status", async ({ page }) => {
    await page.setViewportSize(DESKTOP);
    await loginAs(page, "David Lee");
    await expect(
      page.locator(".zen-my-tickets__table tbody tr").first(),
    ).toBeVisible();

    const priorityLabel: Record<"LOW" | "MEDIUM" | "HIGH", string> = {
      LOW: "Low",
      MEDIUM: "Medium",
      HIGH: "High",
    };
    await page
      .getByLabel("Category")
      .selectOption({ label: davidReferenceTicket.categoryName });
    await page
      .getByLabel("Priority")
      .selectOption({ label: priorityLabel[davidReferenceTicket.priority] });
    await page.getByLabel("Status").selectOption({ label: "New" });

    const rows = page.locator(".zen-my-tickets__table tbody tr");
    await expect.poll(() => rows.count()).toBeGreaterThan(0);
    // Every visible row genuinely matches the chosen Category (independent
    // check against the rendered DOM, not a second parallel API call).
    const rowCount = await rows.count();
    for (let i = 0; i < rowCount; i++) {
      await expect(rows.nth(i).locator("td").nth(3)).toHaveText(
        davidReferenceTicket.categoryName,
      );
    }
    // The reference ticket itself — which necessarily matches all three
    // filters — is genuinely among the results.
    await expect(
      page.getByRole("link", { name: davidReferenceTicket.ticketNumber, exact: true }),
    ).toBeVisible();
    await page.screenshot({
      path: shot(PART7_DIR, "04-filters-applied.png"),
      fullPage: true,
    });
  });

  test("sorting applied: a non-default sort visibly active", async ({ page }) => {
    await page.setViewportSize(DESKTOP);
    await loginAs(page, "David Lee");

    const firstNumberCell = page
      .locator(".zen-my-tickets__table tbody tr")
      .first()
      .locator("td")
      .first();
    await expect(firstNumberCell).toBeVisible();
    const defaultTopTicketNumber = (await firstNumberCell.textContent())?.trim();

    await page
      .getByLabel("Sort", { exact: true })
      .selectOption({ label: "Ticket number (A→Z)" });

    // Wait for the reload to genuinely change the top row before reading
    // further — proves the sort actually took effect, not just that the
    // <select>'s own value changed.
    await expect
      .poll(async () => (await firstNumberCell.textContent())?.trim())
      .not.toBe(defaultTopTicketNumber);

    const rows = page.locator(".zen-my-tickets__table tbody tr");
    const sampleSize = Math.min(await rows.count(), 5);
    const ticketNumbers: string[] = [];
    for (let i = 0; i < sampleSize; i++) {
      const text = await rows.nth(i).locator("td").first().textContent();
      ticketNumbers.push((text ?? "").trim());
    }
    // Independently computed expectation (plain string sort on the
    // rendered values themselves) rather than a second call to the
    // endpoint under test.
    const expectedAscending = [...ticketNumbers].sort((a, b) =>
      a < b ? -1 : a > b ? 1 : 0,
    );
    expect(ticketNumbers).toEqual(expectedAscending);

    await page.screenshot({
      path: shot(PART7_DIR, "05-sorting-applied.png"),
      fullPage: true,
    });
  });

  test("pagination: page 2 with the range indicator visible", async ({
    page,
  }) => {
    await page.setViewportSize(DESKTOP);
    await loginAs(page, "David Lee");

    const summary = page.locator(".zen-pagination__summary");
    await expect(summary).toBeVisible();
    const initialText = (await summary.textContent()) ?? "";
    const match = initialText.match(/Showing 1–10 of (\d+)/);
    expect(match).not.toBeNull();
    const total = Number(match![1]);
    // Self-contained: David Lee's ticket count must be at least the number
    // this spec's beforeAll created for him (which alone already exceeds
    // the page size of 10), never a value assumed from accumulated data.
    expect(total).toBeGreaterThanOrEqual(davidTicketNumbers.length);
    expect(davidTicketNumbers.length).toBeGreaterThan(10);

    await page.getByRole("button", { name: "Page 2" }).click();
    await expect(summary).toHaveText(
      `Showing 11–${Math.min(20, total)} of ${total}`,
    );
    await expect(page.getByRole("button", { name: "Page 2" })).toHaveAttribute(
      "aria-current",
      "page",
    );
    await page.screenshot({
      path: shot(PART7_DIR, "06-pagination-page2.png"),
      fullPage: true,
    });
  });

  test("empty state: a Requester who owns zero tickets", async ({ page }) => {
    await page.setViewportSize(DESKTOP);
    await loginAs(page, "Michael Brown");

    await expect(
      page.getByRole("heading", { name: "You haven't created any tickets yet." }),
    ).toBeVisible();
    // AC-29: the search/filter bar is hidden entirely in the true-empty
    // state — distinct from the no-results state below, where it stays
    // visible and populated.
    await expect(page.locator("#my-tickets-search")).toHaveCount(0);
    await page.screenshot({
      path: shot(PART7_DIR, "07-empty-state.png"),
      fullPage: true,
    });
  });

  test("no-results state: an active query matching nothing (distinct from empty)", async ({
    page,
  }) => {
    await page.setViewportSize(DESKTOP);
    await loginAs(page, "David Lee");
    await expect(
      page.locator(".zen-my-tickets__table tbody tr").first(),
    ).toBeVisible();

    await page
      .getByPlaceholder("Search by ticket number or summary")
      .fill("zzz-no-such-ticket-matches-this-zzz");

    await expect(
      page.getByText("No tickets match your search or filters."),
    ).toBeVisible();
    // Distinct from the empty-state wording/structure above: the search
    // bar (and the rest of the controls) stays visible and populated here.
    await expect(page.locator("#my-tickets-search")).toBeVisible();
    await expect(
      page.getByRole("heading", { name: "You haven't created any tickets yet." }),
    ).toHaveCount(0);
    await page.screenshot({
      path: shot(PART7_DIR, "08-no-results-state.png"),
      fullPage: true,
    });
  });

  test("cross-requester access rejected: Requester B visiting Requester A's ticket detail", async ({
    page,
  }) => {
    await page.setViewportSize(DESKTOP);
    await loginAs(page, "Michael Brown");

    await page.goto(`/tickets/${davidReferenceTicket.id}`);
    await expect(
      page.getByRole("heading", { name: "Ticket not found" }),
    ).toBeVisible();
    await expect(
      page.getByText(
        "This ticket doesn't exist or isn't associated with the current development requester.",
      ),
    ).toBeVisible();
    await page.screenshot({
      path: shot(PART7_DIR, "09-cross-requester-access-rejected.png"),
      fullPage: true,
    });
  });
});

// ---------------------------------------------------------------------------
// Answer Part 8 — Requester Ticket Detail & Attachments
// (ui-spec.md §10, api-spec.md §4, labsheet §8.5)
// ---------------------------------------------------------------------------

test.describe("Part 8 — Ticket Detail & Attachments", () => {
  // Every test here seeds its OWN ticket + attachment through the real
  // POST /api/tickets and POST /api/tickets/:id/attachments endpoints
  // (api-spec.md §3.1, §4.1) in its own `beforeAll`, so no test depends on
  // another's side effects or on data left by Part 7. `pretest:e2e`
  // TRUNCATEs the ticket tables before every run. "Sarah Johnson" owns the
  // tickets; "Michael Brown" (never given a ticket — Part 7's beforeAll
  // still asserts he owns zero) is the "different Requester" for the
  // unauthorized-access shot.
  let sarahId: number;
  let michaelId: number;
  let categoryId: number;
  let relatedSystemId: number;

  const FIXTURE_DIR = path.resolve(here, "../test-results/part8-attachments");

  /** A minimal but well-formed PDF envelope, `sizeKb` KB, under the 5 MB cap. */
  function writePdfFixture(name: string, sizeKb: number): string {
    fs.mkdirSync(FIXTURE_DIR, { recursive: true });
    const filePath = path.join(FIXTURE_DIR, name);
    fs.writeFileSync(filePath, `%PDF-1.4\n${" ".repeat(sizeKb * 1024)}\n%%EOF\n`);
    return filePath;
  }

  interface SeededTicket {
    id: number;
    ticketNumber: string;
    attachmentId: number;
  }

  /**
   * Creates one Sarah-owned ticket with a single active PDF attachment,
   * through the real API. Returns the ids the tests key their assertions to.
   */
  async function seedTicketWithAttachment(
    api: Awaited<ReturnType<typeof playwrightRequest.newContext>>,
    attachmentName: string,
    sizeKb: number,
  ): Promise<SeededTicket> {
    const createResponse = await api.post("/api/tickets", {
      headers: { "X-Requester-Id": String(sarahId) },
      data: {
        categoryId,
        relatedSystemId,
        requestedPriority: "MEDIUM",
        summary:
          "Part 8 evidence: corporate laptop battery drains within an hour",
        description:
          "The corporate laptop battery drops from full to empty within an hour of unplugging, even with just a browser open.",
      },
    });
    if (createResponse.status() !== 201) {
      throw new Error(
        `Part 8 seed POST /api/tickets failed: ${createResponse.status()} ${await createResponse.text()}`,
      );
    }
    const created: { id: number; ticketNumber: string } =
      await createResponse.json();

    const pdfPath = writePdfFixture(attachmentName, sizeKb);
    const uploadResponse = await api.post(
      `/api/tickets/${created.id}/attachments`,
      {
        headers: { "X-Requester-Id": String(sarahId) },
        multipart: {
          file: {
            name: attachmentName,
            mimeType: "application/pdf",
            buffer: fs.readFileSync(pdfPath),
          },
        },
      },
    );
    if (uploadResponse.status() !== 201) {
      throw new Error(
        `Part 8 seed POST /api/tickets/:id/attachments failed: ${uploadResponse.status()} ${await uploadResponse.text()}`,
      );
    }
    const uploaded: { id: number } = await uploadResponse.json();
    return {
      id: created.id,
      ticketNumber: created.ticketNumber,
      attachmentId: uploaded.id,
    };
  }

  test.beforeAll(async () => {
    const api = await playwrightRequest.newContext({ baseURL: SERVER_URL });

    const requesters: Array<{ id: number; name: string }> = await (
      await api.get("/api/requesters")
    ).json();
    function requesterIdByName(name: string): number {
      const found = requesters.find((r) => r.name === name);
      if (!found) {
        throw new Error(
          `Seeded active requester "${name}" not found via GET /api/requesters — check server/prisma/seed.ts.`,
        );
      }
      return found.id;
    }
    sarahId = requesterIdByName("Sarah Johnson");
    michaelId = requesterIdByName("Michael Brown");

    const categories: Array<{ id: number; name: string }> = await (
      await api.get("/api/categories")
    ).json();
    const relatedSystems: Array<{ id: number; name: string }> = await (
      await api.get("/api/related-systems")
    ).json();
    const cat = categories.find((c) => c.name === "Hardware")?.id;
    const rel = relatedSystems.find((r) => r.name === "Corporate Laptop")?.id;
    if (cat === undefined || rel === undefined) {
      throw new Error(
        "Part 8 seed: expected the seeded 'Hardware' category and 'Corporate Laptop' related system — check server/prisma/seed.ts.",
      );
    }
    categoryId = cat;
    relatedSystemId = rel;

    await api.dispose();
  });

  test("owned ticket detail (read-only header), adding an attachment via the Add control, and downloading an active one", async ({
    page,
  }) => {
    const ATTACHMENT_NAME = "initial-report.pdf";
    const api = await playwrightRequest.newContext({ baseURL: SERVER_URL });
    const ticket = await seedTicketWithAttachment(api, ATTACHMENT_NAME, 180);

    await page.setViewportSize(DESKTOP);
    await loginAs(page, "Sarah Johnson");
    await page.goto(`/tickets/${ticket.id}`);

    // --- Shot 1: a Requester viewing their own ticket's detail page ------
    await expect(
      page.getByRole("heading", { name: "Ticket Details", level: 1 }),
    ).toBeVisible();
    const infoCard = page.locator(".zen-ticket-detail__card").first();
    await expect(infoCard.getByText(ticket.ticketNumber)).toBeVisible();
    // The owning Requester shows in the ticket-information card — scoped
    // there, not the app-shell badge (which reads the same name on every
    // screen).
    await expect(infoCard.getByText("Sarah Johnson")).toBeVisible();
    // ui-spec.md §10 / BR-39 / tests.md C-29: every header field is static
    // text — the information card has no inputs at all.
    await expect(infoCard.locator("input, textarea, select")).toHaveCount(0);
    await expect(
      page.getByRole("heading", {
        name: "Attachments (1 active / 1 total)",
        level: 2,
      }),
    ).toBeVisible();
    const seededRow = page.locator(".zen-attachment-list__item", {
      hasText: ATTACHMENT_NAME,
    });
    await expect(seededRow).toBeVisible();
    await expect(
      seededRow.getByRole("button", { name: "Download" }),
    ).toBeVisible();
    await expect(
      seededRow.getByRole("button", { name: "Remove" }),
    ).toBeVisible();
    await page.screenshot({
      path: shot(PART8_DIR, "01-owned-ticket-detail.png"),
      fullPage: true,
    });

    // --- Shot 2: Add-attachment control after a file has been uploaded ---
    const addedName = "supplementary-log.pdf";
    await page
      .locator("#ticket-detail-attachments-input")
      .setInputFiles(writePdfFixture(addedName, 90));

    // A new active row appears and both counts in the heading advance
    // (ui-spec.md §10 "N active / M total", AC-21).
    await expect(
      page.getByRole("heading", {
        name: "Attachments (2 active / 2 total)",
        level: 2,
      }),
    ).toBeVisible();
    const addedRow = page.locator(".zen-attachment-list__item", {
      hasText: addedName,
    });
    await expect(addedRow).toBeVisible();
    await expect(
      addedRow.getByRole("button", { name: "Download" }),
    ).toBeVisible();
    await page.screenshot({
      path: shot(PART8_DIR, "02-add-attachment.png"),
      fullPage: true,
    });

    // --- Shot 3: downloading an active attachment (assert the GET is 200) -
    page.on("download", (download) => {
      // Accept + discard: the real <a download> click still fires (so the
      // save path is exercised) but the bytes aren't needed on disk.
      void download.path().catch(() => {});
    });
    const downloadResponsePromise = page.waitForResponse(
      (res) =>
        res.url().includes(`/api/attachments/${ticket.attachmentId}/download`) &&
        res.request().method() === "GET",
    );
    await seededRow.getByRole("button", { name: "Download" }).click();
    const downloadResponse = await downloadResponsePromise;
    // api-spec.md §4.3: an active attachment on an owned ticket → 200, with
    // the original filename in Content-Disposition.
    expect(downloadResponse.status()).toBe(200);
    expect(
      downloadResponse.headers()["content-disposition"] ?? "",
    ).toContain(ATTACHMENT_NAME);
    await page.screenshot({
      path: shot(PART8_DIR, "03-download-active-attachment.png"),
      fullPage: true,
    });

    await api.dispose();
  });

  test("soft removal with a reason: the confirmation dialog, the removed-row presentation, retained metadata, and the blocked download", async ({
    page,
  }) => {
    const ATTACHMENT_NAME = "report-to-remove.pdf";
    const REMOVAL_REASON =
      "Uploaded the wrong report for this Part 8 evidence ticket";
    const api = await playwrightRequest.newContext({ baseURL: SERVER_URL });
    const ticket = await seedTicketWithAttachment(api, ATTACHMENT_NAME, 180);

    await page.setViewportSize(DESKTOP);
    await loginAs(page, "Sarah Johnson");
    await page.goto(`/tickets/${ticket.id}`);

    const seededRow = page.locator(".zen-attachment-list__item", {
      hasText: ATTACHMENT_NAME,
    });
    await expect(
      seededRow.getByRole("button", { name: "Remove" }),
    ).toBeVisible();

    // --- Shot 4: Remove confirmation dialog open, reason typed in --------
    await seededRow.getByRole("button", { name: "Remove" }).click();
    const dialog = page.getByRole("dialog", { name: "Remove attachment" });
    await expect(dialog).toBeVisible();
    await expect(dialog).toContainText(ATTACHMENT_NAME);
    const reasonField = dialog.getByLabel("Reason for removal");
    await reasonField.fill(REMOVAL_REASON);
    await expect(reasonField).toHaveValue(REMOVAL_REASON);
    await page.screenshot({
      path: shot(PART8_DIR, "04-remove-dialog-with-reason.png"),
      fullPage: true,
    });

    // --- Shot 5: the result — the row in its "Removed" presentation -----
    await dialog.getByRole("button", { name: "Remove attachment" }).click();
    await expect(page.getByRole("dialog")).toHaveCount(0);
    // AC-34: a role="status" toast confirms the removal.
    await expect(
      page.locator(".zen-attachment-section__toast"),
    ).toContainText(`"${ATTACHMENT_NAME}" was removed.`);

    const removedRow = page.locator(".zen-attachment-list__item--removed");
    await expect(removedRow).toHaveCount(1);
    // ui-spec.md §10: the removed line is exactly `Removed <date> · "<reason>"`
    // — no "on", a middot separator, the reason wrapped in double quotes.
    await expect(
      removedRow.locator(".zen-attachment-list__removed-meta"),
    ).toHaveText(
      new RegExp(
        `^Removed \\d{1,2} [A-Z][a-z]{2}, \\d{2}:\\d{2} \\u00b7 "${REMOVAL_REASON.replace(
          /[.*+?^${}()|[\]\\]/g,
          "\\$&",
        )}"$`,
      ),
    );
    // This ticket's only attachment was just removed: 0 active, 1 total —
    // a removed attachment is retained, not deleted (BR-31).
    await expect(
      page.getByRole("heading", {
        name: "Attachments (0 active / 1 total)",
        level: 2,
      }),
    ).toBeVisible();
    await page.screenshot({
      path: shot(PART8_DIR, "05-attachment-removed-with-reason.png"),
      fullPage: true,
    });

    // --- Shot 6: retained metadata (BR-33, AC-36) ----------------------
    // name / size / type / removed-date / reason all still on the removed
    // row — the metadata is kept, only access is revoked.
    await expect(
      removedRow.locator(".zen-attachment-list__name"),
    ).toHaveText(ATTACHMENT_NAME);
    await expect(
      removedRow.locator(".zen-attachment-list__size"),
    ).toHaveText(/^\d+(\.\d+)?\s(KB|MB)$/);
    await expect(
      removedRow.locator(".zen-attachment-list__type"),
    ).toHaveText("PDF");
    await expect(removedRow).toContainText(REMOVAL_REASON);
    await page.screenshot({
      path: shot(PART8_DIR, "06-removed-metadata-retained.png"),
      fullPage: true,
    });

    // --- Shot 7: the removed attachment can't be downloaded ------------
    // The removed row offers no Download / Preview / Remove control
    // (BR-33, AC-36)…
    await expect(removedRow.getByRole("button")).toHaveCount(0);
    // …and the download endpoint itself now returns 410 ATTACHMENT_REMOVED
    // (api-spec.md §4.3) — proven by a direct API call, not just the UI.
    const blockedResponse = await api.get(
      `/api/attachments/${ticket.attachmentId}/download`,
      { headers: { "X-Requester-Id": String(sarahId) } },
    );
    expect(blockedResponse.status()).toBe(410);
    const blockedBody: { error: string } = await blockedResponse.json();
    expect(blockedBody.error).toBe("ATTACHMENT_REMOVED");
    await page.screenshot({
      path: shot(PART8_DIR, "07-removed-download-blocked.png"),
      fullPage: true,
    });

    await api.dispose();
  });

  test("unauthorized access rejected: a different Requester opening this ticket's /tickets/:id URL", async ({
    page,
  }) => {
    const api = await playwrightRequest.newContext({ baseURL: SERVER_URL });
    const ticket = await seedTicketWithAttachment(
      api,
      "owner-only-report.pdf",
      120,
    );
    await api.dispose();

    await page.setViewportSize(DESKTOP);
    await loginAs(page, "Michael Brown");
    // Guard the premise of this shot: Michael is not the owner.
    expect(michaelId).not.toBe(sarahId);

    await page.goto(`/tickets/${ticket.id}`);
    // ui-spec.md §10 / AC-37, AC-38, BR-14: unknown and not-owned are the
    // same "Ticket not found" state, byte-identical copy.
    await expect(
      page.getByRole("heading", { name: "Ticket not found" }),
    ).toBeVisible();
    await expect(
      page.getByText(
        "This ticket doesn't exist or isn't associated with the current development requester.",
      ),
    ).toBeVisible();
    await page.screenshot({
      path: shot(PART8_DIR, "08-unauthorized-access-rejected.png"),
      fullPage: true,
    });
  });
});
