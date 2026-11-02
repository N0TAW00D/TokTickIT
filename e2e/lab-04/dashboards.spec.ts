import { expect, test, type Page } from "@playwright/test";
import { loginAsSeededUser } from "../support/auth.js";
import {
  ADMIN_EMAIL,
  IT_STAFF_EMAIL,
  REQUESTER_EMAIL,
  ZERO_REQUESTER_EMAIL,
  ZERO_STAFF_EMAIL,
  cleanupLab4Fixtures,
  createLab4FixtureTicket,
  dbCount,
  dbRows,
  ticketIdByNumber,
  watchConsole,
} from "../support/lab4.js";

// E2E-11..E2E-15 (dashboards: drill-down, ownership, Administrator, zero
// data, landing and nav per role) are at the end of this file. Expected
// values come from independent read-only SQL on `toktickit_e2e`, never from
// the dashboard code under test, and every check compares what the card says
// with the total of the list it opens.
//
// E2E-16 (docs/lab-04/tests.md §2; AC-45, AC-36): safe failure in the browser.
// A forced 500 on the dashboard and on the Actions list shows the failure
// state with Retry, Retry succeeds, and nothing but the browser's own
// "Failed to load resource" line for the forced response reaches the console.

test.afterAll(cleanupLab4Fixtures);

const SAFE_BODY = { error: { code: "INTERNAL_ERROR", message: "Something went wrong." } };

/** The browser itself logs one `console.error` per failed resource; only that line is expected here. */
function unexpectedErrors(errors: string[]): string[] {
  return errors.filter((e) => !/Failed to load resource: the server responded with a status of 500/.test(e));
}

/**
 * Answers every matching GET with a 500 until `release()` is called. (Not "the first N":
 * React StrictMode runs the load effect twice in dev, so the first response is dropped as
 * superseded and a single failure would be swallowed.)
 */
async function failUntilReleased(page: Page, pattern: RegExp): Promise<{ count: () => number; release: () => void }> {
  let seen = 0;
  let released = false;
  await page.route(pattern, async (route) => {
    if (!released && route.request().method() === "GET") {
      seen += 1;
      await route.fulfill({ status: 500, contentType: "application/json", body: JSON.stringify(SAFE_BODY) });
      return;
    }
    await route.continue();
  });
  return { count: () => seen, release: () => { released = true; } };
}

test.describe("E2E-16 safe failure in the browser (AC-45, AC-36)", () => {
  for (const [label, email, endpoint] of [
    ["IT Staff", IT_STAFF_EMAIL, /\/api\/dashboard\/staff$/],
    ["Requester", REQUESTER_EMAIL, /\/api\/dashboard\/requester$/],
  ] as const) {
    test(`${label} dashboard: a 500 shows the failure state with Retry, Retry loads the numbers`, async ({ page }) => {
      const console_ = watchConsole(page);
      // Installed before sign-in: the post-login redirect to /dashboard makes the request that fails.
      const failing = await failUntilReleased(page, endpoint);
      await loginAsSeededUser(page, email);
      await expect(page).toHaveURL(/\/dashboard$/);

      const alert = page.getByRole("alert").filter({ hasText: "We couldn't load the dashboard." });
      await expect(alert).toBeVisible();
      expect(failing.count()).toBeGreaterThanOrEqual(1);
      // No partial numbers, no stack, SQL or path.
      await expect(page.locator(".zen-metric-card")).toHaveCount(0);
      await expect(page.locator("body")).not.toContainText(/stack|prisma|SELECT |\/Users\/|node_modules/i);

      failing.release();
    await alert.getByRole("button", { name: "Retry" }).click();
      await expect(page.getByRole("button", { name: "Refresh" })).toBeVisible();
      await expect(page.locator(".zen-metric-card").first()).toBeVisible();
      await expect(alert).toHaveCount(0);
      expect(unexpectedErrors(console_.errors)).toEqual([]);
    });
  }

  test("a 500 on a refresh keeps nothing stale and Retry recovers", async ({ page }) => {
    const console_ = watchConsole(page);
    await loginAsSeededUser(page, IT_STAFF_EMAIL);
    await page.goto("/dashboard");
    await expect(page.locator(".zen-metric-card").first()).toBeVisible();

    const failing = await failUntilReleased(page, /\/api\/dashboard\/staff$/);
    await page.getByRole("button", { name: "Refresh" }).click();
    const alert = page.getByRole("alert").filter({ hasText: "We couldn't load the dashboard." });
    await expect(alert).toBeVisible();
    expect(failing.count()).toBeGreaterThanOrEqual(1);
    failing.release();
    await alert.getByRole("button", { name: "Retry" }).click();
    await expect(page.locator(".zen-metric-card").first()).toBeVisible();
    expect(unexpectedErrors(console_.errors)).toEqual([]);
  });

  test("Staff Ticket Detail: a 500 on the Actions list shows a failure state with Retry, Retry lists the Actions", async ({ page }) => {
    const ticket = await createLab4FixtureTicket("l4-e2e16", "TKT-2026-997300", {
      actions: [{ description: "Visible after the retry.", status: "COMPLETED", result: "Done." }],
    });
    const console_ = watchConsole(page);
    await loginAsSeededUser(page, IT_STAFF_EMAIL);
    const failing = await failUntilReleased(page, /\/api\/tickets\/\d+\/actions-taken$/);
    await page.goto(`/staff/tickets/${ticket.id}`);

    const card = page.locator("#actions-taken");
    const alert = card.getByRole("alert").filter({ hasText: "Something went wrong. Try again." });
    await expect(alert).toBeVisible();
    expect(failing.count()).toBeGreaterThanOrEqual(1);
    // The rest of the page still works: the Ticket itself loaded.
    await expect(page.getByRole("heading", { name: "Ticket Details" })).toBeVisible();
    await expect(page.getByText("Visible after the retry.")).toHaveCount(0);
    await expect(card.getByRole("button", { name: "Add action" })).toHaveCount(0);

    failing.release();
    await alert.getByRole("button", { name: "Retry" }).click();
    await expect(page.getByRole("heading", { name: "Actions Taken (1)" })).toBeVisible();
    await expect(page.getByText("Visible after the retry.")).toBeVisible();
    await expect(alert).toHaveCount(0);
    expect(unexpectedErrors(console_.errors)).toEqual([]);
  });

  test("saving an Action over a 500 keeps the entered values, shows Retry, and one Retry creates exactly one Action", async ({ page }) => {
    const ticket = await createLab4FixtureTicket("l4-e2e16b", "TKT-2026-997301", { actions: [] });
    const console_ = watchConsole(page);
    await loginAsSeededUser(page, IT_STAFF_EMAIL);
    await page.goto(`/staff/tickets/${ticket.id}`);
    await expect(page.getByRole("heading", { name: "Actions Taken (0)" })).toBeVisible();

    let posts = 0;
    const bodies: string[] = [];
    await page.route(/\/api\/tickets\/\d+\/actions-taken$/, async (route) => {
      if (route.request().method() !== "POST") return route.continue();
      posts += 1;
      bodies.push(route.request().postData() ?? "");
      if (posts === 1) {
        return route.fulfill({ status: 500, contentType: "application/json", body: JSON.stringify(SAFE_BODY) });
      }
      return route.continue();
    });

    await page.getByRole("button", { name: "Add action" }).click();
    const form = page.getByRole("form", { name: "Add action" });
    await form.getByLabel("Description").fill("Typed before the failure.");
    await form.getByRole("button", { name: "Save action" }).click();

    const alert = form.getByRole("alert").filter({ hasText: "Something went wrong. Try again." });
    await expect(alert).toBeVisible();
    await expect(form.getByLabel("Description")).toHaveValue("Typed before the failure.");
    await alert.getByRole("button", { name: "Retry" }).click();

    await expect(page.getByRole("status").filter({ hasText: "Action saved." })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Actions Taken (1)" })).toBeVisible();
    expect(posts).toBe(2);
    // The retry reuses the same idempotency key (BR-35).
    const keys = bodies.map((b) => (JSON.parse(b) as { clientRequestId?: string }).clientRequestId);
    expect(keys[0]).toBeTruthy();
    expect(keys[1]).toBe(keys[0]);
    expect(unexpectedErrors(console_.errors)).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// Shared helpers for E2E-11..E2E-15
// ---------------------------------------------------------------------------

const OPEN = `t.status NOT IN ('RESOLVED','CLOSED','CANCELLED')`;
/** 00:00 Asia/Bangkok six days ago (api-spec §4), as a UTC instant. */
const WINDOW_START = `((date_trunc('day', now() AT TIME ZONE 'Asia/Bangkok') - interval '6 days') AT TIME ZONE 'Asia/Bangkok')`;
const UPDATED_IN_WINDOW = `(t."updatedAt" AT TIME ZONE 'UTC') >= ${WINDOW_START}`;

async function userId(email: string): Promise<number> {
  const rows = await dbRows<{ id: number }>('SELECT id FROM "User" WHERE lower(email) = lower($1)', [email]);
  return rows[0].id;
}

/** The value in a card's accessible name ("Unassigned: 5, view list"). */
async function cardValue(page: Page, label: string): Promise<number> {
  const name = await page.getByRole("link", { name: new RegExp(`^${label}: \\d+, view list$`) }).getAttribute("aria-label");
  return Number(/: (\d+),/.exec(name ?? "")?.[1]);
}

/** The total a Ticket list reports (queue or My Tickets), or 0 for its "nothing matches" state. */
async function listTotal(page: Page): Promise<number> {
  const summary = page.locator(".zen-pagination__summary");
  const none = page.getByText(/No tickets match|The queue is empty|You have no tickets/).first();
  await expect(summary.or(none).first()).toBeVisible();
  if ((await summary.count()) === 0) return 0;
  return Number(/of (\d+)/.exec((await summary.innerText()) ?? "")?.[1]);
}

async function openDashboard(page: Page, email: string): Promise<void> {
  await loginAsSeededUser(page, email);
  await expect(page).toHaveURL(/\/dashboard$/);
  await expect(page.getByRole("button", { name: "Refresh" })).toBeVisible();
}

/** Follows the link named `name`, expects `url`, and returns the list total behind it. */
async function drillDown(page: Page, name: string | RegExp, url: RegExp): Promise<number> {
  await page.getByRole("link", { name }).first().click();
  await expect(page).toHaveURL(url);
  return listTotal(page);
}

async function backToDashboard(page: Page): Promise<void> {
  await page.goto("/dashboard");
  await expect(page.getByRole("button", { name: "Refresh" })).toBeVisible();
}

// ---------------------------------------------------------------------------
// E2E-11
// ---------------------------------------------------------------------------

test.describe("E2E-11 staff dashboard and drill-down (AC-28, AC-29, AC-34)", () => {
  test("each card value equals the queue total it opens and the independently computed seeded value", async ({ page }) => {
    const me = await userId(IT_STAFF_EMAIL);
    const expected = {
      Unassigned: await dbCount(`SELECT count(*) n FROM "Ticket" t WHERE ${OPEN} AND t."ownerId" IS NULL`),
      "Owned by Me": await dbCount(`SELECT count(*) n FROM "Ticket" t WHERE ${OPEN} AND t."ownerId" = $1`, [me]),
      Urgent: await dbCount(`SELECT count(*) n FROM "Ticket" t WHERE ${OPEN} AND t."itPriority" = 'HIGH'`),
      "Follow-ups Required": await dbCount(
        `SELECT count(DISTINCT a."ticketId") n FROM "ActionTaken" a JOIN "Ticket" t ON t.id = a."ticketId"
          WHERE ${OPEN} AND a."followUpRequired" AND a.status <> 'CANCELLED'`,
      ),
    };
    const actionsWhere = `a.status IN ('PLANNED','IN_PROGRESS') AND ${OPEN}
          AND (a."assigneeId" = $1 OR (a."assigneeId" IS NULL AND a."performedById" = $1))`;
    const myActions = await dbCount(`SELECT count(*) n FROM "ActionTaken" a JOIN "Ticket" t ON t.id = a."ticketId" WHERE ${actionsWhere}`, [me]);
    const myActionTickets = await dbCount(
      `SELECT count(DISTINCT a."ticketId") n FROM "ActionTaken" a JOIN "Ticket" t ON t.id = a."ticketId" WHERE ${actionsWhere}`,
      [me],
    );
    // Priya's seeded data has something in every band, so these cards are not trivially zero.
    for (const [label, value] of Object.entries(expected)) expect(value, `${label} is non-zero in the seed`).toBeGreaterThan(0);
    expect(myActions).toBeGreaterThan(0);

    await openDashboard(page, IT_STAFF_EMAIL);
    const urls: Record<string, RegExp> = {
      Unassigned: /\/staff\/tickets\?.*owner=unassigned.*scope=open/,
      "Owned by Me": /\/staff\/tickets\?.*owner=me.*scope=open/,
      Urgent: /\/staff\/tickets\?.*itPriority=HIGH.*scope=open/,
      "Follow-ups Required": /\/staff\/tickets\?.*followUp=true.*scope=open/,
    };
    for (const [label, want] of Object.entries(expected)) {
      expect(await cardValue(page, label), `${label} card matches the database`).toBe(want);
      const total = await drillDown(page, new RegExp(`^${label}: \\d+, view list$`), urls[label]);
      expect(total, `${label}: the list it opens has the card's total`).toBe(want);
      await backToDashboard(page);
    }

    // My Open Actions: the card counts Actions, the list shows exactly the Tickets they sit on.
    expect(await cardValue(page, "My Open Actions")).toBe(myActions);
    await expect(page.getByRole("link", { name: /^My Open Actions:/ })).toContainText(`on ${myActionTickets} ticket`);
    const actionTickets = await drillDown(page, /^My Open Actions: \d+, view list$/, /\/staff\/tickets\?.*myActions=true.*scope=open/);
    expect(actionTickets).toBe(myActionTickets);
    await backToDashboard(page);
  });

  test("status and IT priority counts equal the lists they open", async ({ page }) => {
    await openDashboard(page, IT_STAFF_EMAIL);
    const statuses: [string, string][] = [
      ["New", "NEW"], ["Open", "OPEN"], ["In Progress", "IN_PROGRESS"], ["Waiting for Requester", "WAITING_FOR_REQUESTER"],
      ["Resolved", "RESOLVED"], ["Closed", "CLOSED"], ["Reopened", "REOPENED"], ["Cancelled", "CANCELLED"],
    ];
    for (const [label, code] of statuses) {
      const want = await dbCount(`SELECT count(*) n FROM "Ticket" t WHERE t.status = $1::"TicketStatus"`, [code]);
      expect(await cardValue(page, label), `${label} count`).toBe(want);
      expect(await drillDown(page, new RegExp(`^${label}: \\d+, view list$`), new RegExp(`status=${code}`)), `${label} list total`).toBe(want);
      await backToDashboard(page);
    }
    for (const [label, code] of [["Low", "LOW"], ["Medium", "MEDIUM"], ["High", "HIGH"]] as const) {
      const want = await dbCount(`SELECT count(*) n FROM "Ticket" t WHERE ${OPEN} AND t."itPriority" = $1::"Priority"`, [code]);
      const name = new RegExp(`^IT Priority ${label}: \\d+, view list$`);
      expect(await cardValue(page, `IT Priority ${label}`)).toBe(want);
      expect(await drillDown(page, name, new RegExp(`itPriority=${code}.*scope=open`))).toBe(want);
      await backToDashboard(page);
    }
  });

  test("Recently Updated, Urgent Tickets and My Open Actions items open the right Ticket and the View all counts equal the list totals", async ({ page }) => {
    const wantRecent = await dbCount(`SELECT count(*) n FROM "Ticket" t WHERE ${UPDATED_IN_WINDOW}`);
    await openDashboard(page, IT_STAFF_EMAIL);

    const recent = page.locator(".zen-dashboard__list-band", { has: page.getByRole("heading", { name: "Recently Updated" }) });
    await expect(recent.getByRole("link", { name: `View all (${wantRecent})` })).toBeVisible();
    expect(await recent.locator("ul > li").count()).toBe(Math.min(5, wantRecent));
    await recent.getByRole("link", { name: /^View all/ }).click();
    await expect(page).toHaveURL(/scope=recent/);
    expect(await listTotal(page)).toBe(wantRecent);
    await backToDashboard(page);

    // Each kind of item opens exactly the Ticket it names.
    const lists: [string, import("@playwright/test").Locator][] = [
      ["Recently Updated", recent.locator("li").first().getByRole("link").first()],
      ["Urgent Tickets", page.locator(".zen-dashboard__list-band", { has: page.getByRole("heading", { name: "Urgent Tickets" }) }).locator("li").first().getByRole("link").first()],
      ["My Open Actions", page.locator(".zen-dashboard__actions-rows li").first().getByRole("link")],
    ];
    for (const [name, link] of lists) {
      const number = (await link.innerText()).trim();
      expect(number, `${name} item names a ticket`).toMatch(/^TKT-\d{4}-\d{6}$/);
      const id = await ticketIdByNumber(number);
      await link.click();
      await expect(page, `${name} item opens the right ticket`).toHaveURL(new RegExp(`/staff/tickets/${id}$`));
      await expect(page.getByRole("heading", { name: "Ticket Details" })).toBeVisible();
      await expect(page.getByText(number).first()).toBeVisible();
      await backToDashboard(page);
    }
  });
});

// ---------------------------------------------------------------------------
// E2E-12
// ---------------------------------------------------------------------------

test.describe("E2E-12 requester dashboard and ownership (AC-02, AC-27, AC-34)", () => {
  test("Jennifer's cards and lists match My Tickets drill-downs and her own data", async ({ page }) => {
    const me = await userId(REQUESTER_EMAIL);
    const open = await dbCount(`SELECT count(*) n FROM "Ticket" t WHERE t."requesterId" = $1 AND ${OPEN}`, [me]);
    const waiting = await dbCount(`SELECT count(*) n FROM "Ticket" t WHERE t."requesterId" = $1 AND t.status = 'WAITING_FOR_REQUESTER'`, [me]);
    const recent = await dbCount(`SELECT count(*) n FROM "Ticket" t WHERE t."requesterId" = $1 AND ${UPDATED_IN_WINDOW}`, [me]);
    const resolved = await dbCount(
      `SELECT count(*) n FROM "Ticket" t WHERE t."requesterId" = $1 AND t.status IN ('RESOLVED','CLOSED')
         AND COALESCE((SELECT c."toStatus" IN ('RESOLVED','CLOSED') AND (c."changedAt" AT TIME ZONE 'UTC') >= ${WINDOW_START}
                         FROM "TicketStatusChange" c WHERE c."ticketId" = t.id ORDER BY c."changedAt" DESC, c.id DESC LIMIT 1), false)`,
      [me],
    );
    // (Waiting for Me is not asserted non-zero: earlier Lab 2/3 specs may legitimately move the seeded waiting Ticket on.)
    for (const [label, value] of Object.entries({ open, recent, resolved })) expect(value, `${label} is non-zero in the seed`).toBeGreaterThan(0);

    await openDashboard(page, REQUESTER_EMAIL);
    // Requester dashboards never show staff-only data.
    await expect(page.locator("body")).not.toContainText(/IT Priority|Owned by Me|Unassigned/);

    expect(await cardValue(page, "Open Tickets")).toBe(open);
    expect(await drillDown(page, /^Open Tickets: \d+, view list$/, /\/tickets\?.*scope=open/)).toBe(open);
    await backToDashboard(page);
    expect(await cardValue(page, "Waiting for Me")).toBe(waiting);
    expect(await drillDown(page, /^Waiting for Me: \d+, view list$/, /\/tickets\?.*status=WAITING_FOR_REQUESTER/)).toBe(waiting);
    await backToDashboard(page);

    for (const [title, want, url] of [
      ["Recently Updated", recent, /scope=recent/],
      ["Recently Resolved", resolved, /scope=recently-resolved/],
    ] as const) {
      const band = page.locator(".zen-dashboard__list-band", { has: page.getByRole("heading", { name: title }) });
      await expect(band.getByRole("link", { name: `View all (${want})` })).toBeVisible();
      expect(await band.locator("ul > li").count()).toBe(Math.min(5, want));
      await band.getByRole("link", { name: /^View all/ }).click();
      await expect(page).toHaveURL(url);
      expect(await listTotal(page), `${title} list total`).toBe(want);
      await backToDashboard(page);
    }

    // A list row opens the Ticket it names.
    const first = page.locator(".zen-dashboard__row-link").first();
    const number = (await first.innerText()).trim();
    await first.click();
    await expect(page).toHaveURL(new RegExp(`/tickets/${await ticketIdByNumber(number)}$`));
  });

  test("a pasted /tickets/:id of another Requester's Ticket is not found and leaks nothing", async ({ page }) => {
    const others = await dbRows<{ id: number; ticketNumber: string; summary: string }>(
      `SELECT t.id, t."ticketNumber", t.summary FROM "Ticket" t WHERE t."requesterId" <> $1 AND t."ticketNumber" LIKE 'TKT-2026-9000%' ORDER BY t.id LIMIT 1`,
      [await userId(REQUESTER_EMAIL)],
    );
    expect(others).toHaveLength(1);
    await loginAsSeededUser(page, REQUESTER_EMAIL);
    await page.goto(`/tickets/${others[0].id}`);
    await expect(page.getByRole("heading", { name: "Ticket not found" })).toBeVisible();
    await expect(page.locator("body")).not.toContainText(others[0].ticketNumber);
    await expect(page.locator("body")).not.toContainText(others[0].summary);
    await expect(page.getByRole("heading", { name: /^Actions Taken/ })).toHaveCount(0);
  });
});

// ---------------------------------------------------------------------------
// E2E-13
// ---------------------------------------------------------------------------

test.describe("E2E-13 administrator dashboard (AC-31, AC-15)", () => {
  test("the Users strip links to /admin/users?role=... and each list's row count equals the card value", async ({ page }) => {
    await openDashboard(page, ADMIN_EMAIL);
    const roles: [string, string, string][] = [
      ["Requesters", "REQUESTER", "Requester"],
      ["IT Staff", "IT_STAFF", "IT Staff"],
      ["Administrators", "ADMINISTRATOR", "Administrator"],
    ];
    for (const [label, role] of roles) {
      const [{ active, inactive }] = await dbRows<{ active: string; inactive: string }>(
        `SELECT count(*) FILTER (WHERE "isActive") AS active, count(*) FILTER (WHERE NOT "isActive") AS inactive FROM "User" WHERE role = $1::"Role"`,
        [role],
      );
      const total = Number(active) + Number(inactive);
      const card = page.getByRole("link", { name: `${label}: ${total}, view list` });
      await expect(card, `${label} total matches the database`).toBeVisible();
      await expect(card).toContainText(`${active} active · ${inactive} inactive`);
      await card.click();
      await expect(page).toHaveURL(new RegExp(`/admin/users\\?role=${role}$`));
      await expect(page.getByRole("heading", { name: "User Management" })).toBeVisible();
      await expect(page.locator(".zen-user-mgmt__table tbody tr").first()).toBeVisible();
      expect(await page.locator(".zen-user-mgmt__table tbody tr").count(), `${label}: rows equal the card`).toBe(total);
      await backToDashboard(page);
    }
  });

  test("IT Staff see no Users strip", async ({ page }) => {
    await openDashboard(page, IT_STAFF_EMAIL);
    await expect(page.getByRole("heading", { name: "Users" })).toHaveCount(0);
    await expect(page.getByRole("link", { name: /^Administrators:/ })).toHaveCount(0);
  });

  test("an Administrator adds an Action but has no status or owner controls", async ({ page }) => {
    const ticket = await createLab4FixtureTicket("l4-e2e13", "TKT-2026-997600", { actions: [] });
    await loginAsSeededUser(page, ADMIN_EMAIL);
    await page.goto(`/staff/tickets/${ticket.id}`);
    await expect(page.getByRole("heading", { name: "Actions Taken (0)" })).toBeVisible();
    await expect(page.locator("#staff-ticket-status")).toHaveCount(0);
    await expect(page.locator("#staff-ticket-owner")).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Claim" })).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Post comment" })).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Save internal note" })).toHaveCount(0);
    await expect(page.locator("#staff-it-priority")).toBeVisible();

    await page.getByRole("button", { name: "Add action" }).click();
    const form = page.getByRole("form", { name: "Add action" });
    await expect(form.locator(".zen-action-form__static")).toHaveText("Olivia Grant");
    await form.getByLabel("Description").fill("Reviewed the escalation with the vendor.");
    await form.getByRole("button", { name: "Save action" }).click();
    await expect(page.getByRole("heading", { name: "Actions Taken (1)" })).toBeVisible();
    const row = page.getByRole("row").filter({ hasText: "Reviewed the escalation with the vendor." });
    await expect(row).toContainText("Olivia Grant");
    await expect(row).toContainText("Administrator");
  });
});

// ---------------------------------------------------------------------------
// E2E-14
// ---------------------------------------------------------------------------

test.describe("E2E-14 zero dashboards (AC-32)", () => {
  test("Emma Fischer sees zero Owned by Me and My Open Actions with their empty messages and no errors", async ({ page }) => {
    const console_ = watchConsole(page);
    await openDashboard(page, ZERO_STAFF_EMAIL);
    expect(await cardValue(page, "Owned by Me")).toBe(0);
    expect(await cardValue(page, "My Open Actions")).toBe(0);
    await expect(page.getByRole("link", { name: "Owned by Me: 0, view list" })).toContainText("None right now");
    await expect(page.getByRole("link", { name: "My Open Actions: 0, view list" })).toContainText("None right now");
    await expect(page.getByText("You have no open actions.")).toBeVisible();
    // The zero cards still open their (empty) lists.
    expect(await drillDown(page, /^Owned by Me: 0, view list$/, /owner=me/)).toBe(0);
    await backToDashboard(page);
    await expect(page.getByRole("alert")).toHaveCount(0);
    expect(console_.errors).toEqual([]);
  });

  test("David Lee sees every card at zero and both lists empty with no errors", async ({ page }) => {
    const console_ = watchConsole(page);
    await openDashboard(page, ZERO_REQUESTER_EMAIL);
    expect(await cardValue(page, "Open Tickets")).toBe(0);
    expect(await cardValue(page, "Waiting for Me")).toBe(0);
    await expect(page.getByText("You have no open tickets.")).toBeVisible();
    await expect(page.getByText("Nothing is waiting for you.")).toBeVisible();
    await expect(page.getByText("No tickets updated in the last 7 days.")).toBeVisible();
    await expect(page.getByText("No tickets resolved in the last 7 days.")).toBeVisible();
    await expect(page.getByRole("link", { name: "View all (0)" })).toHaveCount(2);
    await expect(page.locator(".zen-dashboard__rows")).toHaveCount(0);
    await expect(page.getByRole("alert")).toHaveCount(0);
    expect(await drillDown(page, /^Open Tickets: 0, view list$/, /scope=open/)).toBe(0);
    expect(console_.errors).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// E2E-15
// ---------------------------------------------------------------------------

test.describe("E2E-15 landing and navigation per role (AC-35)", () => {
  const roles = [
    { label: "Requester", email: REQUESTER_EMAIL, nav: ["Dashboard", "My Tickets", "Create Ticket"], wrongUrl: "/staff/tickets", blockedApi: /\/api\/staff\// },
    { label: "IT Staff", email: IT_STAFF_EMAIL, nav: ["Dashboard", "Ticket Queue"], wrongUrl: "/admin/users", blockedApi: /\/api\/users/ },
    { label: "Administrator", email: ADMIN_EMAIL, nav: ["Dashboard", "Ticket Queue", "User Management"], wrongUrl: "/tickets", blockedApi: /\/api\/tickets(\?|$)/ },
  ] as const;

  for (const role of roles) {
    test(`${role.label}: login lands on the dashboard, Dashboard is first and active, the wordmark returns there, and a wrong-role URL is forbidden without a protected request`, async ({ page }) => {
      const requests: string[] = [];
      page.on("request", (request) => {
        if (request.url().includes("/api/")) requests.push(`${request.method()} ${request.url()}`);
      });

      await loginAsSeededUser(page, role.email);
      await expect(page).toHaveURL(/\/dashboard$/);
      await expect(page.getByRole("heading", { name: "Dashboard", level: 1 })).toBeVisible();

      const nav = page.getByRole("navigation", { name: "Primary" }).first();
      expect(await nav.getByRole("link").allInnerTexts()).toEqual([...role.nav]);
      await expect(nav.getByRole("link").first()).toHaveAttribute("aria-current", "page");
      await expect(nav.locator("[aria-current=page]")).toHaveCount(1);

      // On another page Dashboard is no longer current; the wordmark goes back to it.
      await nav.getByRole("link", { name: role.nav[1] }).click();
      await expect(nav.getByRole("link", { name: "Dashboard" })).not.toHaveAttribute("aria-current", "page");
      await page.locator(".zen-app-shell__wordmark").click();
      await expect(page).toHaveURL(/\/dashboard$/);
      await expect(nav.getByRole("link", { name: "Dashboard" })).toHaveAttribute("aria-current", "page");

      // A URL the role may not use: the forbidden state, a link to the dashboard, and no protected request.
      await page.goto("/dashboard");
      await expect(page.getByRole("button", { name: "Refresh" })).toBeVisible();
      requests.length = 0;
      await page.goto(role.wrongUrl);
      await expect(page.getByRole("heading", { name: "You don't have access to this page" })).toBeVisible();
      const home = page.getByRole("link", { name: "Go to Dashboard" });
      await expect(home).toHaveAttribute("href", "/dashboard");
      expect(requests.filter((r) => role.blockedApi.test(r) && !r.includes("/api/auth/")), "no protected request was issued").toEqual([]);
      await home.click();
      await expect(page).toHaveURL(/\/dashboard$/);
    });
  }

  test("signing in again from a deep link still lands on /dashboard, and / redirects there", async ({ page }) => {
    await loginAsSeededUser(page, IT_STAFF_EMAIL);
    await page.goto("/");
    await expect(page).toHaveURL(/\/dashboard$/);
  });
});

// ---------------------------------------------------------------------------
// Count tile layout (ui-spec §3.1, §8): every status tile keeps its badge and
// count on one row at every width, with no overflow.
// ---------------------------------------------------------------------------

test.describe("status count tiles keep badge and count on one row (V-11, V-12)", () => {
  for (const [name, width, height] of [["mobile", 390, 844], ["narrow", 320, 640], ["tablet", 820, 1180]] as const) {
    test(`at ${name} ${width}px`, async ({ page }) => {
      await page.setViewportSize({ width, height });
      await openDashboard(page, IT_STAFF_EMAIL);
      const tiles = page.locator(".zen-dashboard__counts--status .zen-dashboard__count-link");
      await expect(tiles).toHaveCount(8);
      const scrollOk = await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth);
      expect(scrollOk, "no horizontal page scroll").toBe(true);
      for (const tile of await tiles.all()) {
        const badge = await tile.locator(".zen-badge").boundingBox();
        const count = await tile.locator(".zen-dashboard__count-value").boundingBox();
        const label = await tile.getAttribute("aria-label");
        expect(badge && count, `${label} laid out`).toBeTruthy();
        // The count sits beside the badge: its vertical centre falls inside the badge's vertical extent.
        const countMiddle = count!.y + count!.height / 2;
        expect(countMiddle, `${label}: count shares a row with its badge`).toBeGreaterThanOrEqual(badge!.y);
        expect(countMiddle, `${label}: count shares a row with its badge`).toBeLessThanOrEqual(badge!.y + badge!.height);
        const tileBox = await tile.boundingBox();
        expect(badge!.x + badge!.width, `${label}: badge inside tile`).toBeLessThanOrEqual(tileBox!.x + tileBox!.width + 1);
      }
    });
  }
});
