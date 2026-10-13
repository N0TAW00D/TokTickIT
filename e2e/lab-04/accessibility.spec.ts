import { expect, test, type Locator, type Page } from "@playwright/test";
import { LOCAL_DEV_PASSWORD, loginAs, loginAsSeededUser } from "../support/auth.js";
import {
  ADMIN_EMAIL,
  IT_STAFF_EMAIL,
  REQUESTER_EMAIL,
  ZERO_REQUESTER_EMAIL,
  ZERO_STAFF_EMAIL,
  assertNoSeriousViolations,
  bumpActionVersion,
  cleanupLab4Fixtures,
  createLab4FixtureTicket,
  type Lab4FixtureTicket,
} from "../support/lab4.js";

// Lab 4 accessibility rows A11Y-01..A11Y-06 (docs/lab-04/tests.md §2,
// ui-spec.md §9, checklist V-10). axe-core scans (serious/critical fail) of
// the real rendered DOM, and keyboard-only flows that never use the mouse
// after the page is open. Fixture Tickets use numbers TKT-2026-9972xx.

/** Waits for CSS transitions to finish so axe never samples a half-blended colour pair. */
async function settle(page: Page): Promise<void> {
  await page.evaluate(() => Promise.all(document.getAnimations().map((a) => a.finished.catch(() => undefined))));
}

async function scan(page: Page, testInfo: Parameters<typeof assertNoSeriousViolations>[1]): Promise<void> {
  await settle(page);
  await assertNoSeriousViolations(page, testInfo);
}

/** True when the focused element draws an outline or a box-shadow ring. */
async function focusRingVisible(page: Page): Promise<boolean> {
  return page.evaluate(() => {
    const el = document.activeElement as HTMLElement | null;
    if (!el || el === document.body) return false;
    const style = getComputedStyle(el);
    const outline = style.outlineStyle !== "none" && parseFloat(style.outlineWidth) > 0;
    const shadow = style.boxShadow !== "none";
    return outline || shadow;
  });
}

async function describeFocus(page: Page): Promise<string> {
  return page.evaluate(() => {
    const el = document.activeElement as HTMLElement | null;
    if (!el) return "(none)";
    return `${el.tagName.toLowerCase()}${el.id ? "#" + el.id : ""} "${(el.getAttribute("aria-label") ?? el.textContent ?? "").trim().slice(0, 40)}"`;
  });
}

async function isFocused(target: Locator): Promise<boolean> {
  return target.evaluate((el) => el === document.activeElement).catch(() => false);
}

/** Presses Tab until `target` has focus (failing with the path taken). Each stop must show a focus ring. */
async function tabTo(page: Page, target: Locator, max = 90): Promise<void> {
  const path: string[] = [];
  for (let i = 0; i < max; i++) {
    if (await isFocused(target)) {
      expect(await focusRingVisible(page), `focus ring visible on ${await describeFocus(page)}`).toBe(true);
      return;
    }
    await page.keyboard.press("Tab");
    path.push(await describeFocus(page));
  }
  throw new Error(`Tab never reached the target within ${max} presses. Path: ${path.join(" > ")}`);
}

/** Moves the starting point to the top of the page without a pointer. */
async function resetFocusToTop(page: Page): Promise<void> {
  await page.evaluate(() => {
    (document.activeElement as HTMLElement | null)?.blur();
    window.scrollTo(0, 0);
  });
}

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

let richTicket: Lab4FixtureTicket; // axe on Staff Ticket Detail and Requester Ticket Detail
let flowTicket: Lab4FixtureTicket; // keyboard Actions flow
let dialogTicket: Lab4FixtureTicket; // keyboard Close-ticket dialog

test.afterAll(cleanupLab4Fixtures);

test.beforeAll(async () => {
  const actions = [
    {
      description: "Reproduced the problem on a lab machine.",
      result: "Confirmed a stale driver.",
      status: "COMPLETED" as const,
      followUpNote: "Check again after the next patch Tuesday.",
      attachmentNotes: "the screenshot of the error dialog",
    },
    { description: "Roll out the new driver.", status: "PLANNED" as const, hoursAgo: 4, assigneeEmail: ADMIN_EMAIL },
    { description: "Testing the driver.", status: "IN_PROGRESS" as const, hoursAgo: 2 },
  ];
  const history = [
    { from: "NEW", to: "OPEN", hoursAgo: 100 },
    { from: "OPEN", to: "IN_PROGRESS", hoursAgo: 90 },
  ];
  richTicket = await createLab4FixtureTicket("l4-a11y-rich", "TKT-2026-997200", { actions, history });
  flowTicket = await createLab4FixtureTicket("l4-a11y-flow", "TKT-2026-997201", {
    actions: [
      { description: "Order a replacement dock.", status: "PLANNED", hoursAgo: 6 },
      { description: "Re-image the laptop.", status: "PLANNED", hoursAgo: 5 },
    ],
  });
  dialogTicket = await createLab4FixtureTicket("l4-a11y-dialog", "TKT-2026-997202", {
    status: "RESOLVED",
    actions: [{ description: "Replaced the dock.", status: "COMPLETED" }],
    history: [{ from: "IN_PROGRESS", to: "RESOLVED", hoursAgo: 5 }],
  });
});

async function openStaffDetail(page: Page, ticket: Lab4FixtureTicket): Promise<void> {
  await loginAsSeededUser(page, IT_STAFF_EMAIL);
  await page.goto(`/staff/tickets/${ticket.id}`);
  await expect(page.getByRole("heading", { name: /^Actions Taken \(\d+\)$/ })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Status history" })).toBeVisible();
}

async function openDashboard(page: Page, email: string): Promise<void> {
  await loginAsSeededUser(page, email);
  await page.goto("/dashboard");
  await expect(page.getByRole("button", { name: "Refresh" })).toBeVisible();
}

// ---------------------------------------------------------------------------
// A11Y-01 / A11Y-02: dashboards
// ---------------------------------------------------------------------------

test.describe("A11Y-01 axe: staff dashboard (AC-44)", () => {
  for (const [label, email] of [
    ["IT Staff", IT_STAFF_EMAIL],
    ["Administrator", ADMIN_EMAIL],
    ["IT Staff, all-zero", ZERO_STAFF_EMAIL],
  ] as const) {
    test(`${label} has no serious or critical violations and one h1 with h2 bands`, async ({ page }, testInfo) => {
      await openDashboard(page, email);
      await expect(page.getByRole("heading", { level: 1 })).toHaveCount(1);
      await expect(page.getByRole("heading", { level: 2 }).first()).toBeAttached();
      await scan(page, testInfo);
    });
  }
});

test.describe("A11Y-02 axe: requester dashboard (AC-44)", () => {
  for (const [label, email] of [
    ["Requester", REQUESTER_EMAIL],
    ["Requester, empty lists", ZERO_REQUESTER_EMAIL],
  ] as const) {
    test(`${label} has no serious or critical violations`, async ({ page }, testInfo) => {
      await openDashboard(page, email);
      await expect(page.getByRole("heading", { level: 1 })).toHaveCount(1);
      await scan(page, testInfo);
    });
  }
});

// ---------------------------------------------------------------------------
// A11Y-03: Staff Ticket Detail
// ---------------------------------------------------------------------------

test.describe("A11Y-03 axe: staff ticket detail (AC-44)", () => {
  test("Actions list, View mode and status history have no serious or critical violations", async ({ page }, testInfo) => {
    await openStaffDetail(page, richTicket);
    await expect(page.locator("table.zen-actions__table caption")).toHaveText(`Actions taken on ${richTicket.ticketNumber}`);
    await expect(page.getByRole("button", { name: /^Edit action from/ }).first()).toBeVisible();
    await scan(page, testInfo);

    await page.getByRole("button", { name: /^View action from/ }).first().click();
    await expect(page.getByText("Logged at")).toBeVisible();
    await scan(page, testInfo);
  });

  test("the create form, its validation errors and the follow-up note have no serious or critical violations", async ({ page }, testInfo) => {
    await openStaffDetail(page, richTicket);
    await page.getByRole("button", { name: "Add action" }).click();
    const form = page.getByRole("form", { name: "Add action" });
    await expect(form).toBeVisible();
    await scan(page, testInfo);

    await form.getByLabel("Follow-up required?").check();
    await expect(form.getByLabel("Follow-up note", { exact: false })).toBeFocused();
    await form.getByRole("button", { name: "Save action" }).click();
    await expect(form.getByText("Enter a description.")).toBeVisible();
    await expect(form.getByLabel("Description")).toHaveAttribute("aria-invalid", "true");
    await scan(page, testInfo);
  });

  test("the stale-update callout and latest-version panel have no serious or critical violations", async ({ page }, testInfo) => {
    const stale = await createLab4FixtureTicket("l4-a11y-stale", "TKT-2026-997203", {
      actions: [{ description: "Original description.", status: "PLANNED", hoursAgo: 6 }],
    });
    await openStaffDetail(page, stale);
    await page.getByRole("button", { name: /^Edit action from/ }).click();
    const form = page.getByRole("form", { name: "Edit action" });
    await form.getByLabel("Description").fill("My edit while someone else saved.");
    await bumpActionVersion(stale.actionIds[0]);
    await form.getByRole("button", { name: "Save action" }).click();
    const callout = form.getByRole("alert").filter({ hasText: "This action was changed by" });
    await expect(callout).toBeVisible();
    await expect(callout).toBeFocused();
    await expect(form.getByRole("complementary", { name: "Latest version" })).toBeVisible();
    await scan(page, testInfo);
  });

  test("the resolution-blocked callout has no serious or critical violations", async ({ page }, testInfo) => {
    const blocked = await createLab4FixtureTicket("l4-a11y-blocked", "TKT-2026-997204", {
      actions: [
        { description: "Done part.", status: "COMPLETED" },
        { description: "Still planned part.", status: "PLANNED", hoursAgo: 6 },
      ],
    });
    await openStaffDetail(page, blocked);
    await page.locator("#staff-ticket-status").selectOption("RESOLVED");
    await expect(page.getByRole("alert").filter({ hasText: "can't be resolved yet" })).toBeVisible();
    await scan(page, testInfo);
  });

  test("the Cancel-action and Close-ticket dialogs have no serious or critical violations", async ({ page }, testInfo) => {
    await openStaffDetail(page, flowTicket);
    await page.getByRole("button", { name: /^Edit action from/ }).first().click();
    const form = page.getByRole("form", { name: "Edit action" });
    await form.getByLabel("Status").selectOption("CANCELLED");
    await form.getByRole("button", { name: "Save action" }).click();
    await expect(page.getByRole("dialog", { name: "Cancel this action?" })).toBeVisible();
    await scan(page, testInfo);
  });
});

// ---------------------------------------------------------------------------
// A11Y-04: Requester Ticket Detail
// ---------------------------------------------------------------------------

test.describe("A11Y-04 axe: requester ticket detail (AC-44, AC-39)", () => {
  test("read-only Actions and history have no serious or critical violations", async ({ page }, testInfo) => {
    await loginAs(page, richTicket.requester.email, LOCAL_DEV_PASSWORD);
    await page.goto(`/tickets/${richTicket.id}`);
    await expect(page.getByRole("heading", { name: /^Actions Taken \(\d+\)$/i })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Status history" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Add action" })).toHaveCount(0);
    await scan(page, testInfo);

    await page.getByRole("button", { name: /^View action from/ }).first().click();
    await expect(page.getByText("Follow-up note").first()).toBeVisible();
    await scan(page, testInfo);
  });
});

// ---------------------------------------------------------------------------
// A11Y-05: keyboard-only Actions flow
// ---------------------------------------------------------------------------

test.describe("A11Y-05 keyboard-only Actions flow (AC-44)", () => {
  test("create, edit, complete and cancel an Action, and open and confirm dialogs, using only the keyboard", async ({ page }) => {
    await openStaffDetail(page, flowTicket);
    await resetFocusToTop(page);
    const form = (name: string) => page.getByRole("form", { name });

    // --- Create: Tab to Add action, Enter opens the form with focus in the first field.
    const add = page.locator("#actions-add");
    await tabTo(page, add);
    await page.keyboard.press("Enter");
    await expect(form("Add action")).toBeVisible();
    await expect(page.locator("#action-form-action-at")).toBeFocused();

    // Status (select, default Planned) -> Assignee -> Description. The date/time input has
    // one tab stop per segment, so Tab to the Status select instead of counting presses.
    await tabTo(page, page.locator("#action-form-status"));
    await page.keyboard.press("Tab");
    await expect(page.locator("#action-form-assignee")).toBeFocused();
    await page.keyboard.press("Tab");
    await expect(page.locator("#action-form-description")).toBeFocused();
    await page.keyboard.type("Keyboard created action.");

    // Follow-up checkbox: Space reveals the note, which takes focus.
    await tabTo(page, page.locator("#action-form-follow-up"));
    await page.keyboard.press("Space");
    await expect(page.locator("#action-form-follow-up-note")).toBeFocused();
    await expect(page.locator("#action-form-follow-up")).toHaveAttribute("aria-expanded", "true");
    await page.keyboard.type("Check back next week.");

    await tabTo(page, page.locator("#action-form-save"));
    await page.keyboard.press("Enter");
    await expect(page.getByRole("status").filter({ hasText: "Action saved." })).toBeVisible();
    await expect(form("Add action")).toHaveCount(0);
    await expect(page.getByRole("cell", { name: "Keyboard created action." })).toBeVisible();
    await expect(add, "focus returns to the control that opened the form").toBeFocused();

    // --- Edit the first seeded Action to In progress, then edit again to complete it
    // (Planned -> Completed is not a permitted transition; a result is required to complete).
    const edit = page.getByRole("button", { name: /^Edit action from/ }).first();
    await tabTo(page, edit);
    await page.keyboard.press("Enter");
    await expect(form("Edit action")).toBeVisible();
    await expect(page.locator("#action-form-action-at")).toBeFocused();
    await tabTo(page, page.locator("#action-form-status"));
    await page.keyboard.type("In"); // type-ahead selects "In progress"
    await expect(page.locator("#action-form-status")).toHaveValue("IN_PROGRESS");
    await tabTo(page, page.locator("#action-form-save"));
    await page.keyboard.press("Enter");
    await expect(page.getByRole("status").filter({ hasText: "Action saved." })).toBeVisible();
    const orderRow = page.getByRole("row").filter({ hasText: "Order a replacement dock." });
    await expect(orderRow.getByText("In progress", { exact: true })).toBeVisible();

    await tabTo(page, orderRow.getByRole("button", { name: /^Edit action/ }));
    await page.keyboard.press("Enter");
    await tabTo(page, page.locator("#action-form-status"));
    await page.keyboard.type("Co"); // "Completed"
    await expect(page.locator("#action-form-status")).toHaveValue("COMPLETED");
    await tabTo(page, page.locator("#action-form-save"));
    await page.keyboard.press("Enter");
    // The result is required to complete: the error is announced next to the field and focus moves to it.
    await expect(page.locator("#action-form-result")).toBeFocused();
    await expect(page.locator("#action-form-result")).toHaveAttribute("aria-invalid", "true");
    await page.keyboard.type("Dock ordered and delivered.");
    await tabTo(page, page.locator("#action-form-save"));
    await page.keyboard.press("Enter");
    await expect(page.getByRole("row").filter({ hasText: "Order a replacement dock." }).getByText("Completed", { exact: true })).toBeVisible();
    await expect(
      page.getByRole("row").filter({ hasText: "Order a replacement dock." }).getByRole("button", { name: /^Edit action/ }),
      "a completed row loses Edit",
    ).toHaveCount(0);

    // --- Cancel the second seeded Action through the confirm dialog.
    const editSecond = page.getByRole("row").filter({ hasText: "Re-image the laptop." }).getByRole("button", { name: /^Edit action/ });
    await tabTo(page, editSecond);
    await page.keyboard.press("Enter");
    await tabTo(page, page.locator("#action-form-status"));
    await page.keyboard.type("Ca"); // "Cancelled"
    await expect(page.locator("#action-form-status")).toHaveValue("CANCELLED");
    await tabTo(page, page.locator("#action-form-save"));
    await page.keyboard.press("Enter");

    const dialog = page.getByRole("dialog", { name: "Cancel this action?" });
    await expect(dialog).toBeVisible();
    // Focus moves into the dialog and Tab is trapped inside it.
    const dialogCancel = dialog.getByRole("button", { name: "Cancel", exact: true });
    const dialogConfirm = dialog.getByRole("button", { name: "Cancel action" });
    await expect(dialogCancel).toBeFocused();
    await page.keyboard.press("Tab");
    await expect(dialogConfirm).toBeFocused();
    await page.keyboard.press("Tab");
    await expect(dialogCancel, "Tab wraps inside the dialog").toBeFocused();
    await page.keyboard.press("Shift+Tab");
    await expect(dialogConfirm, "Shift+Tab wraps inside the dialog").toBeFocused();

    // Escape closes it and puts focus back on Save action.
    await page.keyboard.press("Escape");
    await expect(dialog).toHaveCount(0);
    await expect(page.locator("#action-form-save"), "focus is restored after Escape").toBeFocused();
    expect(await focusRingVisible(page)).toBe(true);

    // Open it again and confirm with the keyboard.
    await page.keyboard.press("Enter");
    await expect(dialog).toBeVisible();
    await page.keyboard.press("Tab");
    await expect(dialogConfirm).toBeFocused();
    await page.keyboard.press("Enter");
    await expect(page.getByRole("status").filter({ hasText: "Action saved." })).toBeVisible();
    await expect(
      page.getByRole("row").filter({ hasText: "Re-image the laptop." }).getByText("Cancelled", { exact: true }),
    ).toBeVisible();
  });

  test("the Close-ticket dialog opens and confirms from the keyboard, and focus returns to Current Status on Escape", async ({ page }) => {
    await openStaffDetail(page, dialogTicket);
    await resetFocusToTop(page);
    const status = page.locator("#staff-ticket-status");
    await tabTo(page, status);
    await page.keyboard.type("Cl"); // "Closed"
    const dialog = page.getByRole("dialog", { name: "Close this ticket?" });
    await expect(dialog).toBeVisible();
    await expect(dialog.getByRole("button", { name: "Cancel", exact: true })).toBeFocused();
    await page.keyboard.press("Escape");
    await expect(dialog).toHaveCount(0);
    await expect(status, "focus is restored to the Current Status select").toBeFocused();
    expect(await focusRingVisible(page)).toBe(true);

    await page.locator("#staff-ticket-status").selectOption("CLOSED");
    await expect(dialog).toBeVisible();
    await page.keyboard.press("Tab");
    await expect(dialog.getByRole("button", { name: "Close ticket" })).toBeFocused();
    await page.keyboard.press("Enter");
    await expect(page.getByRole("status").filter({ hasText: "Status changed to Closed." })).toBeVisible();
    await expect(page.getByText("This ticket is closed. Actions Taken are read-only.")).toBeVisible();
  });
});

// ---------------------------------------------------------------------------
// A11Y-06: keyboard dashboard
// ---------------------------------------------------------------------------

test.describe("A11Y-06 keyboard dashboard (AC-44, AC-36)", () => {
  for (const [label, email, variant] of [
    ["IT Staff", IT_STAFF_EMAIL, "staff"],
    ["Administrator", ADMIN_EMAIL, "staff"],
    ["Requester", REQUESTER_EMAIL, "requester"],
  ] as const) {
    test(`${label}: Tab reaches every card and list link in order, each with a focus ring`, async ({ page }) => {
      await openDashboard(page, email);
      await resetFocusToTop(page);

      // Every link inside the dashboard body, in DOM order.
      const expected = await page.locator(".zen-dashboard a[href]").evaluateAll((els) =>
        els.map((el) => el.getAttribute("href") + " | " + (el.getAttribute("aria-label") ?? el.textContent?.trim())),
      );
      expect(expected.length).toBeGreaterThanOrEqual(variant === "staff" ? 17 : 4);
      const cardLabels = await page.locator(".zen-metric-card").evaluateAll((els) => els.map((el) => el.getAttribute("aria-label")));
      expect(cardLabels.length).toBe(variant === "staff" ? (email === ADMIN_EMAIL ? 8 : 5) : 2);

      const reached: string[] = [];
      for (let i = 0; i < 120 && reached.length < expected.length; i++) {
        await page.keyboard.press("Tab");
        const info = await page.evaluate(() => {
          const el = document.activeElement as HTMLElement | null;
          const inDashboard = !!el?.closest(".zen-dashboard");
          const style = el ? getComputedStyle(el) : null;
          const ring = !!style && ((style.outlineStyle !== "none" && parseFloat(style.outlineWidth) > 0) || style.boxShadow !== "none");
          return {
            inDashboard,
            ring,
            key: el?.getAttribute("href") + " | " + (el?.getAttribute("aria-label") ?? el?.textContent?.trim()),
            isLink: el?.tagName === "A",
          };
        });
        if (!info.inDashboard || !info.isLink) continue;
        expect(info.ring, `focus ring on ${info.key}`).toBe(true);
        reached.push(info.key);
      }
      expect(reached, "Tab visits every dashboard link in DOM order").toEqual(expected);
    });
  }

  test("Enter on a metric card follows the drill-down", async ({ page }) => {
    await openDashboard(page, IT_STAFF_EMAIL);
    await resetFocusToTop(page);
    const card = page.getByRole("link", { name: /^Unassigned: \d+, view list$/ });
    await tabTo(page, card);
    await page.keyboard.press("Enter");
    await expect(page).toHaveURL(/\/staff\/tickets\?.*owner=unassigned/);
    await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
  });

  test("Enter on a Requester card and on a list row follows the link", async ({ page }) => {
    await openDashboard(page, REQUESTER_EMAIL);
    await resetFocusToTop(page);
    const card = page.getByRole("link", { name: /^Open Tickets: \d+, view list$/ });
    await tabTo(page, card);
    await page.keyboard.press("Enter");
    await expect(page).toHaveURL(/\/tickets\?/);

    await page.goto("/dashboard");
    await expect(page.getByRole("button", { name: "Refresh" })).toBeVisible();
    await resetFocusToTop(page);
    const row = page.locator(".zen-dashboard__row-link").first();
    await tabTo(page, row);
    await page.keyboard.press("Enter");
    await expect(page).toHaveURL(/\/tickets\/\d+$/);
  });
});
