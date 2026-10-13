import { expect, test, type Locator, type Page } from "@playwright/test";
import { loginAsSeededUser } from "../support/auth.js";
import {
  ADMIN_EMAIL,
  IT_STAFF_EMAIL,
  LONG_UNBROKEN,
  REQUESTER_EMAIL,
  ZERO_REQUESTER_EMAIL,
  ZERO_STAFF_EMAIL,
  bumpActionVersion,
  createLab4FixtureTicket,
  expectNoHorizontalOverflow,
  expectNothingOutsideViewport,
  type Lab4FixtureTicket,
} from "../support/lab4.js";
import { LOCAL_DEV_PASSWORD, loginAs } from "../support/auth.js";

// Lab 4 responsive rows R-01..R-05 (docs/lab-04/tests.md §2, ui-spec.md §8,
// checklist V-11, V-12, V-14). Real client + real server + `toktickit_e2e`;
// read-only seeded rows for the dashboards, own fixture Tickets (numbers
// TKT-2026-9911xx) for anything that is edited.

/** tests.md §1.3: 320 px for overflow, the three named devices, and the two breakpoints. */
const WIDTHS = [
  { name: "320", width: 320, height: 640 },
  { name: "mobile 390", width: 390, height: 844 },
  { name: "768", width: 768, height: 1024 },
  { name: "tablet 820", width: 820, height: 1180 },
  { name: "992", width: 992, height: 800 },
  { name: "desktop 1440", width: 1440, height: 900 },
] as const;

/** ui-spec.md §8: metrics 4/2/1-up (staff), 2/1-up (requester) around 992 / 768. */
function expectedStaffColumns(width: number): number {
  return width >= 992 ? 4 : width >= 768 ? 2 : 1;
}
function expectedRequesterColumns(width: number): number {
  return width >= 768 ? 2 : 1;
}

async function distinctColumns(cards: Locator): Promise<number> {
  const lefts = await cards.evaluateAll((els) =>
    els.map((el) => Math.round(el.getBoundingClientRect().left)),
  );
  return new Set(lefts).size;
}

/** No card's content is wider than the card, and no card pokes outside the viewport. */
async function expectNoClippedCards(page: Page, context: string): Promise<void> {
  const clipped = await page.evaluate(() =>
    Array.from(document.querySelectorAll<HTMLElement>(".zen-metric-card, .zen-dashboard__count-link, .zen-dashboard__list-band"))
      .filter((el) => el.scrollWidth > el.clientWidth + 1)
      .map((el) => `${el.className} (${el.scrollWidth} > ${el.clientWidth})`),
  );
  expect(clipped, `${context}: clipped cards`).toEqual([]);
  await expectNothingOutsideViewport(
    page,
    ".zen-metric-card, .zen-dashboard__count-link, .zen-dashboard__list-band",
    context,
  );
}

async function openDashboard(page: Page, email: string): Promise<void> {
  await loginAsSeededUser(page, email);
  await page.goto("/dashboard");
  await expect(page.getByRole("heading", { level: 1, name: "Dashboard" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Refresh" })).toBeVisible();
}

// ---------------------------------------------------------------------------
// R-01: Staff and Administrator dashboard
// ---------------------------------------------------------------------------

test.describe("R-01 staff and administrator dashboard reflow (AC-43, V-12)", () => {
  for (const [label, email] of [
    ["IT Staff", IT_STAFF_EMAIL],
    ["Administrator", ADMIN_EMAIL],
    ["IT Staff with all-zero metrics", ZERO_STAFF_EMAIL],
  ] as const) {
    for (const vp of WIDTHS) {
      test(`${label} at ${vp.name}px: no horizontal scroll, metrics ${expectedStaffColumns(vp.width)}-up, no clipped card`, async ({
        page,
      }) => {
        await page.setViewportSize({ width: vp.width, height: vp.height });
        await openDashboard(page, email);

        await expectNoHorizontalOverflow(page, `${label} dashboard @${vp.width}`);
        await expectNoClippedCards(page, `${label} dashboard @${vp.width}`);

        const workQueue = page.locator(".zen-dashboard__metrics--4 .zen-metric-card");
        await expect(workQueue).toHaveCount(4);
        expect(await distinctColumns(workQueue)).toBe(expectedStaffColumns(vp.width));

        // Status counts: 4x2 from 768 px, 2-up below (ui-spec.md §8).
        const statusLinks = page.locator(".zen-dashboard__counts--status .zen-dashboard__count-link");
        await expect(statusLinks).toHaveCount(8);
        expect(await distinctColumns(statusLinks)).toBe(vp.width >= 768 ? 4 : 2);

        // Lists sit side by side only from 992 px.
        const lists = page.locator(".zen-dashboard__lists > *");
        expect(await distinctColumns(lists)).toBe(vp.width >= 992 ? 2 : 1);

        if (email === ADMIN_EMAIL) {
          const users = page.locator(".zen-dashboard__metrics--3 .zen-metric-card");
          await expect(users).toHaveCount(3);
          expect(await distinctColumns(users)).toBe(vp.width >= 992 ? 3 : vp.width >= 768 ? 2 : 1);
        }
      });
    }
  }
});

// ---------------------------------------------------------------------------
// R-02: Requester dashboard
// ---------------------------------------------------------------------------

test.describe("R-02 requester dashboard reflow (AC-43, V-12)", () => {
  for (const [label, email] of [
    ["Requester", REQUESTER_EMAIL],
    ["Requester with empty lists", ZERO_REQUESTER_EMAIL],
  ] as const) {
    for (const vp of WIDTHS) {
      test(`${label} at ${vp.name}px: no horizontal scroll, two cards ${expectedRequesterColumns(vp.width)}-up, lists reflow`, async ({
        page,
      }) => {
        await page.setViewportSize({ width: vp.width, height: vp.height });
        await openDashboard(page, email);

        await expectNoHorizontalOverflow(page, `${label} dashboard @${vp.width}`);
        await expectNoClippedCards(page, `${label} dashboard @${vp.width}`);

        const cards = page.locator(".zen-dashboard__metrics .zen-metric-card");
        await expect(cards).toHaveCount(2);
        expect(await distinctColumns(cards)).toBe(expectedRequesterColumns(vp.width));

        const lists = page.locator(".zen-dashboard__lists > *");
        await expect(lists).toHaveCount(2);
        expect(await distinctColumns(lists)).toBe(vp.width >= 992 ? 2 : 1);
      });
    }
  }
});

// ---------------------------------------------------------------------------
// Fixture Tickets for R-03..R-05
// ---------------------------------------------------------------------------

let detail: Lab4FixtureTicket;
let requesterDetail: Lab4FixtureTicket;
let cancelDialog: Lab4FixtureTicket;
let closeDialog: Lab4FixtureTicket;
let staleTicket: Lab4FixtureTicket;
let blockedTicket: Lab4FixtureTicket;

test.beforeAll(async () => {
  const longActions = [
    {
      description: `Checked ${LONG_UNBROKEN} and then repeated the whole diagnostic procedure end to end across every lab machine in the building.`,
      result: `Result ${LONG_UNBROKEN} confirmed the fault after the second pass.`,
      status: "COMPLETED" as const,
      followUpNote: `Follow up on ${LONG_UNBROKEN}`,
      attachmentNotes: `Look at ${LONG_UNBROKEN}`,
    },
    { description: "Planned a driver rollout for next week.", status: "PLANNED" as const, hoursAgo: -24, assigneeEmail: ADMIN_EMAIL },
    { description: "Applying the fix.", status: "IN_PROGRESS" as const, hoursAgo: 3 },
  ];
  detail = await createLab4FixtureTicket("l4-resp-detail", "TKT-2026-991100", {
    summary: `Responsive fixture ${LONG_UNBROKEN}`,
    actions: longActions,
    history: [
      { from: "NEW", to: "OPEN", hoursAgo: 100 },
      { from: "OPEN", to: "IN_PROGRESS", hoursAgo: 90 },
    ],
  });
  requesterDetail = await createLab4FixtureTicket("l4-resp-requester", "TKT-2026-991101", {
    summary: `Requester responsive fixture ${LONG_UNBROKEN}`,
    actions: longActions,
    history: [
      { from: "NEW", to: "OPEN", hoursAgo: 100 },
      { from: "OPEN", to: "IN_PROGRESS", hoursAgo: 90 },
    ],
  });
  cancelDialog = await createLab4FixtureTicket("l4-resp-cancel", "TKT-2026-991102", {
    actions: [{ description: "Order a replacement dock.", status: "PLANNED", hoursAgo: 6 }],
  });
  closeDialog = await createLab4FixtureTicket("l4-resp-close", "TKT-2026-991103", {
    status: "RESOLVED",
    actions: [{ description: "Replaced the dock.", status: "COMPLETED" }],
    history: [{ from: "IN_PROGRESS", to: "RESOLVED", hoursAgo: 5 }],
  });
  staleTicket = await createLab4FixtureTicket("l4-resp-stale", "TKT-2026-991104", {
    actions: [{ description: "Original description.", status: "PLANNED", hoursAgo: 6 }],
  });
  blockedTicket = await createLab4FixtureTicket("l4-resp-blocked", "TKT-2026-991105", {
    actions: [
      { description: "Done part.", status: "COMPLETED" },
      { description: "Still planned part.", status: "PLANNED", hoursAgo: -6 },
    ],
  });
});

async function openStaffDetail(page: Page, ticket: Lab4FixtureTicket): Promise<void> {
  await loginAsSeededUser(page, IT_STAFF_EMAIL);
  await page.goto(`/staff/tickets/${ticket.id}`);
  await expect(page.getByRole("heading", { name: /^Actions Taken \(\d+\)$/ })).toBeVisible();
}

// ---------------------------------------------------------------------------
// R-03: Staff Ticket Detail, Actions Taken
// ---------------------------------------------------------------------------

test.describe("R-03 staff ticket detail Actions Taken (AC-37, AC-43)", () => {
  for (const vp of WIDTHS) {
    test(`at ${vp.name}px: ${vp.width >= 768 ? "table" : "stacked cards"}, no overflow, usable form`, async ({
      page,
    }) => {
      await page.setViewportSize({ width: vp.width, height: vp.height });
      await openStaffDetail(page, detail);

      const table = page.locator("table.zen-actions__table");
      const cards = page.locator("ul.zen-actions__cards");
      if (vp.width >= 768) {
        await expect(table).toBeVisible();
        await expect(cards).toHaveCount(0);
        await expect(table.locator("caption")).toHaveText(`Actions taken on ${detail.ticketNumber}`);
      } else {
        await expect(cards).toBeVisible();
        await expect(table).toHaveCount(0);
      }
      await expectNoHorizontalOverflow(page, `staff detail list @${vp.width}`);

      // Long text is clamped and carries the full text in `title` (ui-spec.md §8).
      const clamp = page.locator(".zen-actions__clamp").first();
      await expect(clamp).toHaveAttribute("title", /Unbreakable/);

      // View mode with every field, long unbroken text included.
      await page.getByRole("button", { name: /^View action from/ }).first().click();
      await expect(page.getByText("Logged at")).toBeVisible();
      await expectNoHorizontalOverflow(page, `staff detail view @${vp.width}`);

      // Row buttons: >= 44 px on mobile (ui-spec.md §5.1).
      if (vp.width < 768) {
        const buttons = page.locator(".zen-actions__item .zen-actions__buttons .zen-btn");
        const sizes = await buttons.evaluateAll((els) =>
          els.map((el) => {
            const r = el.getBoundingClientRect();
            return { text: el.textContent, w: r.width, h: r.height };
          }),
        );
        expect(sizes.length).toBeGreaterThan(0);
        for (const size of sizes) {
          expect(size.h, `${size.text} button height`).toBeGreaterThanOrEqual(44);
          expect(size.w, `${size.text} button width`).toBeGreaterThanOrEqual(44);
        }
      }

      // The create form is usable: every field and both buttons are reachable inside the viewport.
      await page.getByRole("button", { name: "Add action" }).click();
      const form = page.getByRole("form", { name: "Add action" });
      await expect(form).toBeVisible();
      for (const field of ["Action date/time", "Status", "Assignee", "Description", "Result", "Attachment notes"]) {
        const control = form.getByLabel(field, { exact: false }).first();
        await control.scrollIntoViewIfNeeded();
        const box = await control.boundingBox();
        expect(box, `${field} has a box`).not.toBeNull();
        expect(box!.x, `${field} left edge`).toBeGreaterThanOrEqual(0);
        expect(box!.x + box!.width, `${field} right edge`).toBeLessThanOrEqual(vp.width + 1);
      }
      await form.getByLabel("Description").fill(`Typing ${LONG_UNBROKEN} into the box`);
      await form.getByLabel("Follow-up required?").check();
      await expect(form.getByLabel("Follow-up note", { exact: false })).toBeVisible();
      await expectNoHorizontalOverflow(page, `staff detail form @${vp.width}`);

      const save = form.getByRole("button", { name: "Save action" });
      const cancel = form.getByRole("button", { name: "Cancel" });
      await save.scrollIntoViewIfNeeded();
      const saveBox = (await save.boundingBox())!;
      const cancelBox = (await cancel.boundingBox())!;
      expect(saveBox.height).toBeGreaterThanOrEqual(vp.width < 768 ? 44 : 30);
      expect(saveBox.x + saveBox.width).toBeLessThanOrEqual(vp.width + 1);
      expect(cancelBox.x + cancelBox.width).toBeLessThanOrEqual(vp.width + 1);
      if (vp.width < 768) {
        // Mobile: buttons are full width with the primary on top (ui-spec.md §8).
        expect(saveBox.y).toBeLessThan(cancelBox.y);
        expect(saveBox.width).toBeGreaterThan(vp.width * 0.6);
      }
    });
  }

  test("the Status history card also reflows without overflow at 320 px", async ({ page }) => {
    await page.setViewportSize({ width: 320, height: 640 });
    await openStaffDetail(page, detail);
    await expect(page.getByRole("heading", { name: "Status history" })).toBeVisible();
    await expectNoHorizontalOverflow(page, "staff detail status history @320");
  });
});

// ---------------------------------------------------------------------------
// R-04: Requester Ticket Detail
// ---------------------------------------------------------------------------

test.describe("R-04 requester ticket detail (AC-43, AC-39)", () => {
  for (const vp of WIDTHS) {
    test(`at ${vp.name}px: read-only Actions and history reflow with no overflow`, async ({ page }) => {
      await page.setViewportSize({ width: vp.width, height: vp.height });
      await loginAs(page, requesterDetail.requester.email, LOCAL_DEV_PASSWORD);
      await page.goto(`/tickets/${requesterDetail.id}`);
      await expect(page.getByRole("heading", { name: /^Actions Taken \(\d+\)$/i })).toBeVisible();
      await expect(page.getByRole("heading", { name: "Status history" })).toBeVisible();

      if (vp.width >= 768) {
        await expect(page.locator("table.zen-actions__table")).toBeVisible();
      } else {
        await expect(page.locator("ul.zen-actions__cards")).toBeVisible();
      }
      await expectNoHorizontalOverflow(page, `requester detail @${vp.width}`);

      // Read-only: no write controls (V-15), View still expands.
      await expect(page.getByRole("button", { name: "Add action" })).toHaveCount(0);
      await expect(page.getByRole("button", { name: /^Edit action/ })).toHaveCount(0);
      await page.getByRole("button", { name: /^View action from/ }).first().click();
      await expect(page.getByText("Follow-up note").first()).toBeVisible();
      await expectNoHorizontalOverflow(page, `requester detail view @${vp.width}`);
    });
  }
});

// ---------------------------------------------------------------------------
// R-05: dialogs and callouts
// ---------------------------------------------------------------------------

/** The dialog fills the viewport edge to edge on mobile (a full-screen sheet), and is a bounded card otherwise. */
async function expectSheetOrCard(page: Page, width: number, height: number): Promise<void> {
  const dialog = page.getByRole("dialog");
  await expect(dialog).toBeVisible();
  const box = (await dialog.boundingBox())!;
  if (width < 768) {
    expect(box.x, "sheet left").toBeLessThanOrEqual(1);
    expect(box.width, "sheet width").toBeGreaterThanOrEqual(width - 1);
    expect(box.height, "sheet height").toBeGreaterThanOrEqual(height - 1);
    for (const button of await dialog.getByRole("button").all()) {
      const b = (await button.boundingBox())!;
      expect(b.height, "dialog button height").toBeGreaterThanOrEqual(44);
      expect(b.x + b.width).toBeLessThanOrEqual(width + 1);
    }
  } else {
    expect(box.x).toBeGreaterThanOrEqual(0);
    expect(box.x + box.width).toBeLessThanOrEqual(width + 1);
  }
  await expectNoHorizontalOverflow(page, `dialog @${width}`);
}

/** No visible control intersects `callout`'s box. */
async function expectNoOverlap(page: Page, callout: Locator, context: string): Promise<void> {
  const overlaps = await callout.evaluate((el) => {
    const a = el.getBoundingClientRect();
    return Array.from(
      document.querySelectorAll<HTMLElement>("button, input, select, textarea, a[href]"),
    )
      .filter((c) => !el.contains(c))
      .map((c) => ({ c, r: c.getBoundingClientRect() }))
      .filter(
        ({ r }) =>
          r.width > 0 && r.height > 0 &&
          r.left < a.right && r.right > a.left && r.top < a.bottom && r.bottom > a.top,
      )
      .map(({ c }) => `${c.tagName.toLowerCase()} "${(c.getAttribute("aria-label") ?? c.textContent ?? "").trim().slice(0, 40)}"`);
  });
  expect(overlaps, `${context}: controls overlapped by the callout`).toEqual([]);
}

test.describe("R-05 dialogs and callouts (AC-43, V-14)", () => {
  for (const vp of WIDTHS) {
    test(`at ${vp.name}px: Cancel-action dialog`, async ({ page }) => {
      await page.setViewportSize({ width: vp.width, height: vp.height });
      await openStaffDetail(page, cancelDialog);
      await page.getByRole("button", { name: /^Edit action from/ }).click();
      const form = page.getByRole("form", { name: "Edit action" });
      await form.getByLabel("Status").selectOption("CANCELLED");
      await form.getByRole("button", { name: "Save action" }).click();
      await expect(page.getByRole("dialog", { name: "Cancel this action?" })).toBeVisible();
      await expectSheetOrCard(page, vp.width, vp.height);
    });

    test(`at ${vp.name}px: Close-ticket dialog`, async ({ page }) => {
      await page.setViewportSize({ width: vp.width, height: vp.height });
      await openStaffDetail(page, closeDialog);
      await page.locator("#staff-ticket-status").selectOption("CLOSED");
      await expect(page.getByRole("dialog", { name: "Close this ticket?" })).toBeVisible();
      await expectSheetOrCard(page, vp.width, vp.height);
    });
  }

  for (const vp of [WIDTHS[0], WIDTHS[1], WIDTHS[3], WIDTHS[5]]) {
    test(`at ${vp.name}px: the stale callout does not overlap the form controls`, async ({ page }) => {
      await page.setViewportSize({ width: vp.width, height: vp.height });
      await openStaffDetail(page, staleTicket);
      await page.getByRole("button", { name: /^Edit action from/ }).click();
      const form = page.getByRole("form", { name: "Edit action" });
      await form.getByLabel("Description").fill("My edit while someone else saved.");
      await bumpActionVersion(staleTicket.actionIds[0]);
      await form.getByRole("button", { name: "Save action" }).click();
      const callout = form.getByRole("alert").filter({ hasText: "This action was changed by" });
      await expect(callout).toBeVisible();
      await expect(form.getByLabel("Description")).toHaveValue("My edit while someone else saved.");
      await expectNoOverlap(page, callout, `stale callout @${vp.width}`);
      await expectNoHorizontalOverflow(page, `stale callout @${vp.width}`);
    });

    test(`at ${vp.name}px: the resolution-blocked callout does not overlap the controls`, async ({ page }) => {
      await page.setViewportSize({ width: vp.width, height: vp.height });
      await openStaffDetail(page, blockedTicket);
      await page.locator("#staff-ticket-status").selectOption("RESOLVED");
      const callout = page.getByRole("alert").filter({ hasText: "can't be resolved yet" });
      await expect(callout).toBeVisible();
      await expectNoOverlap(page, callout, `blocked callout @${vp.width}`);
      await expectNoHorizontalOverflow(page, `blocked callout @${vp.width}`);
    });
  }
});
