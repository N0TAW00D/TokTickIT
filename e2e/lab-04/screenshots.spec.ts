import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { expect, test, type Page } from "@playwright/test";
import { loginAsSeededUser } from "../support/auth.js";
import {
  ADMIN_EMAIL,
  IT_STAFF_EMAIL,
  REQUESTER_EMAIL,
  VIEWPORTS,
  ZERO_REQUESTER_EMAIL,
  ZERO_STAFF_EMAIL,
  bumpActionVersion,
  cleanupLab4Fixtures,
  createLab4FixtureTicket,
  ticketIdByNumber,
  type Lab4FixtureTicket,
} from "../support/lab4.js";

// E2E-19 (docs/lab-04/tests.md §2; AC-43): captures every state in
// docs/lab-04/ui-spec.md §11 at desktop (1440x900), tablet (820x1180) and
// mobile (390x844) into artifacts/lab-04/screenshots/<folder>/<state>-<viewport>.png
// against the seeded database. Dashboards are captured first, before any
// fixture Ticket exists, so they show the seeded numbers. Loading and failure
// states are produced by intercepting the dashboard request.

const here = path.dirname(fileURLToPath(import.meta.url));
const SHOT_ROOT = path.resolve(here, "../../artifacts/lab-04/screenshots");

const SHOT_VIEWPORTS = {
  desktop: VIEWPORTS.desktop,
  tablet: VIEWPORTS.tablet,
  mobile: VIEWPORTS.mobile,
} as const;

test.afterAll(cleanupLab4Fixtures);

/** Lets fonts, transitions and the focus ring settle, then writes the full page. */
async function shot(page: Page, folder: string, state: string, viewport: string): Promise<void> {
  await page.evaluate(() => Promise.all(document.getAnimations().map((a) => a.finished.catch(() => undefined))));
  await page.evaluate(() => document.fonts.ready);
  const dir = path.join(SHOT_ROOT, folder);
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, `${state}-${viewport}.png`);
  await page.screenshot({ path: file, fullPage: true, animations: "disabled", caret: "hide" });
  expect(fs.statSync(file).size, `${folder}/${state}-${viewport}.png is a real image`).toBeGreaterThan(5_000);
}

/** Seeded Tickets (server/prisma/seed*.ts) used read-only, so the evidence shows seeded data. */
const SEEDED = {
  /** IT Staff view: Priya owns it; completed, in-progress (follow-up) and cancelled Actions, four history rows. */
  rich: "TKT-2026-900003",
  /** NEW, no Actions. */
  empty: "TKT-2026-900001",
  /** CLOSED with an Action. */
  closed: "TKT-2026-900006",
  /** Jennifer Anderson's resolved Ticket with two completed Actions and history. */
  jennifer: "TKT-2026-900005",
} as const;

async function seededTicket(number: string): Promise<Lab4FixtureTicket> {
  return { id: await ticketIdByNumber(number), ticketNumber: number, requester: { id: 0, email: "", name: "" }, actionIds: [] };
}

async function gotoStaffTicket(page: Page, ticket: Lab4FixtureTicket): Promise<void> {
  await page.goto(`/staff/tickets/${ticket.id}`);
  await expect(page.getByRole("heading", { name: /^Actions Taken \(\d+\)$/ })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Status history" })).toBeVisible();
  await expect(page.locator("ol.zen-status-history li").first().or(page.getByText("No status changes yet."))).toBeVisible();
}

/** Holds every matching GET until released, so the loading state can be captured. */
async function holdUntilReleased(page: Page, pattern: RegExp): Promise<() => void> {
  let release: () => void = () => {};
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  await page.route(pattern, async (route) => {
    if (route.request().method() !== "GET") return route.continue();
    await gate;
    await route.continue().catch(() => undefined);
  });
  return release;
}

async function failWith500(page: Page, pattern: RegExp): Promise<void> {
  await page.route(pattern, async (route) => {
    if (route.request().method() !== "GET") return route.continue();
    await route.fulfill({
      status: 500,
      contentType: "application/json",
      body: JSON.stringify({ error: { code: "INTERNAL_ERROR", message: "Something went wrong." } }),
    });
  });
}

for (const [viewport, size] of Object.entries(SHOT_VIEWPORTS)) {
  test.describe(`E2E-19 screenshots at ${viewport} ${size.width}x${size.height} (AC-43)`, () => {
    test.use({ viewport: size });

    // -- staff-dashboard/ ---------------------------------------------------------------

    test("staff-dashboard: loaded, loaded-zero, administrator-users", async ({ page }) => {
      await cleanupLab4Fixtures(); // the seeded numbers only, whatever an earlier viewport left behind
      await loginAsSeededUser(page, IT_STAFF_EMAIL);
      await expect(page.getByRole("button", { name: "Refresh" })).toBeVisible();
      await expect(page.locator(".zen-metric-card").first()).toBeVisible();
      await shot(page, "staff-dashboard", "loaded", viewport);

      await page.context().clearCookies();
      await loginAsSeededUser(page, ZERO_STAFF_EMAIL);
      await expect(page.getByRole("button", { name: "Refresh" })).toBeVisible();
      await expect(page.getByText("You have no open actions.")).toBeVisible();
      await shot(page, "staff-dashboard", "loaded-zero", viewport);

      await page.context().clearCookies();
      await loginAsSeededUser(page, ADMIN_EMAIL);
      await expect(page.getByRole("button", { name: "Refresh" })).toBeVisible();
      await expect(page.getByRole("heading", { name: "Users" })).toBeVisible();
      await page.getByRole("heading", { name: "Users" }).scrollIntoViewIfNeeded();
      await shot(page, "staff-dashboard", "administrator-users", viewport);
    });

    test("staff-dashboard: loading and failure", async ({ page }) => {
      await cleanupLab4Fixtures(); // the seeded numbers only, whatever an earlier viewport left behind
      const release = await holdUntilReleased(page, /\/api\/dashboard\/staff$/);
      await loginAsSeededUser(page, IT_STAFF_EMAIL);
      await expect(page.getByRole("status", { name: "Loading dashboard" })).toBeVisible();
      await shot(page, "staff-dashboard", "loading", viewport);
      release();
      await page.unroute(/\/api\/dashboard\/staff$/);

      await page.context().clearCookies();
      await failWith500(page, /\/api\/dashboard\/staff$/);
      await loginAsSeededUser(page, IT_STAFF_EMAIL);
      await expect(page.getByRole("alert").filter({ hasText: "We couldn't load the dashboard." })).toBeVisible();
      await shot(page, "staff-dashboard", "failure", viewport);
    });

    // -- requester-dashboard/ -----------------------------------------------------------

    test("requester-dashboard: loaded, loaded-zero, failure", async ({ page }) => {
      await cleanupLab4Fixtures(); // the seeded numbers only, whatever an earlier viewport left behind
      await loginAsSeededUser(page, REQUESTER_EMAIL);
      await expect(page.getByRole("button", { name: "Refresh" })).toBeVisible();
      await expect(page.locator(".zen-metric-card").first()).toBeVisible();
      await shot(page, "requester-dashboard", "loaded", viewport);

      await page.context().clearCookies();
      await loginAsSeededUser(page, ZERO_REQUESTER_EMAIL);
      await expect(page.getByRole("button", { name: "Refresh" })).toBeVisible();
      await expect(page.getByText("You have no open tickets.")).toBeVisible();
      await shot(page, "requester-dashboard", "loaded-zero", viewport);

      await page.context().clearCookies();
      await failWith500(page, /\/api\/dashboard\/requester$/);
      await loginAsSeededUser(page, REQUESTER_EMAIL);
      await expect(page.getByRole("alert").filter({ hasText: "We couldn't load the dashboard." })).toBeVisible();
      await shot(page, "requester-dashboard", "failure", viewport);
    });

    // -- actions-taken/ -----------------------------------------------------------------

    test("actions-taken: list, view, edit, validation, create-form", async ({ page }) => {
      const ticket = await seededTicket(SEEDED.rich);
      await loginAsSeededUser(page, IT_STAFF_EMAIL);
      await gotoStaffTicket(page, ticket);
      await shot(page, "actions-taken", "list", viewport);

      await page.getByRole("button", { name: /^View action from/ }).first().click();
      await expect(page.getByText("Logged at")).toBeVisible();
      await shot(page, "actions-taken", "view", viewport);
      await page.getByRole("button", { name: /^View action from/ }).first().click();

      await page.getByRole("button", { name: /^Edit action from/ }).first().click();
      const edit = page.getByRole("form", { name: "Edit action" });
      await expect(edit).toBeVisible();
      await shot(page, "actions-taken", "edit", viewport);
      await edit.getByRole("button", { name: "Cancel", exact: true }).click();

      await page.getByRole("button", { name: "Add action" }).click();
      const add = page.getByRole("form", { name: "Add action" });
      await expect(add).toBeVisible();
      await shot(page, "actions-taken", "create-form", viewport);

      await add.getByLabel("Status").selectOption("COMPLETED");
      await add.getByLabel("Follow-up required?").check();
      await add.getByLabel("Attachment notes").fill("the printed error report");
      await add.getByRole("button", { name: "Save action" }).click();
      await expect(add.getByRole("alert").filter({ hasText: "Enter a description." })).toBeVisible();
      await expect(add.getByRole("alert").filter({ hasText: "Enter the result to complete this action." })).toBeVisible();
      await shot(page, "actions-taken", "validation", viewport);
    });

    test("actions-taken: empty, stale-conflict, closed-readonly, requester-readonly", async ({ page, browser }) => {
      await loginAsSeededUser(page, IT_STAFF_EMAIL);

      const empty = await seededTicket(SEEDED.empty);
      await gotoStaffTicket(page, empty);
      await expect(page.getByText("No actions recorded yet.")).toBeVisible();
      await shot(page, "actions-taken", "empty", viewport);

      const stale = await createLab4FixtureTicket("l4-shot-703", "TKT-2026-997703", {
        summary: "Projector in room B12 shows a green tint",
        requesterName: "Ana Ruiz",
        description: "The projector in room B12 turns everything green a few minutes after it warms up.",
        actions: [{ description: "Swap the HDMI cable and test the projector.", status: "PLANNED", hoursAgo: 5 }],
        history: [{ from: "NEW", to: "OPEN", hoursAgo: 50 }],
      });
      await gotoStaffTicket(page, stale);
      await page.getByRole("button", { name: /^Edit action from/ }).click();
      const form = page.getByRole("form", { name: "Edit action" });
      await form.getByLabel("Description").fill("Swap the HDMI cable, then test the projector in both modes.");
      await bumpActionVersion(stale.actionIds[0]);
      await form.getByRole("button", { name: "Save action" }).click();
      await expect(form.getByRole("alert").filter({ hasText: "This action was changed by" })).toBeVisible();
      await expect(form.getByRole("complementary", { name: "Latest version" })).toBeVisible();
      await shot(page, "actions-taken", "stale-conflict", viewport);

      const closed = await seededTicket(SEEDED.closed);
      await gotoStaffTicket(page, closed);
      await expect(page.getByText("This ticket is closed. Actions Taken are read-only.")).toBeVisible();
      await shot(page, "actions-taken", "closed-readonly", viewport);

      const shared = await seededTicket(SEEDED.jennifer);
      const requesterPage = await (await browser.newContext({ viewport: size })).newPage();
      await loginAsSeededUser(requesterPage, REQUESTER_EMAIL);
      await requesterPage.goto(`/tickets/${shared.id}`);
      await expect(requesterPage.getByRole("heading", { name: /^Actions Taken \(\d+\)$/ })).toBeVisible();
      await expect(requesterPage.getByRole("heading", { name: "Status history" })).toBeVisible();
      await expect(requesterPage.getByRole("button", { name: "Add action" })).toHaveCount(0);
      await shot(requesterPage, "actions-taken", "requester-readonly", viewport);
      await requesterPage.context().close();
    });

    // -- ticket-workflow/ ---------------------------------------------------------------

    test("ticket-workflow: status-options, resolution-blocked, status-history", async ({ page }) => {
      const ticket = await seededTicket(SEEDED.rich);
      await loginAsSeededUser(page, IT_STAFF_EMAIL);
      await gotoStaffTicket(page, ticket);

      // status-history: the card as it renders for the Ticket's four recorded changes.
      await page.locator("#status-history-heading").scrollIntoViewIfNeeded();
      await expect(page.locator("ol.zen-status-history li").first()).toBeVisible();
      await shot(page, "ticket-workflow", "status-history", viewport);

      // status-options: the select shown expanded, listing only the permitted next states.
      await page.locator("#staff-ticket-status").scrollIntoViewIfNeeded();
      await page.locator("#staff-ticket-status").evaluate((el) => {
        const select = el as HTMLSelectElement;
        select.size = select.options.length;
        select.style.height = "auto"; // the control's fixed height would otherwise clip the list
      });
      await expect(page.locator("#staff-ticket-status option")).toHaveText(["In Progress", "Waiting for Requester", "Resolved", "Cancelled"]);
      await shot(page, "ticket-workflow", "status-options", viewport);
      await page.reload();
      await expect(page.getByRole("heading", { name: /^Actions Taken \(\d+\)$/ })).toBeVisible();

      // resolution-blocked: Resolved requested while Actions are still open.
      await page.locator("#staff-ticket-status").selectOption("RESOLVED");
      const blocked = page.getByRole("alert").filter({ hasText: "can't be resolved yet" });
      await expect(blocked).toBeVisible();
      await expect(page.getByRole("list", { name: "Resolution checklist" })).toBeVisible();
      await shot(page, "ticket-workflow", "resolution-blocked", viewport);
    });
  });
}
