import fs from "node:fs";
import { expect, test, type Page } from "@playwright/test";
import {
  LOCAL_DEV_PASSWORD,
  createMustChangePasswordFixtureUser,
  createPlainLoginFixtureUser,
  loginAs,
  loginAsSeededUser,
} from "../support/auth.js";
import {
  ADMIN_EMAIL,
  IT_STAFF_EMAIL,
  REQUESTER_EMAIL,
  cleanupLab4Fixtures,
  createLab4FixtureTicket,
  watchConsole,
} from "../support/lab4.js";

// E2E-17 (console, links, placeholders; AC-45, V-16) and E2E-18
// (representative Labs 1-3 regression; AC-42), docs/lab-04/tests.md §2.
// Real client, real server, `toktickit_e2e`; every Ticket and user this file
// creates is removed again in afterAll (support/lab4.ts cleanupLab4Fixtures).

test.afterAll(cleanupLab4Fixtures);

// ---------------------------------------------------------------------------
// E2E-17
// ---------------------------------------------------------------------------

/** Text that must never reach a user: unfinished copy and rendering leaks. */
const PLACEHOLDER_PATTERNS: [string, RegExp][] = [
  ["lorem ipsum", /lorem ipsum/i],
  ["TODO / TBD / FIXME", /\b(TODO|TBD|FIXME)\b/],
  ["coming soon", /coming soon/i],
  ["undefined / NaN / null", /\b(undefined|NaN|null)\b/],
  ["[object Object]", /\[object Object\]/],
  ["placeholder text", /\b(placeholder|sample text|dummy)\b/i],
];

interface Watch {
  errors: string[];
  badResponses: string[];
}

function watch(page: Page): Watch {
  const { errors } = watchConsole(page);
  const badResponses: string[] = [];
  page.on("response", (response) => {
    const url = response.url();
    if (url.includes("/api/") && response.status() >= 400) {
      badResponses.push(`${response.status()} ${response.request().method()} ${url}`);
    }
  });
  page.on("requestfailed", (request) => {
    // A navigation that is replaced by the next one aborts its in-flight reads; that is not a failure.
    if (request.failure()?.errorText !== "net::ERR_ABORTED") {
      errors.push(`requestfailed: ${request.method()} ${request.url()} ${request.failure()?.errorText}`);
    }
  });
  return { errors, badResponses };
}

/** Waits for the screen to settle, then checks it for placeholders, error states and unnamed controls. */
async function checkScreen(page: Page, where: string): Promise<void> {
  await page.waitForLoadState("networkidle");
  await expect(page.getByRole("heading").first()).toBeVisible();
  await expect(page.getByRole("status").filter({ hasText: /^Loading/ }), `${where}: still loading`).toHaveCount(0);

  const text = await page.locator("body").innerText();
  for (const [label, pattern] of PLACEHOLDER_PATTERNS) {
    expect(text, `${where}: contains ${label}`).not.toMatch(pattern);
  }
  expect(text, `${where}: error or not-found state`).not.toMatch(
    /Something went wrong|couldn't load|can't be found|Page not found|404|You don't have access/i,
  );

  const unnamed = await page.evaluate(() =>
    Array.from(document.querySelectorAll<HTMLElement>("a[href], button, input, select, textarea"))
      .filter((el) => {
        if ((el as HTMLInputElement).type === "hidden") return false;
        const rect = el.getBoundingClientRect();
        if (rect.width === 0 || rect.height === 0) return false;
        const named =
          el.getAttribute("aria-label") ||
          el.getAttribute("aria-labelledby") ||
          el.getAttribute("title") ||
          el.textContent?.trim() ||
          (el.id && document.querySelector(`label[for="${el.id}"]`)) ||
          el.closest("label");
        return !named;
      })
      .map((el) => `${el.tagName.toLowerCase()}#${el.id}.${el.className}`),
  );
  expect(unnamed, `${where}: controls without an accessible name`).toEqual([]);
}

/** Internal links on the current screen, de-duplicated, hash links dropped. */
async function internalLinks(page: Page): Promise<string[]> {
  const hrefs = await page.locator("a[href^='/']").evaluateAll((els) =>
    els.map((el) => el.getAttribute("href") as string),
  );
  return [...new Set(hrefs)];
}

async function walkLinks(page: Page, links: string[], seen: Set<string>): Promise<void> {
  for (const href of links) {
    if (seen.has(href)) continue;
    seen.add(href);
    await page.goto(href);
    await checkScreen(page, href);
  }
}

test.describe("E2E-17 console, links and placeholders (AC-45, V-16)", () => {
  test("Requester: dashboard, its drill-downs, My Tickets, Create Ticket and a Ticket Detail with Actions are clean", async ({ page }) => {
    const w = watch(page);
    await loginAsSeededUser(page, REQUESTER_EMAIL);
    await expect(page).toHaveURL(/\/dashboard$/);
    await checkScreen(page, "/dashboard");

    const seen = new Set<string>(["/dashboard"]);
    const links = await internalLinks(page);
    expect(links.length, "the dashboard offers links to follow").toBeGreaterThanOrEqual(5);
    await walkLinks(page, links, seen);

    // A Ticket Detail that has Actions and history: open one View.
    await page.goto("/tickets");
    await page.getByRole("link", { name: "TKT-2026-900005", exact: true }).click();
    await expect(page.getByRole("heading", { name: /^Actions Taken \(\d+\)$/i })).toBeVisible();
    await page.getByRole("button", { name: /^View action from/ }).first().click();
    await expect(page.getByText("Logged at")).toBeVisible();
    await checkScreen(page, "requester ticket detail");

    expect(w.errors, "console").toEqual([]);
    expect(w.badResponses, "failed API responses").toEqual([]);
  });

  test("IT Staff: dashboard, every drill-down and row link, queue and Ticket Detail with the Action form are clean", async ({ page }) => {
    const w = watch(page);
    await loginAsSeededUser(page, IT_STAFF_EMAIL);
    await expect(page).toHaveURL(/\/dashboard$/);
    await checkScreen(page, "/dashboard");

    const seen = new Set<string>(["/dashboard"]);
    const links = await internalLinks(page);
    // 4 cards + My Open Actions + 8 statuses + 3 priorities + rows and View all links.
    expect(links.length, "the dashboard offers links to follow").toBeGreaterThanOrEqual(17);
    await walkLinks(page, links, seen);

    // Ticket Detail with Actions: View, open and cancel the create form.
    await page.goto("/staff/tickets");
    await page.getByRole("link", { name: "TKT-2026-900003", exact: true }).click();
    await expect(page.getByRole("heading", { name: /^Actions Taken \(\d+\)$/ })).toBeVisible();
    await page.getByRole("button", { name: /^View action from/ }).first().click();
    await page.getByRole("button", { name: "Add action" }).click();
    await expect(page.getByRole("form", { name: "Add action" })).toBeVisible();
    await checkScreen(page, "staff ticket detail with form");
    await page.getByRole("form", { name: "Add action" }).getByRole("button", { name: "Cancel" }).click();
    await expect(page.getByRole("form", { name: "Add action" })).toHaveCount(0);

    expect(w.errors, "console").toEqual([]);
    expect(w.badResponses, "failed API responses").toEqual([]);
  });

  test("Administrator: dashboard with the Users strip, User Management and the Ticket Queue are clean", async ({ page }) => {
    const w = watch(page);
    await loginAsSeededUser(page, ADMIN_EMAIL);
    await expect(page).toHaveURL(/\/dashboard$/);
    await checkScreen(page, "/dashboard");

    const seen = new Set<string>(["/dashboard"]);
    const links = await internalLinks(page);
    expect(links.some((href) => href.startsWith("/admin/users?role=")), "Users strip links").toBe(true);
    await walkLinks(page, links, seen);
    await page.goto("/admin/users");
    await checkScreen(page, "/admin/users");

    expect(w.errors, "console").toEqual([]);
    expect(w.badResponses, "failed API responses").toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// E2E-18
// ---------------------------------------------------------------------------

test.describe("E2E-18 Labs 1-3 regression (AC-42)", () => {
  test("forced password change: login, change, land on the Dashboard, My Tickets works", async ({ page }) => {
    const user = await createMustChangePasswordFixtureUser();
    await loginAs(page, user.email, LOCAL_DEV_PASSWORD);
    await expect(page).toHaveURL(/\/change-password$/);
    await page.goto("/tickets");
    await expect(page, "protected routes bounce back until the password is changed").toHaveURL(/\/change-password$/);

    const next = "E2E-Lab4-New-Password-1!";
    await page.locator("#change-password-new").fill(next);
    await page.locator("#change-password-confirm").fill(next);
    await page.getByRole("button", { name: "Save password" }).click();
    await expect(page.getByRole("status").filter({ hasText: "Password changed." })).toBeVisible();
    await expect(page).toHaveURL(/\/dashboard$/);
    await page.goto("/tickets");
    await expect(page.getByRole("heading", { name: "My Tickets" })).toBeVisible();
  });

  test("Requester creates a Ticket with an attachment, finds it in My Tickets, downloads it, comments; IT Staff comments and notes; the note stays private", async ({ browser, page }, testInfo) => {
    const requester = await createPlainLoginFixtureUser("l4-regression");
    const summary = "Lab 4 regression: projector in room 14 will not start";

    // --- Requester: create with one attachment (Labs 1-2).
    await loginAs(page, requester.email, LOCAL_DEV_PASSWORD);
    await expect(page).toHaveURL(/\/dashboard$/);
    await page.goto("/tickets/new");
    await expect.poll(() => page.locator("#create-ticket-category option").count()).toBeGreaterThan(1);
    await expect.poll(() => page.locator("#create-ticket-related-system option").count()).toBeGreaterThan(1);
    await page.locator("#create-ticket-category").selectOption({ index: 1 });
    await page.locator("#create-ticket-related-system").selectOption({ index: 1 });
    await page.locator("#create-ticket-summary").fill(summary);
    await page
      .locator("#create-ticket-description")
      .fill("The projector shows a blue screen for about a minute and then switches itself off again.");
    const pdfPath = testInfo.outputPath("regression-report.pdf");
    fs.writeFileSync(pdfPath, `%PDF-1.4\n${"TokTickIT regression attachment. ".repeat(64)}\n%%EOF\n`);
    await page.locator("#create-ticket-attachments-input").setInputFiles(pdfPath);
    await expect(page.getByRole("heading", { name: "Attachments (1/5)", level: 2 })).toBeVisible();

    const created = page.waitForResponse((r) => r.url().endsWith("/api/tickets") && r.request().method() === "POST");
    await page.getByRole("heading", { name: "Create Ticket" }).click();
    await page.getByRole("button", { name: "Submit ticket" }).click();
    const createdResponse = await created;
    expect(createdResponse.status()).toBe(201);
    const ticket = (await createdResponse.json()) as { id: number; ticketNumber: string };
    await expect(page.getByRole("heading", { name: `Ticket ${ticket.ticketNumber} created` })).toBeVisible();

    // --- My Tickets, search, Ticket Detail, download.
    await page.goto("/tickets");
    await page.locator("#my-tickets-search").fill(ticket.ticketNumber);
    const row = page.locator(".zen-my-tickets__table tbody tr");
    await expect.poll(() => row.count()).toBe(1);
    await expect(row.first()).toContainText(summary);
    await page.getByRole("link", { name: ticket.ticketNumber, exact: true }).click();
    await expect(page.getByRole("heading", { name: "Ticket Details" })).toBeVisible();
    await expect(page.getByRole("heading", { name: /^Actions Taken \(0\)$/i })).toBeVisible();
    await expect(page.getByText("No actions have been recorded yet.")).toBeVisible();
    const attachment = page.locator(".zen-attachment-list__item").filter({ hasText: "regression-report.pdf" });
    await expect(attachment).toHaveCount(1);
    const downloadResponse = page.waitForResponse((r) => /\/api\/attachments\/\d+\/download$/.test(r.url()));
    await attachment.getByRole("button", { name: "Download" }).click();
    expect((await downloadResponse).status()).toBe(200);

    // --- Requester Public Comment.
    const requesterComment = "The projector is in room 14, building C.";
    await page.locator("#message-thread-public-body").fill(requesterComment);
    await page.locator(".thread--public").getByRole("button", { name: "Post comment" }).click();
    await expect(page.locator(".thread--public").getByText(requesterComment)).toBeVisible();

    // --- IT Staff: queue finds it, Public Comment and Internal Note.
    const staffContext = await browser.newContext();
    try {
      const staff = await staffContext.newPage();
      await loginAsSeededUser(staff, IT_STAFF_EMAIL);
      await staff.goto("/staff/tickets");
      await expect(staff.getByRole("heading", { name: "Ticket Queue" })).toBeVisible();
      await staff.locator("#staff-queue-search").fill(ticket.ticketNumber);
      await expect(staff.getByRole("link", { name: ticket.ticketNumber, exact: true })).toBeVisible();
      await staff.getByRole("link", { name: ticket.ticketNumber, exact: true }).click();
      await expect(staff.getByRole("heading", { name: "Ticket Details" })).toBeVisible();
      await expect(staff.locator(".thread--public").getByText(requesterComment)).toBeVisible();
      await expect(staff.getByRole("heading", { name: "Actions Taken (0)" })).toBeVisible();

      const reply = "Thanks, a technician will visit room 14 this afternoon.";
      const note = "Internal only: bulb counter shows 3,900 hours, likely the lamp.";
      await staff.locator("#message-thread-public-body").fill(reply);
      await staff.locator(".thread--public").getByRole("button", { name: "Post comment" }).click();
      await expect(staff.locator(".thread--public").getByText(reply)).toBeVisible();
      await staff.locator("#message-thread-internal-body").fill(note);
      await staff.locator(".thread--internal").getByRole("button", { name: "Save internal note" }).click();
      await expect(staff.locator(".thread--internal").getByText(note)).toBeVisible();

      // The Requester sees the reply and never the note.
      await page.reload();
      await expect(page.locator(".thread--public").getByText(reply)).toBeVisible();
      await expect(page.getByText(note)).toHaveCount(0);
      await expect(page.locator(".thread--internal")).toHaveCount(0);
    } finally {
      await staffContext.close();
    }
  });

  test("Administrator user management: list, search, role filter and creating a user", async ({ page }) => {
    const email = "l4-regression-new-user@example.test";
    await loginAsSeededUser(page, ADMIN_EMAIL);
    await page.goto("/admin/users");
    await expect(page.getByRole("heading", { name: "User Management" })).toBeVisible();
    await expect(page.getByRole("cell", { name: "Priya Natarajan", exact: true })).toBeVisible();
    await page.locator("#user-mgmt-search").fill("emma.fischer");
    await expect(page.getByRole("cell", { name: "Emma Fischer", exact: true })).toBeVisible();
    await expect(page.getByRole("cell", { name: "Priya Natarajan", exact: true })).toHaveCount(0);
    await page.locator("#user-mgmt-search").fill("");

    // The Dashboard's Users strip lands here with the role filter applied.
    await page.goto("/dashboard");
    await page.getByRole("link", { name: /^IT Staff: \d+, view list$/ }).click();
    await expect(page).toHaveURL(/\/admin\/users\?role=IT_STAFF/);
    await expect(page.getByRole("heading", { name: "User Management" })).toBeVisible();
    await expect(page.getByRole("cell", { name: "Priya Natarajan", exact: true })).toBeVisible();
    await expect(page.getByRole("cell", { name: "Jennifer Anderson", exact: true })).toHaveCount(0);

    await page.getByRole("button", { name: "New user" }).click();
    const dialog = page.getByRole("dialog");
    await dialog.locator("#user-dialog-name").fill("L4 Regression User");
    await dialog.locator("#user-dialog-email").fill(email);
    await dialog.locator("#user-dialog-role").selectOption("IT_STAFF");
    await dialog.locator("#user-dialog-password").fill("L4-Regression-Initial-1!");
    await dialog.getByRole("button", { name: "Save" }).click();
    await expect(page.getByRole("dialog")).toHaveCount(0);
    await expect(page.getByRole("row").filter({ hasText: email })).toContainText("IT Staff");
  });
});
