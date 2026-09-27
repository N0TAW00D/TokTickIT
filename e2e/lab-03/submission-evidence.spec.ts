import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import dotenv from "dotenv";
import { Client } from "pg";
import {
  expect,
  request as playwrightRequest,
  test,
  type Browser,
  type Page,
} from "@playwright/test";
import {
  LOCAL_DEV_PASSWORD,
  SAFE_LOGIN_FAILURE_MESSAGE,
  createMustChangePasswordFixtureUser,
  createPlainLoginFixtureUser,
  loginAs,
  loginAsSeededUser,
} from "../support/auth.js";
import {
  createPaginationFixtureTickets,
  createRequesterOwnedFixtureTicket,
  seedPreExistingAttachment,
} from "../support/staffFixtures.js";
import { resetUserAdministrationFixtures } from "../support/adminFixtures.js";

// Submission-evidence screenshots for the CPE 334 Lab 3 PDF's "Answer Part
// 5".."Answer Part 8" headings (Issue #74's handout, §14). Follows
// e2e/lab-02/submission-evidence.spec.ts's pattern exactly: every test here
// targets one specific, named application STATE the labsheet grades those
// Parts on, asserts that state is genuinely on screen (or, for Part 7's
// authorization evidence, genuinely returned by the raw HTTP API) before
// capturing it, and writes numbered screenshots into
// artifacts/lab-03/screenshots/submission/part-N-*/NN-*.png. Driven against
// the REAL client + REAL server + the shared `toktickit_e2e` Postgres
// database, exactly like every other e2e/lab-03/*.spec.ts file — no mocked
// components. A Playwright route intercept stubs a network response only
// where a specific state requires an unavailable/failing backend (busy
// login, safe API failures), never anything in the app itself.
//
// docs/lab-03/tests.md §2.9 "Submission evidence" subsection maps EV-01..
// EV-04 (one per Part) to the tests below.

const here = path.dirname(fileURLToPath(import.meta.url));

const SUBMISSION_ROOT = path.resolve(
  here,
  "../../artifacts/lab-03/screenshots/submission",
);
const PART5_DIR = path.join(SUBMISSION_ROOT, "part-5-login");
const PART6_DIR = path.join(SUBMISSION_ROOT, "part-6-staff-queue");
const PART7_DIR = path.join(SUBMISSION_ROOT, "part-7-staff-detail");
const PART8_DIR = path.join(SUBMISSION_ROOT, "part-8-user-management");

// server/src/index.ts hardcodes port 3000 (see playwright.config.ts's own
// SERVER_URL comment) — duplicated here for the direct API-authorization
// evidence in Part 7, the same reason every other Lab 3 helper duplicates
// it rather than importing across the e2e/server package boundary.
const SERVER_URL = "http://localhost:3000";

// docs/lab-03/tests.md §1.5 viewport matrix.
const DESKTOP = { width: 1440, height: 900 };
const MOBILE = { width: 390, height: 844 };

// server/prisma/seed.ts SEED_ACTIVE_IT_STAFF / SEED_ADMINISTRATORS — the
// same accounts every other Lab 3 spec file logs in as.
const IT_STAFF_EMAIL = "priya.natarajan@example.edu";
const SECOND_STAFF_NAME = "Carlos Mendes";
const ADMIN_EMAIL = "olivia.grant@example.edu";
const SECOND_ADMIN_EMAIL = "noah.kim@example.edu";
const SECOND_ADMIN_NAME = "Noah Kim";

// Seeded INACTIVE Requester (server/prisma/seed.ts SEED_INACTIVE_REQUESTERS)
// — same account e2e/lab-03/authentication.spec.ts's E2E-03 uses.
const INACTIVE_REQUESTER_EMAIL = "robert.wilson@example.edu";

function shot(dir: string, name: string): string {
  return path.join(dir, name);
}

test.beforeAll(() => {
  fs.mkdirSync(PART5_DIR, { recursive: true });
  fs.mkdirSync(PART6_DIR, { recursive: true });
  fs.mkdirSync(PART7_DIR, { recursive: true });
  fs.mkdirSync(PART8_DIR, { recursive: true });
});

// ---------------------------------------------------------------------------
// Part 5 — Login, Change Password, Logout (EV-01)
// ---------------------------------------------------------------------------

test.describe("Part 5 — Login (EV-01)", () => {
  test("invalid credentials, busy submitting state, valid landing, logout, and blocked direct access afterwards", async ({
    page,
  }) => {
    const fixtureUser = await createPlainLoginFixtureUser("ev-login");

    await page.goto("/login");
    await expect(page.locator("#login-email")).toBeVisible();

    // --- invalid credentials: safe failure -------------------------------
    await page.locator("#login-email").fill(fixtureUser.email);
    await page.locator("#login-password").fill("Definitely-The-Wrong-Password-1!");
    await page.getByRole("button", { name: "Sign in" }).click();
    await expect(page.getByRole("alert")).toContainText(SAFE_LOGIN_FAILURE_MESSAGE);
    await expect(page).toHaveURL(/\/login$/);
    await page.screenshot({
      path: shot(PART5_DIR, "02-invalid-credentials-safe-error.png"),
      fullPage: true,
    });

    // --- busy/submitting state: hold the real login response -------------
    await page.locator("#login-password").fill(LOCAL_DEV_PASSWORD);
    let releaseLogin: () => void = () => {};
    const gate = new Promise<void>((resolve) => {
      releaseLogin = resolve;
    });
    await page.route("**/api/auth/login", async (route) => {
      if (route.request().method() !== "POST") {
        await route.continue();
        return;
      }
      await gate;
      await route.continue();
    });
    const loginResponsePromise = page.waitForResponse(
      (res) => res.url().endsWith("/api/auth/login") && res.request().method() === "POST",
    );
    await page.getByRole("button", { name: "Sign in" }).click();

    const busyButton = page.getByRole("button", { name: "Signing in…" });
    await expect(busyButton).toBeVisible();
    await expect(busyButton).toBeDisabled();
    await expect(page.locator(".zen-login-screen__busy-announcement")).toContainText(
      "Signing in…",
    );
    await expect(page.locator("#login-email")).toHaveJSProperty("readOnly", true);
    await expect(page.locator("#login-password")).toHaveJSProperty("readOnly", true);
    await page.screenshot({
      path: shot(PART5_DIR, "04-login-busy-submitting.png"),
      fullPage: true,
    });

    releaseLogin();
    const loginResponse = await loginResponsePromise;
    expect(loginResponse.status()).toBe(200);

    // --- valid login landing: name + role visible in the shell -----------
    await expect(page).toHaveURL(/\/tickets$/);
    await expect(page.getByRole("heading", { name: "My Tickets" })).toBeVisible();
    const userBadge = page.locator(".zen-user-badge__trigger");
    await expect(userBadge).toContainText(fixtureUser.name);
    await expect(userBadge).toContainText("Requester");
    await page.screenshot({
      path: shot(PART5_DIR, "01-valid-login-landing.png"),
      fullPage: true,
    });

    // --- logout returns to Login ------------------------------------------
    await userBadge.click();
    await page.getByRole("menuitem", { name: "Logout" }).click();
    await expect(page).toHaveURL(/\/login$/);
    await expect(page.locator("#login-email")).toBeVisible();
    await page.screenshot({
      path: shot(PART5_DIR, "08-logout-returns-to-login.png"),
      fullPage: true,
    });

    // --- a protected URL visited directly after logout redirects to Login -
    await page.goto("/tickets");
    await expect(page).toHaveURL(/\/login$/);
    await expect(page.getByRole("heading", { name: "My Tickets" })).toHaveCount(0);
    await page.screenshot({
      path: shot(PART5_DIR, "09-protected-url-after-logout-redirects-to-login.png"),
      fullPage: true,
    });
  });

  test("an inactive account's login attempt gets the same safe failure message as a wrong password", async ({
    page,
  }) => {
    await page.goto("/login");
    await page.locator("#login-email").fill(INACTIVE_REQUESTER_EMAIL);
    // The CORRECT shared password — proves the refusal is because the
    // account is inactive, not because the password was wrong.
    await page.locator("#login-password").fill(LOCAL_DEV_PASSWORD);
    await page.getByRole("button", { name: "Sign in" }).click();

    await expect(page.getByRole("alert")).toContainText(SAFE_LOGIN_FAILURE_MESSAGE);
    await expect(page).toHaveURL(/\/login$/);
    await page.screenshot({
      path: shot(PART5_DIR, "03-inactive-account-safe-error.png"),
      fullPage: true,
    });
  });

  test("forced first-login Change Password: banner, a password-rule validation error, then a successful continuation into the app", async ({
    page,
  }) => {
    const fixtureUser = await createMustChangePasswordFixtureUser();

    await loginAs(page, fixtureUser.email, LOCAL_DEV_PASSWORD);
    await expect(page).toHaveURL(/\/change-password$/);
    await expect(
      page.getByRole("status").filter({ hasText: "Choose a new password before continuing." }),
    ).toBeVisible();
    // Forced mode has no Current password field (ui-spec.md §6).
    await expect(page.locator("#change-password-current")).toHaveCount(0);
    await page.screenshot({
      path: shot(PART5_DIR, "05-forced-change-password-screen.png"),
      fullPage: true,
    });

    // --- password-rule validation error: too short -------------------------
    const TOO_SHORT_PASSWORD = "short1";
    await page.locator("#change-password-new").fill(TOO_SHORT_PASSWORD);
    await page.locator("#change-password-confirm").fill(TOO_SHORT_PASSWORD);
    await page.getByRole("button", { name: "Save password" }).click();
    await expect(
      page.getByText("Password must be between 8 and 128 characters."),
    ).toBeVisible();
    // Rejected client-side: still on Change Password, no request needed.
    await expect(page).toHaveURL(/\/change-password$/);
    await page.screenshot({
      path: shot(PART5_DIR, "06-password-rule-validation-error.png"),
      fullPage: true,
    });

    // --- successful continuation into the app -------------------------------
    const NEW_PASSWORD = "Ev-Submission-Evidence-New-Password-1!";
    await page.locator("#change-password-new").fill(NEW_PASSWORD);
    await page.locator("#change-password-confirm").fill(NEW_PASSWORD);
    await page.getByRole("button", { name: "Save password" }).click();

    await expect(
      page.getByRole("status").filter({ hasText: "Password changed." }),
    ).toBeVisible();
    await expect(page).toHaveURL(/\/tickets$/);
    await expect(page.getByRole("heading", { name: "My Tickets" })).toBeVisible();
    await expect(page.locator(".zen-user-badge__trigger")).toContainText(fixtureUser.name);
    await page.screenshot({
      path: shot(PART5_DIR, "07-change-password-success-continuation.png"),
      fullPage: true,
    });
  });
});

// ---------------------------------------------------------------------------
// Part 6 — IT Staff Ticket Queue (EV-02)
// ---------------------------------------------------------------------------

const QUEUE_TABLE_ROWS = "table.zen-staff-queue__table tbody tr";

test.describe("Part 6 — IT Staff Ticket Queue (EV-02)", () => {
  test.beforeAll(async () => {
    // Same fixture staff-ticket-flow.spec.ts's E2E-05 uses: 8 seed.ts
    // tickets + 5 extra ones = 13, enough to exercise a real second page at
    // the smallest page size (10).
    await createPaginationFixtureTickets();
  });

  test("realistic queue data on desktop, with assigned vs. unassigned owners and status/priority badges", async ({
    page,
  }) => {
    await page.setViewportSize(DESKTOP);
    await loginAsSeededUser(page, IT_STAFF_EMAIL);
    await page.goto("/staff/tickets");
    await expect(page.getByRole("heading", { name: "Ticket Queue" })).toBeVisible();

    const rows = page.locator(QUEUE_TABLE_ROWS);
    await expect(rows).toHaveCount(13);

    // AC-32: unassigned vs. assigned owner token, without relying on colour.
    const unassignedRow = rows.filter({ hasText: "TKT-2026-900001" });
    await expect(unassignedRow.locator('[data-owner="unassigned"]')).toContainText(
      "Unassigned",
    );
    const assignedRow = rows.filter({ hasText: "TKT-2026-900003" });
    await expect(assignedRow.locator('[data-owner="assigned"]')).toContainText(
      "Priya Natarajan",
    );
    // Every row carries a Status badge and an IT Priority badge
    // (`.zen-badge`, StatusBadge.tsx / PriorityBadge.tsx). OwnerCell.tsx
    // adds a THIRD `.zen-badge` only for the "Unassigned" token — an
    // assigned owner renders as plain text instead (ui-spec.md §3.4), which
    // is itself part of the assigned/unassigned visual distinction.
    await expect(unassignedRow.locator(".zen-badge")).toHaveCount(3);
    await expect(assignedRow.locator(".zen-badge")).toHaveCount(2);

    await page.screenshot({
      path: shot(PART6_DIR, "01-realistic-queue-assigned-unassigned-badges.png"),
      fullPage: true,
    });
  });

  test("search applied narrows to a matching ticket", async ({ page }) => {
    await page.setViewportSize(DESKTOP);
    await loginAsSeededUser(page, IT_STAFF_EMAIL);
    await page.goto("/staff/tickets");
    await expect(page.locator(QUEUE_TABLE_ROWS)).toHaveCount(13);

    await page.locator("#staff-queue-search").fill("Wi-Fi drops");
    const rows = page.locator(QUEUE_TABLE_ROWS);
    await expect(rows).toHaveCount(1);
    await expect(rows.first()).toContainText("TKT-2026-900002");
    await page.screenshot({
      path: shot(PART6_DIR, "02-search-applied.png"),
      fullPage: true,
    });
  });

  test("filters applied narrows to matching rows", async ({ page }) => {
    await page.setViewportSize(DESKTOP);
    await loginAsSeededUser(page, IT_STAFF_EMAIL);
    await page.goto("/staff/tickets");
    await page.locator("#my-tickets-page-size").selectOption("10");
    const rows = page.locator(QUEUE_TABLE_ROWS);
    await expect(rows).toHaveCount(10);

    // Status = New: the one seeded NEW ticket (900001) plus the 5 fixture
    // tickets (also NEW) = 6.
    await page.locator("#staff-queue-status").selectOption("NEW");
    await expect(rows).toHaveCount(6);
    await expect(rows.filter({ hasText: "TKT-2026-900001" })).toHaveCount(1);
    await expect(rows.filter({ hasText: "TKT-2026-900002" })).toHaveCount(0);
    await page.screenshot({
      path: shot(PART6_DIR, "03-filters-applied.png"),
      fullPage: true,
    });
  });

  test("sorting applied changes the row ordering", async ({ page }) => {
    await page.setViewportSize(DESKTOP);
    await loginAsSeededUser(page, IT_STAFF_EMAIL);
    await page.goto("/staff/tickets");
    await expect(page.locator(QUEUE_TABLE_ROWS)).toHaveCount(13);

    await page.locator("#staff-queue-sort").selectOption("ticketNumber-asc");
    await expect(page.locator(QUEUE_TABLE_ROWS).first()).toContainText("TKT-2026-900001");
    await page.screenshot({
      path: shot(PART6_DIR, "04-sorting-applied.png"),
      fullPage: true,
    });
  });

  test("pagination page 2 shows the range indicator", async ({ page }) => {
    await page.setViewportSize(DESKTOP);
    await loginAsSeededUser(page, IT_STAFF_EMAIL);
    await page.goto("/staff/tickets");
    await page.locator("#my-tickets-page-size").selectOption("10");
    const rows = page.locator(QUEUE_TABLE_ROWS);
    await expect(rows).toHaveCount(10);
    await expect(page.locator(".zen-pagination__summary")).toHaveText("Showing 1–10 of 13");

    await page.getByRole("button", { name: "Next ›" }).click();
    await expect(rows).toHaveCount(3);
    await expect(page.locator(".zen-pagination__summary")).toHaveText("Showing 11–13 of 13");
    await page.screenshot({
      path: shot(PART6_DIR, "05-pagination-page2.png"),
      fullPage: true,
    });
  });

  test("opening a ticket from the queue lands on its own ticket detail", async ({ page }) => {
    await page.setViewportSize(DESKTOP);
    await loginAsSeededUser(page, IT_STAFF_EMAIL);
    await page.goto("/staff/tickets");
    await page.locator("#staff-queue-search").fill("TKT-2026-900001");
    const rows = page.locator(QUEUE_TABLE_ROWS);
    await expect(rows).toHaveCount(1);

    await rows.first().getByRole("link", { name: "TKT-2026-900001", exact: true }).click();
    await expect(page).toHaveURL(/\/staff\/tickets\/\d+$/);
    await expect(page.getByRole("heading", { name: "Ticket Details" })).toBeVisible();
    await expect(page.getByText("TKT-2026-900001")).toBeVisible();
    await page.screenshot({
      path: shot(PART6_DIR, "06-open-detail-result.png"),
      fullPage: true,
    });
  });

  test("no-results state: an active search matching nothing", async ({ page }) => {
    await page.setViewportSize(DESKTOP);
    await loginAsSeededUser(page, IT_STAFF_EMAIL);
    await page.goto("/staff/tickets");
    await expect(page.locator(QUEUE_TABLE_ROWS)).toHaveCount(13);

    await page.locator("#staff-queue-search").fill("zzz-no-such-ticket-zzz");
    await expect(page.getByText("No tickets match these filters")).toBeVisible();
    await expect(
      page.locator(".zen-no-results").getByRole("button", { name: "Clear filters" }),
    ).toBeVisible();
    await page.screenshot({
      path: shot(PART6_DIR, "07-no-results-state.png"),
      fullPage: true,
    });
  });

  test("API failure state shows the error banner and a Retry action", async ({ page }) => {
    await page.route("**/api/staff/tickets*", async (route) => {
      if (route.request().method() !== "GET") {
        await route.continue();
        return;
      }
      await route.fulfill({
        status: 500,
        contentType: "application/json",
        body: JSON.stringify({ error: "INTERNAL", message: "Simulated backend failure" }),
      });
    });

    await loginAsSeededUser(page, IT_STAFF_EMAIL);
    await page.goto("/staff/tickets");

    await expect(
      page.getByRole("alert").filter({
        hasText: "Could not load the ticket queue. Please check your connection and try again.",
      }),
    ).toBeVisible();
    await expect(page.getByRole("button", { name: "Retry" })).toBeVisible();
    await expect(page.locator(QUEUE_TABLE_ROWS)).toHaveCount(0);
    await page.screenshot({
      path: shot(PART6_DIR, "08-api-failure-state.png"),
      fullPage: true,
    });
  });

  test("mobile card layout stacks Ticket Number/Status, Summary, and a meta row", async ({
    page,
  }) => {
    await page.setViewportSize(MOBILE);
    await loginAsSeededUser(page, IT_STAFF_EMAIL);
    await page.goto("/staff/tickets");

    await expect(page.locator("table")).toHaveCount(0);
    await expect(page.locator(".zen-staff-queue__card").first()).toBeVisible();
    await page.screenshot({
      path: shot(PART6_DIR, "09-mobile-card-layout.png"),
      fullPage: true,
    });
  });
});

// ---------------------------------------------------------------------------
// Part 7 — IT Staff Ticket Detail (EV-03)
// ---------------------------------------------------------------------------

test.describe("Part 7 — IT Staff Ticket Detail (EV-03)", () => {
  test("claim, reassign, IT Priority change, comments/notes, attachment continuity, validation and safe failure, then a permitted status change with a confirmation dialog", async ({
    page,
  }) => {
    const ticket = await createRequesterOwnedFixtureTicket(
      "ev-staff-ops",
      "TKT-2026-992001",
    );
    const attachment = await seedPreExistingAttachment(ticket.id, "ev-staff-ops");

    await page.setViewportSize(DESKTOP);
    await loginAsSeededUser(page, IT_STAFF_EMAIL);
    await page.goto(`/staff/tickets/${ticket.id}`);
    await expect(page.getByRole("heading", { name: "Ticket Details" })).toBeVisible();
    await expect(page.getByText(ticket.ticketNumber)).toBeVisible();

    const ownerSelect = page.locator("#staff-ticket-owner");
    const ownerControl = page.locator(".zen-staff-detail__owner-control");
    const priorityControl = page.locator(".zen-staff-detail__it-priority-control");
    const statusControl = page.locator(".zen-staff-detail__status-control");
    const statusSelect = page.locator("#staff-ticket-status");

    // --- claim -------------------------------------------------------------
    await expect(ownerSelect).toHaveValue("unassigned");
    await page.getByRole("button", { name: "Claim" }).click();
    await expect(ownerControl.getByText("Saved")).toBeVisible();
    await expect
      .poll(() =>
        ownerSelect.evaluate((el) => (el as HTMLSelectElement).selectedOptions[0]?.textContent),
      )
      .toBe("Priya Natarajan");
    await page.screenshot({ path: shot(PART7_DIR, "01-claim.png"), fullPage: true });

    // --- reassign ------------------------------------------------------------
    await ownerSelect.selectOption({ label: SECOND_STAFF_NAME });
    await expect(ownerControl.getByText("Saved")).toBeVisible();
    await expect
      .poll(() =>
        ownerSelect.evaluate((el) => (el as HTMLSelectElement).selectedOptions[0]?.textContent),
      )
      .toBe(SECOND_STAFF_NAME);
    await page.screenshot({ path: shot(PART7_DIR, "02-reassign.png"), fullPage: true });

    // --- IT Priority change --------------------------------------------------
    await page.getByRole("radio", { name: "High" }).click();
    await expect(priorityControl.getByText("Saved")).toBeVisible();
    await expect(page.getByRole("radio", { name: "High" })).toHaveAttribute(
      "aria-checked",
      "true",
    );
    await page.screenshot({
      path: shot(PART7_DIR, "03-it-priority-change.png"),
      fullPage: true,
    });

    // --- attachment list continuity (pre-existing, never touched above) -----
    const attachmentRow = page.locator(".zen-attachment-list__item", {
      hasText: attachment.originalFilename,
    });
    await expect(attachmentRow).toBeVisible();
    await expect(attachmentRow.getByRole("button", { name: "Download" })).toBeVisible();
    await page.screenshot({
      path: shot(PART7_DIR, "04-attachment-list-continuity.png"),
      fullPage: true,
    });

    // --- Public Comment posted ------------------------------------------------
    const publicThread = page.locator(".thread--public");
    const internalThread = page.locator(".thread--internal");
    const PUBLIC_BODY = "Submission evidence: looked into this and will follow up shortly.";
    await page.locator("#message-thread-public-body").fill(PUBLIC_BODY);
    await publicThread.getByRole("button", { name: "Post comment" }).click();
    await expect(publicThread.getByText(PUBLIC_BODY)).toBeVisible();
    await page.screenshot({
      path: shot(PART7_DIR, "05-public-comment-posted.png"),
      fullPage: true,
    });

    // --- Internal Note posted, visually distinct ------------------------------
    const INTERNAL_BODY =
      "Internal only: escalated to the network team for this submission-evidence capture.";
    await page.locator("#message-thread-internal-body").fill(INTERNAL_BODY);
    await internalThread.getByRole("button", { name: "Save internal note" }).click();
    await expect(internalThread.getByText(INTERNAL_BODY)).toBeVisible();
    // ui-spec.md §8: a 🔒 glyph before the author, on a `--zen-private-bg`
    // card with the "Private — not visible to the Requester" badge — the
    // visual distinction from a Public Comment entry.
    await expect(
      internalThread.locator(".zen-message-thread__entry", { hasText: INTERNAL_BODY }),
    ).toContainText("🔒");
    await expect(
      internalThread.getByText("Private — not visible to the Requester"),
    ).toBeVisible();
    await page.screenshot({
      path: shot(PART7_DIR, "06-internal-note-posted.png"),
      fullPage: true,
    });

    // --- validation error: empty (whitespace-only) comment ---------------------
    await page.locator("#message-thread-public-body").fill("   ");
    await publicThread.getByRole("button", { name: "Post comment" }).click();
    await expect(publicThread.getByText("Enter a message before posting.")).toBeVisible();
    await page.screenshot({
      path: shot(PART7_DIR, "07-validation-error-empty-comment.png"),
      fullPage: true,
    });
    await page.locator("#message-thread-public-body").fill("");

    // --- safe failure: a routed 500 on posting -----------------------------
    await page.route("**/api/tickets/*/comments", async (route) => {
      if (route.request().method() !== "POST") {
        await route.continue();
        return;
      }
      await route.fulfill({
        status: 500,
        contentType: "application/json",
        body: JSON.stringify({ error: "INTERNAL", message: "Simulated backend failure" }),
      });
    });
    await page.locator("#message-thread-public-body").fill("This attempt should fail safely.");
    await publicThread.getByRole("button", { name: "Post comment" }).click();
    await expect(publicThread.getByRole("alert")).toContainText(
      "Could not post your message. Please check your connection and try again.",
    );
    await page.screenshot({
      path: shot(PART7_DIR, "08-safe-failure-routed-500.png"),
      fullPage: true,
    });
    await page.unroute("**/api/tickets/*/comments");
    await page.locator("#message-thread-public-body").fill("");

    // --- permitted status change (OPEN -> RESOLVED, no confirmation needed) --
    await expect(statusSelect).toHaveValue("OPEN");
    await statusSelect.selectOption("RESOLVED");
    await expect(statusControl.getByText("Saved")).toBeVisible();
    await expect(statusSelect).toHaveValue("RESOLVED");

    // --- permitted status change WITH a confirmation dialog (RESOLVED -> CLOSED)
    await statusSelect.selectOption("CLOSED");
    const dialog = page.getByRole("dialog", { name: "Close this ticket?" });
    await expect(dialog).toBeVisible();
    await page.screenshot({
      path: shot(PART7_DIR, "09-status-change-confirmation-dialog.png"),
      fullPage: true,
    });
    await dialog.getByRole("button", { name: "Close ticket" }).click();
    await expect(page.getByRole("dialog")).toHaveCount(0);
    await expect(statusSelect).toHaveValue("CLOSED");
    await page.screenshot({
      path: shot(PART7_DIR, "10-status-change-result.png"),
      fullPage: true,
    });
  });

  test("the Requester's 'Problem appears resolved' report is visible on IT Staff Ticket Detail", async ({
    page,
    browser,
  }) => {
    const ticket = await createRequesterOwnedFixtureTicket(
      "ev-resolved-indication",
      "TKT-2026-992002",
    );

    await page.setViewportSize(DESKTOP);
    await loginAs(page, ticket.requester.email, LOCAL_DEV_PASSWORD);
    await page.goto(`/tickets/${ticket.id}`);
    await expect(page.getByRole("heading", { name: "Ticket Details" })).toBeVisible();

    const resolveButton = page.getByRole("button", { name: "Problem appears resolved" });
    await expect(resolveButton).toBeVisible();
    await resolveButton.click();
    await expect(page.getByRole("dialog")).toContainText(
      "Let IT Staff know this looks resolved? They'll confirm before the ticket is closed.",
    );
    await page.getByRole("button", { name: "Yes, let IT Staff know" }).click();
    await expect(page.getByText(/You reported this looks resolved on/)).toBeVisible();

    const staffContext = await browser.newContext();
    try {
      const staffPage = await staffContext.newPage();
      await staffPage.setViewportSize(DESKTOP);
      await loginAsSeededUser(staffPage, IT_STAFF_EMAIL);
      await staffPage.goto(`/staff/tickets/${ticket.id}`);
      await expect(staffPage.getByRole("heading", { name: "Ticket Details" })).toBeVisible();
      await expect(
        staffPage.getByText(/The requester reported this looks resolved on/),
      ).toBeVisible();
      // BR-26: the resolution indication never changes the real status.
      await expect(staffPage.locator("#staff-ticket-status")).toHaveValue("OPEN");
      await staffPage.screenshot({
        path: shot(PART7_DIR, "11-requester-resolved-indication-seen-by-staff.png"),
        fullPage: true,
      });
    } finally {
      await staffContext.close();
    }
  });

  test("role restriction: a Requester viewing their own ticket has no Internal Notes panel and no staff controls", async ({
    page,
    browser,
  }) => {
    const ticket = await createRequesterOwnedFixtureTicket(
      "ev-role-restriction",
      "TKT-2026-992003",
    );

    // IT Staff post a real Internal Note first, in an independent session —
    // proves the Requester genuinely cannot see an EXISTING note, not just
    // that none was ever posted.
    const staffContext = await browser.newContext();
    const INTERNAL_BODY =
      "Role-restriction evidence: this note must stay invisible to the Requester.";
    try {
      const staffPage = await staffContext.newPage();
      await loginAsSeededUser(staffPage, IT_STAFF_EMAIL);
      await staffPage.goto(`/staff/tickets/${ticket.id}`);
      await expect(staffPage.getByRole("heading", { name: "Ticket Details" })).toBeVisible();
      await staffPage.locator("#message-thread-internal-body").fill(INTERNAL_BODY);
      await staffPage
        .locator(".thread--internal")
        .getByRole("button", { name: "Save internal note" })
        .click();
      await expect(staffPage.locator(".thread--internal").getByText(INTERNAL_BODY)).toBeVisible();
    } finally {
      await staffContext.close();
    }

    await page.setViewportSize(DESKTOP);
    await loginAs(page, ticket.requester.email, LOCAL_DEV_PASSWORD);
    await page.goto(`/tickets/${ticket.id}`);
    await expect(page.getByRole("heading", { name: "Ticket Details" })).toBeVisible();

    // No Internal Notes surface at all — absence, not visual hiding.
    await expect(page.getByRole("heading", { name: "Internal notes" })).toHaveCount(0);
    await expect(page.locator(".thread--internal")).toHaveCount(0);
    await expect(page.locator("#message-thread-internal-body")).toHaveCount(0);
    await expect(page.getByText(INTERNAL_BODY)).toHaveCount(0);
    await expect(
      page.getByText("Private — not visible to the Requester"),
    ).toHaveCount(0);

    // No staff-only operational controls either.
    await expect(page.locator("#staff-ticket-owner")).toHaveCount(0);
    await expect(page.locator("#staff-ticket-status")).toHaveCount(0);
    await expect(page.getByRole("radio", { name: "High" })).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Claim" })).toHaveCount(0);

    // The Public Comments thread and the Requester's own controls ARE there.
    await expect(page.getByRole("heading", { name: "Comments" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Problem appears resolved" })).toBeVisible();

    await page.screenshot({
      path: shot(PART7_DIR, "12-role-restriction-requester-view.png"),
      fullPage: true,
    });
  });

  test("direct API authorization evidence: a staff notes endpoint called as a Requester and unauthenticated", async ({
    browser,
  }) => {
    const ticket = await createRequesterOwnedFixtureTicket(
      "ev-api-authz",
      "TKT-2026-992004",
    );

    // api-spec.md §1.4: no session on a protected route -> 401 UNAUTHENTICATED.
    const anonContext = await playwrightRequest.newContext({ baseURL: SERVER_URL });
    const anonResponse = await anonContext.get(`/api/tickets/${ticket.id}/notes`);
    const anonStatus = anonResponse.status();
    const anonBody: unknown = await anonResponse.json();
    await anonContext.dispose();
    expect(anonStatus).toBe(401);
    expect((anonBody as { error?: string }).error).toBe("UNAUTHENTICATED");

    // api-spec.md §5.4: a Requester has no read path to notes AT ALL — even
    // on a ticket they own — so this is a byte-identical 404, never a 403,
    // per the §1.4 "record-addressed, no read path" rule.
    const loginContext = await browser.newContext();
    const loginPage = await loginContext.newPage();
    await loginAs(loginPage, ticket.requester.email, LOCAL_DEV_PASSWORD);
    const storageState = await loginContext.storageState();
    await loginContext.close();

    const requesterApi = await playwrightRequest.newContext({
      baseURL: SERVER_URL,
      storageState,
    });
    const requesterResponse = await requesterApi.get(`/api/tickets/${ticket.id}/notes`);
    const requesterStatus = requesterResponse.status();
    const requesterBody: unknown = await requesterResponse.json();
    await requesterApi.dispose();
    expect(requesterStatus).toBe(404);
    expect((requesterBody as { error?: string }).error).toBe("NOT_FOUND");

    const evidence = {
      endpoint: `GET /api/tickets/${ticket.id}/notes`,
      unauthenticated: { status: anonStatus, body: anonBody },
      requester: { status: requesterStatus, body: requesterBody },
    };
    fs.writeFileSync(
      path.join(PART7_DIR, "api-authz-evidence.json"),
      JSON.stringify(evidence, null, 2),
    );
  });
});

// ---------------------------------------------------------------------------
// Part 8 — Administrator User Management (EV-04)
// ---------------------------------------------------------------------------

const USER_TABLE_ROWS = "table.zen-user-mgmt__table tbody tr";

test.describe("Part 8 — User Management (EV-04)", () => {
  test("list, search by name, search by email, and a role filter", async ({ page }) => {
    await page.setViewportSize(DESKTOP);
    await loginAsSeededUser(page, ADMIN_EMAIL);
    await page.goto("/admin/users");
    await expect(page.getByRole("heading", { name: "User Management" })).toBeVisible();

    // list: Name/Email/Role/Status columns, plus a per-row Edit action.
    const headerTexts = await page
      .locator("table.zen-user-mgmt__table thead th")
      .allTextContents();
    for (const expected of ["Name", "Email", "Role", "Status"]) {
      expect(headerTexts.map((t) => t.trim())).toContain(expected);
    }
    const rows = page.locator(USER_TABLE_ROWS);
    await expect(rows.first()).toBeVisible();
    await expect(rows.first().getByRole("button", { name: /^Edit / })).toBeVisible();
    await page.screenshot({
      path: shot(PART8_DIR, "01-list-name-email-role-status-edit.png"),
      fullPage: true,
    });

    // search by name
    await page.locator("#user-mgmt-search").fill("Priya");
    await expect(rows).toHaveCount(1);
    await expect(rows.first()).toContainText("priya.natarajan@example.edu");
    await page.screenshot({
      path: shot(PART8_DIR, "02-search-by-name.png"),
      fullPage: true,
    });

    // search by email
    await page.locator("#user-mgmt-search").fill("olivia.grant@example.edu");
    await expect(rows).toHaveCount(1);
    await expect(rows.first()).toContainText("Olivia Grant");
    await page.screenshot({
      path: shot(PART8_DIR, "03-search-by-email.png"),
      fullPage: true,
    });
    await page.locator("#user-mgmt-search").fill("");

    // role filter
    await page.locator("#user-mgmt-role").selectOption("ADMINISTRATOR");
    await expect(rows).toHaveCount(2);
    await expect(rows.filter({ hasText: "olivia.grant@example.edu" })).toHaveCount(1);
    await expect(rows.filter({ hasText: "noah.kim@example.edu" })).toHaveCount(1);
    await page.screenshot({
      path: shot(PART8_DIR, "04-role-filter-applied.png"),
      fullPage: true,
    });
  });

  test("mobile layout shows cards instead of a table", async ({ page }) => {
    await page.setViewportSize(MOBILE);
    await loginAsSeededUser(page, ADMIN_EMAIL);
    await page.goto("/admin/users");
    await expect(page.getByRole("heading", { name: "User Management" })).toBeVisible();

    await expect(page.locator("table")).toHaveCount(0);
    await expect(page.locator(".zen-user-mgmt__card").first()).toBeVisible();
    await page.screenshot({
      path: shot(PART8_DIR, "05-mobile-layout.png"),
      fullPage: true,
    });
  });

  test("create user dialog and success, then a duplicate-email rejection and invalid-input validation", async ({
    page,
  }) => {
    const NEW_USER_NAME = "Ev Submission User";
    const NEW_USER_EMAIL = "ev-submission-new-user@toktickit.local";
    const NEW_USER_PASSWORD = "Ev-Submission-Create-Password-1!";
    await resetUserAdministrationFixtures([NEW_USER_EMAIL]);

    await page.setViewportSize(DESKTOP);
    await loginAsSeededUser(page, ADMIN_EMAIL);
    await page.goto("/admin/users");

    // --- create user dialog --------------------------------------------------
    await page.getByRole("button", { name: "New user" }).click();
    const createDialog = page.getByRole("dialog");
    await expect(createDialog.getByRole("heading", { name: "New user" })).toBeVisible();
    await createDialog.locator("#user-dialog-name").fill(NEW_USER_NAME);
    await createDialog.locator("#user-dialog-email").fill(NEW_USER_EMAIL);
    await createDialog.locator("#user-dialog-role").selectOption("IT_STAFF");
    await createDialog.locator("#user-dialog-password").fill(NEW_USER_PASSWORD);
    await page.screenshot({
      path: shot(PART8_DIR, "06-create-user-dialog.png"),
      fullPage: true,
    });

    // --- success ---------------------------------------------------------------
    await createDialog.getByRole("button", { name: "Save" }).click();
    await expect(page.getByRole("dialog")).toHaveCount(0);
    const rows = page.locator(USER_TABLE_ROWS);
    const newUserRow = rows.filter({ hasText: NEW_USER_EMAIL });
    await expect(newUserRow).toHaveCount(1);
    await expect(newUserRow).toContainText(NEW_USER_NAME);
    await expect(newUserRow).toContainText("IT Staff");
    await expect(newUserRow).toContainText("Active");
    await page.screenshot({
      path: shot(PART8_DIR, "07-create-user-success.png"),
      fullPage: true,
    });

    // --- duplicate-email rejection -----------------------------------------
    await page.getByRole("button", { name: "New user" }).click();
    const duplicateDialog = page.getByRole("dialog");
    await expect(duplicateDialog.getByRole("heading", { name: "New user" })).toBeVisible();
    await duplicateDialog.locator("#user-dialog-name").fill("Duplicate Attempt");
    await duplicateDialog.locator("#user-dialog-email").fill(NEW_USER_EMAIL);
    await duplicateDialog.locator("#user-dialog-role").selectOption("REQUESTER");
    await duplicateDialog.locator("#user-dialog-password").fill("Ev-Duplicate-Attempt-1!");
    await duplicateDialog.getByRole("button", { name: "Save" }).click();
    await expect(duplicateDialog.locator("#user-dialog-email-error")).toContainText(
      "That email address is already in use.",
    );
    await expect(page.getByRole("dialog")).toHaveCount(1);
    await page.screenshot({
      path: shot(PART8_DIR, "08-duplicate-email-error.png"),
      fullPage: true,
    });
    await duplicateDialog.getByRole("button", { name: "Cancel" }).click();
    await expect(page.getByRole("dialog")).toHaveCount(0);

    // --- invalid-input validation --------------------------------------------
    await page.getByRole("button", { name: "New user" }).click();
    const invalidDialog = page.getByRole("dialog");
    await expect(invalidDialog.getByRole("heading", { name: "New user" })).toBeVisible();
    // Name left empty, a malformed email, and a too-short initial password —
    // the server accumulates and returns all three field errors together.
    await invalidDialog.locator("#user-dialog-email").fill("not-an-email");
    await invalidDialog.locator("#user-dialog-password").fill("abc");
    await invalidDialog.getByRole("button", { name: "Save" }).click();
    await expect(invalidDialog.locator("#user-dialog-name-error")).toContainText(
      "name is required.",
    );
    await expect(invalidDialog.locator("#user-dialog-email-error")).toContainText(
      "Enter a valid email address.",
    );
    await expect(invalidDialog.locator("#user-dialog-password-error")).toContainText(
      "initialPassword must be between 8 and 128 characters.",
    );
    await page.screenshot({
      path: shot(PART8_DIR, "09-invalid-input-validation.png"),
      fullPage: true,
    });
    await invalidDialog.getByRole("button", { name: "Cancel" }).click();
    await expect(page.getByRole("dialog")).toHaveCount(0);
  });

  test("edit name/email/role/active, set a new initial password, and that user's next login is forced to change it", async ({
    page,
    browser,
  }) => {
    const ORIGINAL_NAME = "Ev Edit Subject";
    const ORIGINAL_EMAIL = "ev-submission-edit-subject@toktickit.local";
    const ORIGINAL_PASSWORD = "Ev-Submission-Edit-Initial-1!";
    const EDITED_NAME = "Ev Edit Subject Updated";
    const EDITED_EMAIL = "ev-submission-edit-subject-updated@toktickit.local";
    const RESET_PASSWORD = "Ev-Submission-Edit-Reset-Password-2!";
    await resetUserAdministrationFixtures([ORIGINAL_EMAIL, EDITED_EMAIL]);

    await page.setViewportSize(DESKTOP);
    await loginAsSeededUser(page, ADMIN_EMAIL);
    await page.goto("/admin/users");

    // Create the fixture through the real dialog first, same convention as
    // e2e/lab-03/user-administration.spec.ts's E2E-09/E2E-10.
    await page.getByRole("button", { name: "New user" }).click();
    const createDialog = page.getByRole("dialog");
    await createDialog.locator("#user-dialog-name").fill(ORIGINAL_NAME);
    await createDialog.locator("#user-dialog-email").fill(ORIGINAL_EMAIL);
    await createDialog.locator("#user-dialog-role").selectOption("REQUESTER");
    await createDialog.locator("#user-dialog-password").fill(ORIGINAL_PASSWORD);
    await createDialog.getByRole("button", { name: "Save" }).click();
    await expect(page.getByRole("dialog")).toHaveCount(0);

    const rows = page.locator(USER_TABLE_ROWS);
    const originalRow = rows.filter({ hasText: ORIGINAL_EMAIL });
    await expect(originalRow).toHaveCount(1);

    // --- edit name/email/role/active ------------------------------------------
    await originalRow.getByRole("button", { name: `Edit ${ORIGINAL_NAME}` }).click();
    const editDialog = page.getByRole("dialog");
    await expect(editDialog.getByRole("heading", { name: "Edit user" })).toBeVisible();
    await editDialog.locator("#user-dialog-name").fill(EDITED_NAME);
    await editDialog.locator("#user-dialog-email").fill(EDITED_EMAIL);
    await editDialog.locator("#user-dialog-role").selectOption("IT_STAFF");
    await editDialog.locator("#user-dialog-active").uncheck();
    await editDialog.getByRole("button", { name: "Save" }).click();
    await expect(page.getByRole("dialog")).toHaveCount(0);

    const editedRow = rows.filter({ hasText: EDITED_EMAIL });
    await expect(editedRow).toHaveCount(1);
    await expect(editedRow).toContainText(EDITED_NAME);
    await expect(editedRow).toContainText("IT Staff");
    await expect(editedRow).toContainText("Inactive");
    await page.screenshot({
      path: shot(PART8_DIR, "10-edit-name-email-role-active.png"),
      fullPage: true,
    });

    // Re-activate before the password-reset/forced-login round trip below —
    // an inactive account can never log in at all (BR-08), which would
    // otherwise make that step indistinguishable from a plain rejected
    // login rather than genuine evidence of the forced-change flag.
    await editedRow.getByRole("button", { name: `Edit ${EDITED_NAME}` }).click();
    const reactivateDialog = page.getByRole("dialog");
    await expect(reactivateDialog.getByRole("heading", { name: "Edit user" })).toBeVisible();
    await reactivateDialog.locator("#user-dialog-active").check();
    await reactivateDialog.getByRole("button", { name: "Save" }).click();
    await expect(page.getByRole("dialog")).toHaveCount(0);
    await expect(editedRow).toContainText("Active");

    // --- set a new initial password --------------------------------------------
    await editedRow.getByRole("button", { name: `Edit ${EDITED_NAME}` }).click();
    const resetDialog = page.getByRole("dialog");
    await expect(resetDialog.getByRole("heading", { name: "Edit user" })).toBeVisible();
    await expect(
      resetDialog.getByRole("heading", { name: "Set new initial password" }),
    ).toBeVisible();
    await resetDialog.locator("#user-dialog-reset-password").fill(RESET_PASSWORD);
    await resetDialog.getByRole("button", { name: "Set password" }).click();
    await expect(
      resetDialog.getByRole("status").filter({ hasText: "Password updated." }),
    ).toBeVisible();
    await page.screenshot({
      path: shot(PART8_DIR, "11-set-new-initial-password.png"),
      fullPage: true,
    });
    await resetDialog.getByRole("button", { name: "Cancel" }).click();
    await expect(page.getByRole("dialog")).toHaveCount(0);

    // --- that user's next login is forced to change the password ---------------
    const resetUserContext = await browser.newContext();
    try {
      const resetUserPage = await resetUserContext.newPage();
      await loginAs(resetUserPage, EDITED_EMAIL, RESET_PASSWORD);
      await expect(resetUserPage).toHaveURL(/\/change-password$/);
      await expect(
        resetUserPage
          .getByRole("status")
          .filter({ hasText: "Choose a new password before continuing." }),
      ).toBeVisible();
      await resetUserPage.screenshot({
        path: shot(PART8_DIR, "12-forced-change-password-after-admin-reset.png"),
        fullPage: true,
      });
    } finally {
      await resetUserContext.close();
    }
  });

  test("self-deactivation is blocked, and demoting the last active Administrator is blocked", async ({
    page,
  }) => {
    await page.setViewportSize(DESKTOP);
    await loginAsSeededUser(page, ADMIN_EMAIL);
    await page.goto("/admin/users");
    const rows = page.locator(USER_TABLE_ROWS);

    async function setAdminActive(email: string, name: string, active: boolean): Promise<void> {
      const row = rows.filter({ hasText: email });
      await expect(row).toHaveCount(1);
      await row.getByRole("button", { name: `Edit ${name}` }).click();
      const dialog = page.getByRole("dialog");
      await expect(dialog.getByRole("heading", { name: "Edit user" })).toBeVisible();
      const activeCheckbox = dialog.locator("#user-dialog-active");
      const alreadyCorrect = (await activeCheckbox.isChecked()) === active;
      if (alreadyCorrect) {
        await dialog.getByRole("button", { name: "Cancel" }).click();
      } else {
        if (active) {
          await activeCheckbox.check();
        } else {
          await activeCheckbox.uncheck();
        }
        await dialog.getByRole("button", { name: "Save" }).click();
      }
      await expect(page.getByRole("dialog")).toHaveCount(0);
    }

    // Normalize both seeded Administrators Active first — verified, not assumed.
    await setAdminActive(ADMIN_EMAIL, "Olivia Grant", true);
    await setAdminActive(SECOND_ADMIN_EMAIL, SECOND_ADMIN_NAME, true);

    try {
      // --- self-deactivation blocked ------------------------------------------
      const ownRow = rows.filter({ hasText: ADMIN_EMAIL });
      await ownRow.getByRole("button", { name: "Edit Olivia Grant" }).click();
      const selfDialog = page.getByRole("dialog");
      await expect(selfDialog.getByRole("heading", { name: "Edit user" })).toBeVisible();
      const selfActiveCheckbox = selfDialog.locator("#user-dialog-active");
      await expect(selfActiveCheckbox).toBeChecked();
      await expect(selfActiveCheckbox).toBeDisabled();
      await expect(
        selfDialog.getByText("You can't deactivate your own account."),
      ).toBeVisible();
      await page.screenshot({
        path: shot(PART8_DIR, "13-self-deactivation-blocked.png"),
        fullPage: true,
      });
      await selfDialog.getByRole("button", { name: "Cancel" }).click();
      await expect(page.getByRole("dialog")).toHaveCount(0);

      // --- last-active-Administrator blocked ----------------------------------
      await setAdminActive(SECOND_ADMIN_EMAIL, SECOND_ADMIN_NAME, false);

      await ownRow.getByRole("button", { name: "Edit Olivia Grant" }).click();
      const lastAdminDialog = page.getByRole("dialog");
      await expect(lastAdminDialog.getByRole("heading", { name: "Edit user" })).toBeVisible();
      await lastAdminDialog.locator("#user-dialog-role").selectOption("IT_STAFF");
      await lastAdminDialog.getByRole("button", { name: "Save" }).click();
      await expect(lastAdminDialog.getByRole("alert")).toContainText(
        "This is the last active administrator. Promote another administrator first.",
      );
      await page.screenshot({
        path: shot(PART8_DIR, "14-last-active-administrator-blocked.png"),
        fullPage: true,
      });
      await lastAdminDialog.getByRole("button", { name: "Cancel" }).click();
      await expect(page.getByRole("dialog")).toHaveCount(0);
    } finally {
      // Restore the seed's known-good state regardless of pass/fail, so no
      // later test (or a re-run of this file) inherits only one active
      // Administrator.
      await setAdminActive(SECOND_ADMIN_EMAIL, SECOND_ADMIN_NAME, true);
    }
  });

  test("a non-admin (Requester) navigating directly to /admin/users sees the forbidden state", async ({
    page,
  }) => {
    const requester = await createPlainLoginFixtureUser("ev-non-admin-forbidden");
    await page.setViewportSize(DESKTOP);
    await loginAs(page, requester.email, LOCAL_DEV_PASSWORD);
    await expect(page).toHaveURL(/\/tickets$/);

    await page.goto("/admin/users");
    await expect(
      page.getByRole("heading", { name: "You don't have access to this page" }),
    ).toBeVisible();
    await expect(page.getByRole("heading", { name: "User Management" })).toHaveCount(0);
    await expect(page.locator(USER_TABLE_ROWS)).toHaveCount(0);
    await page.screenshot({
      path: shot(PART8_DIR, "15-non-admin-forbidden.png"),
      fullPage: true,
    });
  });

  test("a safe API failure shows the error banner and a Retry action", async ({ page }) => {
    await page.route("**/api/users*", async (route) => {
      if (route.request().method() !== "GET") {
        await route.continue();
        return;
      }
      await route.fulfill({
        status: 500,
        contentType: "application/json",
        body: JSON.stringify({ error: "INTERNAL", message: "Simulated backend failure" }),
      });
    });

    await loginAsSeededUser(page, ADMIN_EMAIL);
    await page.goto("/admin/users");

    await expect(
      page.getByRole("alert").filter({
        hasText: "Could not load users. Please check your connection and try again.",
      }),
    ).toBeVisible();
    await expect(page.getByRole("button", { name: "Retry" })).toBeVisible();
    await expect(page.locator(USER_TABLE_ROWS)).toHaveCount(0);
    await page.screenshot({
      path: shot(PART8_DIR, "16-safe-api-failure.png"),
      fullPage: true,
    });
  });
});

// ---------------------------------------------------------------------------
// Part 6 addendum — the queue's genuine, zero-tickets-ever empty state
// ---------------------------------------------------------------------------
//
// ui-spec.md §9's "empty (no tickets at all — 'The queue is empty')" state is
// distinct from "no-results" (07-no-results-state.png above, an active
// filter matching nothing while tickets still exist) and cannot be produced
// without removing every Ticket row from the shared `toktickit_e2e`
// database — which would break every OTHER test's fixtures if it ran
// earlier. This is deliberately the LAST test in the whole file (after both
// Part 7's and Part 8's own Ticket/User fixtures are done being used) so
// that destructive step can never affect anything else in this run.
// Attachment/Comment/Note all cascade-delete with their Ticket
// (schema.prisma), so this is a clean, FK-safe removal.

async function truncateAllTicketsForEmptyQueueEvidence(): Promise<void> {
  const e2eRoot = path.resolve(here, "..");
  const result = dotenv.config({ path: path.join(e2eRoot, ".env.e2e") });
  const url = result.parsed?.DATABASE_URL ?? process.env.DATABASE_URL;
  if (!url) {
    throw new Error(
      "e2e/.env.e2e is missing (or has no DATABASE_URL) — cannot demonstrate the " +
        "genuine empty-queue state.",
    );
  }
  if (!url.endsWith("/toktickit_e2e")) {
    // Same guard every other Lab 3 fixture helper carries: never run this
    // against toktickit_test or localdb.
    throw new Error(
      `DATABASE_URL must point at "toktickit_e2e" (got "${url}"). Refusing to ` +
        "truncate Tickets on a database that isn't the dedicated E2E database.",
    );
  }

  const client = new Client({ connectionString: url });
  await client.connect();
  try {
    await client.query('DELETE FROM "Ticket"');
  } finally {
    await client.end();
  }
}

test.describe("Part 6 addendum — Ticket Queue genuinely empty (EV-02)", () => {
  test("the queue with zero tickets ever shows the true empty state, not no-results", async ({
    page,
  }) => {
    await truncateAllTicketsForEmptyQueueEvidence();

    await page.setViewportSize(DESKTOP);
    await loginAsSeededUser(page, IT_STAFF_EMAIL);
    await page.goto("/staff/tickets");

    await expect(page.getByRole("heading", { name: "The queue is empty" })).toBeVisible();
    await expect(page.locator(QUEUE_TABLE_ROWS)).toHaveCount(0);
    // Distinct from the no-results state: the true-empty state hides the
    // whole search/filter controls row entirely (StaffTicketQueueScreen.tsx
    // `hideControls`), same convention as Lab 2 My Tickets.
    await expect(page.locator("#staff-queue-search")).toHaveCount(0);
    await page.screenshot({
      path: shot(PART6_DIR, "10-queue-truly-empty-state.png"),
      fullPage: true,
    });
  });
});
