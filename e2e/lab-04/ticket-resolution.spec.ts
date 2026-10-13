import { expect, test, type Browser, type Page } from "@playwright/test";
import { LOCAL_DEV_PASSWORD, createPlainLoginFixtureUser, loginAs, loginAsSeededUser } from "../support/auth.js";
import {
  IT_STAFF_EMAIL,
  cleanupLab4Fixtures,
  createLab4FixtureTicket,
  dbRows,
} from "../support/lab4.js";

// E2E-07..E2E-10 (docs/lab-04/tests.md §2): the resolution gate, the
// Requester's advisory indication, status history and the Requester view, and
// stale Ticket status between two staff sessions. Real server, client and the
// dedicated `toktickit_e2e` database; every Ticket is a TKT-2026-9975xx
// fixture removed by `cleanupLab4Fixtures` in afterAll.

const CARLOS_EMAIL = "carlos.mendes@example.edu";

test.afterAll(cleanupLab4Fixtures);

async function openStaffDetail(page: Page, email: string, ticketId: number): Promise<void> {
  await loginAsSeededUser(page, email);
  await page.goto(`/staff/tickets/${ticketId}`);
  await expect(page.getByRole("heading", { name: /^Actions Taken \(\d+\)$/ })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Status history" })).toBeVisible();
}

async function staffPageFor(browser: Browser, email: string, ticketId: number): Promise<Page> {
  const page = await (await browser.newContext()).newPage();
  await openStaffDetail(page, email, ticketId);
  return page;
}

const statusSelect = (page: Page) => page.locator("#staff-ticket-status");
const summaryStatus = (page: Page) => page.getByTestId("summary-status");
const historyRows = (page: Page) => page.locator("ol.zen-status-history li");
const rowOf = (page: Page, text: string) => page.getByRole("row").filter({ hasText: text });

/** Moves an Action to `status` through its Edit form (a result is typed for Completed). */
async function setActionStatus(page: Page, description: string, status: "IN_PROGRESS" | "COMPLETED", result?: string): Promise<void> {
  await rowOf(page, description).getByRole("button", { name: /^Edit action/ }).click();
  const form = page.getByRole("form", { name: "Edit action" });
  await form.getByLabel("Status").selectOption(status);
  if (result) await form.getByLabel("Result").fill(result);
  await form.getByRole("button", { name: "Save action" }).click();
  await expect(form).toHaveCount(0);
}

// ---------------------------------------------------------------------------
// E2E-07
// ---------------------------------------------------------------------------

test("E2E-07 resolution gate end to end: blocked with reasons, then the same control succeeds; an Action logged after Resolving blocks Close (AC-20, AC-21, AC-22, AC-26, AC-48)", async ({ page }) => {
  const ticket = await createLab4FixtureTicket("l4-e2e07", "TKT-2026-997500", {
    status: "IN_PROGRESS",
    actions: [{ description: "Replace the battery.", status: "IN_PROGRESS", hoursAgo: 5 }],
    history: [
      { from: "NEW", to: "OPEN", hoursAgo: 100 },
      { from: "OPEN", to: "IN_PROGRESS", hoursAgo: 90 },
    ],
  });
  await openStaffDetail(page, IT_STAFF_EMAIL, ticket.id);
  await expect(historyRows(page)).toHaveCount(2);

  // The control offers only the permitted next states.
  await expect(statusSelect(page).locator("option")).toHaveText(["In Progress", "Waiting for Requester", "Resolved", "Cancelled"]);

  // 1. Blocked: no completed Action and one still open. The reasons are listed and nothing changes.
  await statusSelect(page).selectOption("RESOLVED");
  const blocked = page.getByRole("alert").filter({ hasText: "can't be resolved yet" });
  await expect(blocked).toBeVisible();
  await expect(blocked).toContainText("Complete at least one Action Taken.");
  await expect(blocked).toContainText("1 Action Taken is still Planned or In Progress.");
  await expect(blocked.getByRole("link", { name: "Go to Actions Taken" })).toBeVisible();
  await expect(summaryStatus(page)).toHaveText("In Progress");
  await expect(statusSelect(page)).toHaveValue("IN_PROGRESS");
  await expect(historyRows(page)).toHaveCount(2);
  // The checklist agrees with the data.
  const checklist = page.getByRole("list", { name: "Resolution checklist" });
  await expect(checklist.getByRole("listitem").filter({ hasText: "Ticket has an owner" })).toContainText("Met");
  await expect(checklist.getByRole("listitem").filter({ hasText: "At least one action is completed" })).toContainText("Not met");

  // 2. Complete the open Action; the same control now succeeds without a reload.
  await setActionStatus(page, "Replace the battery.", "COMPLETED", "Battery replaced and charging.");
  await statusSelect(page).selectOption("RESOLVED");
  await expect(page.getByRole("status").filter({ hasText: "Status changed to Resolved." })).toBeVisible();
  await expect(blocked).toHaveCount(0);
  await expect(summaryStatus(page)).toHaveText("Resolved");
  await expect(historyRows(page)).toHaveCount(3);
  await expect(historyRows(page).last()).toContainText("Resolved");
  await expect(historyRows(page).last()).toContainText("Priya Natarajan");
  expect(await statusSelect(page).locator("option").evaluateAll((os) => os.map((o) => (o as HTMLOptionElement).value)).then((v) => v.sort())).toEqual([
    "CLOSED",
    "REOPENED",
    "RESOLVED",
  ]);

  // 3. A new Action logged after Resolving blocks Close until it is completed.
  await page.getByRole("button", { name: "Add action" }).click();
  const add = page.getByRole("form", { name: "Add action" });
  await add.getByLabel("Description").fill("Check back with the requester next week.");
  await add.getByRole("button", { name: "Save action" }).click();
  await expect(page.getByRole("heading", { name: "Actions Taken (2)" })).toBeVisible();

  await statusSelect(page).selectOption("CLOSED");
  const closeDialog = page.getByRole("dialog", { name: "Close this ticket?" });
  await closeDialog.getByRole("button", { name: "Close ticket" }).click();
  const closeBlocked = page.getByRole("alert").filter({ hasText: "can't be closed yet" });
  await expect(closeBlocked).toBeVisible();
  await expect(closeBlocked).toContainText("1 Action Taken is still Planned or In Progress.");
  await expect(summaryStatus(page)).toHaveText("Resolved");
  await expect(historyRows(page)).toHaveCount(3);

  await setActionStatus(page, "Check back with the requester next week.", "IN_PROGRESS");
  await setActionStatus(page, "Check back with the requester next week.", "COMPLETED", "Requester confirmed it works.");
  await statusSelect(page).selectOption("CLOSED");
  await closeDialog.getByRole("button", { name: "Close ticket" }).click();
  await expect(page.getByRole("status").filter({ hasText: "Status changed to Closed." })).toBeVisible();
  await expect(closeBlocked).toHaveCount(0);
  await expect(summaryStatus(page)).toHaveText("Closed");
  await expect(historyRows(page)).toHaveCount(4);
  await expect(page.getByText("This ticket is closed. Actions Taken are read-only.")).toBeVisible();
});

test("E2E-07 a Ticket without an Owner is blocked with that reason and resolves once claimed (AC-22)", async ({ page }) => {
  const ticket = await createLab4FixtureTicket("l4-e2e07b", "TKT-2026-997501", {
    status: "IN_PROGRESS",
    ownerEmail: null,
    actions: [{ description: "Diagnosed the failing switch.", status: "COMPLETED", result: "Port 4 is dead." }],
  });
  await openStaffDetail(page, IT_STAFF_EMAIL, ticket.id);

  await statusSelect(page).selectOption("RESOLVED");
  const blocked = page.getByRole("alert").filter({ hasText: "can't be resolved yet" });
  await expect(blocked).toContainText("Assign a Ticket Owner first.");
  await expect(blocked).not.toContainText("Complete at least one Action Taken.");
  await expect(summaryStatus(page)).toHaveText("In Progress");

  await page.getByRole("button", { name: "Claim" }).click();
  await expect(page.locator("#staff-ticket-owner")).toHaveValue(/\d+/);
  await statusSelect(page).selectOption("RESOLVED");
  await expect(page.getByRole("status").filter({ hasText: "Status changed to Resolved." })).toBeVisible();
  await expect(summaryStatus(page)).toHaveText("Resolved");
});

// ---------------------------------------------------------------------------
// E2E-08
// ---------------------------------------------------------------------------

test("E2E-08 the Requester's 'Problem appears resolved' is advisory: status stays and IT Staff still must resolve (AC-23)", async ({ page, browser }) => {
  const ticket = await createLab4FixtureTicket("l4-e2e08", "TKT-2026-997502", {
    status: "OPEN",
    actions: [{ description: "Looked at the mailbox rules.", status: "IN_PROGRESS", hoursAgo: 2 }],
  });

  await loginAs(page, ticket.requester.email, LOCAL_DEV_PASSWORD);
  await page.goto(`/tickets/${ticket.id}`);
  await expect(page.getByRole("heading", { name: "Ticket Details" })).toBeVisible();
  await page.getByRole("button", { name: "Problem appears resolved" }).click();
  await page.getByRole("button", { name: "Yes, let IT Staff know" }).click();
  await expect(page.getByText(/You reported this looks resolved on/)).toBeVisible();
  await expect(page.locator(".zen-ticket-detail__field", { hasText: "Current Status" })).toContainText("Open");

  // IT Staff see the indication, the status is still Open, and the gate still applies.
  const staff = await staffPageFor(browser, IT_STAFF_EMAIL, ticket.id);
  await expect(staff.getByText(/The requester reported this looks resolved on/)).toBeVisible();
  await expect(summaryStatus(staff)).toHaveText("Open");
  await statusSelect(staff).selectOption("RESOLVED");
  const blocked = staff.getByRole("alert").filter({ hasText: "can't be resolved yet" });
  await expect(blocked).toContainText("Complete at least one Action Taken.");
  await expect(summaryStatus(staff)).toHaveText("Open");

  // Only after the Action work is done does IT Staff's own change succeed.
  await setActionStatus(staff, "Looked at the mailbox rules.", "COMPLETED", "A forwarding rule was the cause; removed.");
  await statusSelect(staff).selectOption("RESOLVED");
  await expect(staff.getByRole("status").filter({ hasText: "Status changed to Resolved." })).toBeVisible();
  await expect(summaryStatus(staff)).toHaveText("Resolved");
  await staff.context().close();
});

// ---------------------------------------------------------------------------
// E2E-09
// ---------------------------------------------------------------------------

test("E2E-09 history lists each change in order; the owning Requester sees Actions and history read-only; another Requester gets not found (AC-24, AC-39)", async ({ page, browser }) => {
  const ticket = await createLab4FixtureTicket("l4-e2e09", "TKT-2026-997503", {
    status: "IN_PROGRESS",
    actions: [
      {
        description: "Collected the crash log.",
        result: "Fault is in the display driver.",
        status: "COMPLETED",
        hoursAgo: 20,
        followUpNote: "Re-check after the next driver release.",
        attachmentNotes: "the crash log screenshot",
      },
      { description: "Install the patched driver.", status: "PLANNED", hoursAgo: 3 },
    ],
    history: [
      { from: "NEW", to: "OPEN", hoursAgo: 100 },
      { from: "OPEN", to: "WAITING_FOR_REQUESTER", hoursAgo: 80 },
      { from: "WAITING_FOR_REQUESTER", to: "IN_PROGRESS", hoursAgo: 60 },
    ],
  });
  await dbRows(
    `INSERT INTO "InternalNote" ("ticketId", "authorId", body) VALUES ($1, (SELECT id FROM "User" WHERE lower(email) = lower($2)), $3)`,
    [ticket.id, IT_STAFF_EMAIL, "PRIVATE-NOTE-FOR-STAFF-ONLY: vendor said the driver is flaky."],
  );

  // Staff: three entries, oldest first, with who changed it.
  await openStaffDetail(page, IT_STAFF_EMAIL, ticket.id);
  const expectOrder = async (p: Page) => {
    await expect(historyRows(p)).toHaveCount(3);
    await expect(historyRows(p).nth(0)).toContainText(/New\s*→\s*to\s*Open/);
    await expect(historyRows(p).nth(1)).toContainText(/Open\s*→\s*to\s*Waiting for Requester/);
    await expect(historyRows(p).nth(2)).toContainText(/Waiting for Requester\s*→\s*to\s*In Progress/);
    await expect(historyRows(p).nth(2)).toContainText("Priya Natarajan");
  };
  await expectOrder(page);
  await expect(page.getByText("PRIVATE-NOTE-FOR-STAFF-ONLY")).toBeVisible();

  // The owning Requester: same history, same Actions, nothing writable, no Internal Notes.
  const requesterPage = await (await browser.newContext()).newPage();
  await loginAs(requesterPage, ticket.requester.email, LOCAL_DEV_PASSWORD);
  await requesterPage.goto(`/tickets/${ticket.id}`);
  await expect(requesterPage.getByRole("heading", { name: "Actions Taken (2)" })).toBeVisible();
  await expectOrder(requesterPage);
  await expect(rowOf(requesterPage, "Collected the crash log.")).toContainText("Fault is in the display driver.");
  await expect(rowOf(requesterPage, "Collected the crash log.")).toContainText("Priya Natarajan");
  await expect(rowOf(requesterPage, "Collected the crash log.").getByText("Completed", { exact: true })).toBeVisible();
  await expect(requesterPage.getByRole("button", { name: "Add action" })).toHaveCount(0);
  await expect(requesterPage.getByRole("button", { name: /^Edit action/ })).toHaveCount(0);
  await expect(requesterPage.locator("#staff-ticket-status, #staff-ticket-owner, #staff-it-priority")).toHaveCount(0);
  await requesterPage.getByRole("button", { name: /^View action from/ }).last().click();
  await requesterPage.getByRole("button", { name: /^View action from/ }).first().click();
  await expect(requesterPage.getByText("Look for: the crash log screenshot")).toBeVisible();
  await expect(requesterPage.getByText("Re-check after the next driver release.")).toBeVisible();
  await expect(requesterPage.getByRole("heading", { name: /Internal Notes/i })).toHaveCount(0);
  await expect(requesterPage.getByText("PRIVATE-NOTE-FOR-STAFF-ONLY")).toHaveCount(0);
  await requesterPage.context().close();

  // A different Requester: the Ticket does not exist for them.
  const other = await createPlainLoginFixtureUser("l4-e2e09-other");
  const otherPage = await (await browser.newContext()).newPage();
  await loginAs(otherPage, other.email, LOCAL_DEV_PASSWORD);
  await otherPage.goto(`/tickets/${ticket.id}`);
  await expect(otherPage.getByRole("heading", { name: "Ticket not found" })).toBeVisible();
  await expect(otherPage.getByText("Collected the crash log.")).toHaveCount(0);
  await expect(otherPage.getByText(ticket.ticketNumber)).toHaveCount(0);
  await otherPage.context().close();
});

// ---------------------------------------------------------------------------
// E2E-10
// ---------------------------------------------------------------------------

test("E2E-10 stale Ticket status between two staff sessions shows the callout and the refreshed state (AC-25)", async ({ browser }) => {
  const ticket = await createLab4FixtureTicket("l4-e2e10", "TKT-2026-997504", { status: "OPEN" });
  const first = await staffPageFor(browser, IT_STAFF_EMAIL, ticket.id);
  const second = await staffPageFor(browser, CARLOS_EMAIL, ticket.id);
  await expect(summaryStatus(second)).toHaveText("Open");

  await statusSelect(first).selectOption("IN_PROGRESS");
  await expect(first.getByRole("status").filter({ hasText: "Status changed to In Progress." })).toBeVisible();

  // The second session still holds the old version.
  await statusSelect(second).selectOption("WAITING_FOR_REQUESTER");
  const stale = second.getByRole("alert").filter({ hasText: "This ticket was changed by someone else. Review its current state." });
  await expect(stale).toBeVisible();
  // The select reverts and nothing was applied.
  await expect(statusSelect(second)).toHaveValue("OPEN");
  await expect(summaryStatus(second)).toHaveText("Open");

  await stale.getByRole("button", { name: "Refresh" }).click();
  await expect(stale).toHaveCount(0);
  await expect(summaryStatus(second)).toHaveText("In Progress");
  await expect(statusSelect(second)).toHaveValue("IN_PROGRESS");
  await expect(historyRows(second)).toHaveCount(1);

  // With the refreshed version the same change now goes through.
  await statusSelect(second).selectOption("WAITING_FOR_REQUESTER");
  await expect(second.getByRole("status").filter({ hasText: "Status changed to Waiting for Requester." })).toBeVisible();
  await expect(summaryStatus(second)).toHaveText("Waiting for Requester");
  await first.context().close();
  await second.context().close();
});
