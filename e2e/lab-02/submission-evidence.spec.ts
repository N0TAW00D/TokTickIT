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
// NOT covered here (see the final report, not this file): labsheet
// demonstration 4 ("one valid and one invalid attachment upload") is not
// possible on this branch — CreateTicketScreen.tsx's Attachments section is
// a placeholder ("Attachments are added after the ticket is created.");
// the real AttachmentUploader lives in an unmerged PR. Skipped rather than
// faked.

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
});
