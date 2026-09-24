import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { expect, test, type Page } from "@playwright/test";
import { loginAsSeededUser } from "../support/auth.js";
import { createRequesterOwnedFixtureTicket } from "../support/staffFixtures.js";

// Responsive + screenshot-evidence harness for Lab 3 (docs/lab-03/tests.md
// §2.8 R-01..R-06, Issue #74). Follows `e2e/lab-02/responsive.spec.ts`'s
// structure and conventions directly (viewport matrix, the
// `scrollWidth <= clientWidth` no-overflow check, the screenshot-to-
// `artifacts/` pattern, and the Tab-traversal focus-ring check) rather than
// reinventing them — see that file for the fuller rationale behind each
// pattern reused here.
//
// The screenshots this file takes at `R-06` ARE Issue #74's screenshot
// deliverable, not a separate manual step (docs/lab-03/ui-spec.md §15,
// docs/lab-03/tests.md §4).
//
// Every test drives the REAL client against the REAL server + the
// dedicated `toktickit_e2e` Postgres database (see ../playwright.config.ts)
// — no mocked responses, no stubbed components. Logging in as anyone other
// than a Requester deliberately does NOT rely on the post-login redirect:
// `e2e/support/auth.ts`'s own comment documents that a successful login
// always redirects to the hardcoded `"/"` route, which resolves to the
// Requester-only `/tickets` route regardless of the caller's real role —
// landing a non-Requester on the forbidden state instead of their own
// role's landing page. Every Lab 3 spec file (staff-ticket-flow.spec.ts,
// user-administration.spec.ts) works around this the same way this file
// does: sign in via `loginAsSeededUser`, then `page.goto` the target route
// directly.

const here = path.dirname(fileURLToPath(import.meta.url));

// docs/lab-03/ui-spec.md §15 / tests.md §4: screenshots committed under
// these four folders. `here` is e2e/lab-03, so the repo root is two levels
// up.
const SCREENSHOT_ROOT = path.resolve(here, "../../artifacts/lab-03/screenshots");

/**
 * docs/lab-03/tests.md §1.5 "Viewport matrix": "Desktop 1440×900, tablet
 * 820×1180, mobile 390×844 — the Lab 2 matrix, unchanged." (heights differ
 * slightly from Lab 2's own file — this is the exact Lab 3 matrix, not a
 * re-derivation.)
 */
const VIEWPORTS = {
  desktop: { width: 1440, height: 900 },
  tablet: { width: 820, height: 1180 },
  mobile: { width: 390, height: 844 },
} as const;

type ViewportName = keyof typeof VIEWPORTS;
const VIEWPORT_NAMES: ViewportName[] = ["desktop", "tablet", "mobile"];

// The four screens/folders this dispatch covers (Issue #74's screenshot
// requirement + docs/lab-03/tests.md §2.8's R-01..R-06 rows) — one per
// ui-spec.md section: §5 Login, §9 IT Staff Ticket Queue, §10 IT Staff
// Ticket Detail, §11 Administrator User Management.
const SCREENS = [
  "authentication",
  "staff-queue",
  "staff-ticket-detail",
  "user-management",
] as const;
type ScreenName = (typeof SCREENS)[number];

// server/prisma/seed.ts SEED_ACTIVE_IT_STAFF / SEED_ADMINISTRATORS — same
// accounts e2e/lab-03/staff-ticket-flow.spec.ts and
// e2e/lab-03/user-administration.spec.ts already log in as.
const IT_STAFF_EMAIL = "priya.natarajan@example.edu";
const ADMIN_EMAIL = "olivia.grant@example.edu";

// Own ticket-number band, distinct from both seed.ts's "900xxx" fixtures
// and staffFixtures.ts's own pagination-fixture "990001".."990005" band, so
// this can never collide with either (see staffFixtures.ts's own comment
// on why that separation matters).
const DETAIL_TICKET_NUMBER = "TKT-2026-991000";

let detailTicketId: number;

test.beforeAll(async () => {
  // An unassigned, non-terminal (OPEN) ticket: unassigned so the Claim
  // button (ui-spec.md §10, R-05's "including Claim... links" requirement)
  // actually renders on IT Staff Ticket Detail, and non-terminal so the
  // Status select offers real transitions rather than being disabled.
  const fixture = await createRequesterOwnedFixtureTicket(
    "responsive-detail",
    DETAIL_TICKET_NUMBER,
  );
  detailTicketId = fixture.id;
});

// ---------------------------------------------------------------------------
// Navigation helpers
// ---------------------------------------------------------------------------

function screenPath(screen: ScreenName): string {
  switch (screen) {
    case "authentication":
      return "/login";
    case "staff-queue":
      return "/staff/tickets";
    case "staff-ticket-detail":
      return `/staff/tickets/${detailTicketId}`;
    case "user-management":
      return "/admin/users";
  }
}

/**
 * Logs in as whichever role owns `screen` (skipped for `authentication`,
 * which IS the Login screen and must stay unauthenticated) and navigates to
 * it directly via `page.goto` — see this file's header comment for why the
 * post-login redirect itself isn't used. Waits for real, populated content
 * (never a loading skeleton) before returning, same "ready" contract as
 * lab-02's own `goToPopulatedScreen`.
 */
async function goToScreen(page: Page, screen: ScreenName): Promise<void> {
  if (screen === "authentication") {
    await page.goto("/login");
    await expect(page.locator("#login-email")).toBeVisible();
    return;
  }

  await loginAsSeededUser(
    page,
    screen === "user-management" ? ADMIN_EMAIL : IT_STAFF_EMAIL,
  );
  await page.goto(screenPath(screen));

  if (screen === "staff-queue") {
    await expect(page.getByRole("heading", { name: "Ticket Queue" })).toBeVisible();
    // `.zen-staff-queue__row-link` is only ever rendered on a REAL row —
    // both the desktop/tablet table's ticket-number cell and the mobile
    // card's header share this class (StaffTicketQueueScreen.tsx) — never
    // on the loading skeleton, which uses its own
    // `.zen-staff-queue__skeleton-block` markup instead. Waiting on this
    // rather than the table/cards wrapper (present during loading too)
    // guarantees this is the loaded, populated state.
    await expect(page.locator(".zen-staff-queue__row-link").first()).toBeVisible();
  } else if (screen === "staff-ticket-detail") {
    await expect(page.getByRole("heading", { name: "Ticket Details" })).toBeVisible();
    await expect(page.getByText(DETAIL_TICKET_NUMBER)).toBeVisible();
  } else if (screen === "user-management") {
    await expect(page.getByRole("heading", { name: "User Management" })).toBeVisible();
    await expect(
      page.locator("table.zen-user-mgmt__table tbody tr, .zen-user-mgmt__card").first(),
    ).toBeVisible();
  }
}

/**
 * `getBoundingClientRect()`-based "on screen, not clipped" check — R-04's
 * "dialogs usable at 390px" requirement. Mirrors lab-02's own
 * `expectFullyVisible`, trimmed to the viewport-containment check this file
 * needs (no scrollable-ancestor `container` case — Lab 3's dialogs aren't
 * nested in one).
 */
async function expectFullyVisible(
  locator: ReturnType<Page["locator"]>,
): Promise<void> {
  await expect(locator).toBeVisible();
  const box = await locator.boundingBox();
  expect(box).not.toBeNull();
  expect(box!.width).toBeGreaterThan(0);
  expect(box!.height).toBeGreaterThan(0);

  const viewport = locator.page().viewportSize();
  expect(viewport).not.toBeNull();
  expect(box!.x).toBeGreaterThanOrEqual(0);
  expect(box!.x + box!.width).toBeLessThanOrEqual(viewport!.width);
}

// ---------------------------------------------------------------------------
// R-01: no horizontal overflow (AC-56, V-11)
// ---------------------------------------------------------------------------

test.describe("R-01 no horizontal overflow (tests.md:197, AC-56, V-11)", () => {
  for (const screen of SCREENS) {
    for (const viewportName of VIEWPORT_NAMES) {
      test(`${screen} at ${viewportName} has no horizontal overflow`, async ({ page }) => {
        await page.setViewportSize(VIEWPORTS[viewportName]);
        await goToScreen(page, screen);

        // Measured on `document.documentElement`, not `document.body` —
        // same rationale as lab-02's own R-01: `body { overflow-x: hidden
        // }` (theme.css) would make a weaker body-scoped check pass no
        // matter how far content actually overflows.
        const { scrollWidth, clientWidth } = await page.evaluate(() => ({
          scrollWidth: document.documentElement.scrollWidth,
          clientWidth: document.documentElement.clientWidth,
        }));
        expect(
          scrollWidth,
          `${screen} at ${viewportName}: document overflows its client width by ${scrollWidth - clientWidth}px`,
        ).toBeLessThanOrEqual(clientWidth);
      });
    }
  }
});

// ---------------------------------------------------------------------------
// R-02: queue reflow (V-10, ui-spec.md §9 / §12)
// ---------------------------------------------------------------------------
//
// StaffTicketQueueScreen.tsx's `DESKTOP_QUERY` ("min-width: 768px") decides
// table vs. cards in JS; StaffTicketQueueScreen.css then hides the Category
// column via `@media (max-width: 991px)` — the table only ever mounts at
// >=768px, so that single CSS rule is what turns the desktop's
// seven-column table into the tablet's six-column one. This describe block
// asserts exactly that split at each of the three viewports.

test.describe("R-02 queue reflow (tests.md:198, V-10, ui-spec.md §9)", () => {
  test("desktop (>=992px): seven-column table with Category visible", async ({ page }) => {
    await page.setViewportSize(VIEWPORTS.desktop);
    await goToScreen(page, "staff-queue");

    await expect(page.locator(".zen-staff-queue__table")).toBeVisible();
    await expect(page.locator(".zen-staff-queue__cards")).toHaveCount(0);
    await expect(
      page.locator(".zen-staff-queue__table thead th.zen-staff-queue__category-col"),
    ).toBeVisible();
    await expect(
      page.locator(".zen-staff-queue__table tbody td.zen-staff-queue__category-col").first(),
    ).toBeVisible();
  });

  test("tablet (768-991px): table stays, Category column dropped", async ({ page }) => {
    await page.setViewportSize(VIEWPORTS.tablet);
    await goToScreen(page, "staff-queue");

    await expect(page.locator(".zen-staff-queue__table")).toBeVisible();
    await expect(page.locator(".zen-staff-queue__cards")).toHaveCount(0);
    // Still in the DOM (a single CSS rule hides it, it isn't a second JS
    // markup) — so this asserts hidden, not absent.
    await expect(
      page.locator(".zen-staff-queue__table thead th.zen-staff-queue__category-col"),
    ).toBeHidden();
  });

  test("mobile (<768px): cards, no table", async ({ page }) => {
    await page.setViewportSize(VIEWPORTS.mobile);
    await goToScreen(page, "staff-queue");

    await expect(page.locator("table")).toHaveCount(0);
    await expect(page.locator(".zen-staff-queue__card").first()).toBeVisible();
  });
});

// Filter-row breakpoint boundaries (PR #83 review): the five queue filters
// are forced onto one line at >= 1080px (StaffTicketQueueScreen.css) and
// wrap below it. At every width on either side of each boundary, all five
// selects must be visible AND lie fully inside the controls panel, and the
// document must not overflow. 991/992 covers the Category-column breakpoint
// (the width the reviewer flagged); 1079/1080 covers the filter-row one.
test.describe("R-02 queue filter row at breakpoint boundaries (tests.md:198, AC-56)", () => {
  for (const width of [991, 992, 1079, 1080]) {
    test(`staff-queue filters fit inside the controls panel at ${width}px`, async ({ page }) => {
      await page.setViewportSize({ width, height: 900 });
      await goToScreen(page, "staff-queue");

      const panel = page.locator(".zen-staff-queue__controls");
      const panelBox = await panel.boundingBox();
      expect(panelBox, "controls panel has a box").not.toBeNull();

      const filterSelects = page.locator(".zen-staff-queue__filters select");
      await expect(filterSelects).toHaveCount(5);
      for (let i = 0; i < 5; i++) {
        const select = filterSelects.nth(i);
        await expect(select).toBeVisible();
        const box = await select.boundingBox();
        expect(box, `filter ${i} has a box`).not.toBeNull();
        expect(
          box!.x + box!.width,
          `filter ${i} at ${width}px overflows the panel's right edge`,
        ).toBeLessThanOrEqual(panelBox!.x + panelBox!.width + 0.5);
        expect(box!.x, `filter ${i} at ${width}px starts left of the panel`).toBeGreaterThanOrEqual(
          panelBox!.x - 0.5,
        );
      }

      const { scrollWidth, clientWidth } = await page.evaluate(() => ({
        scrollWidth: document.documentElement.scrollWidth,
        clientWidth: document.documentElement.clientWidth,
      }));
      expect(scrollWidth).toBeLessThanOrEqual(clientWidth);
    });
  }
});

// ---------------------------------------------------------------------------
// R-03: detail reflow (V-10, ui-spec.md §10 / §12)
// ---------------------------------------------------------------------------
//
// StaffTicketDetailScreen.css's `.zen-staff-detail__layout` is a CSS grid
// with named `grid-template-areas` that swap at `max-width: 991px`:
// "readonly operations" side by side (desktop) becomes "operations" over
// "readonly" (tablet + mobile) — read-only column DOM order never changes,
// only the visual grid-area placement does, which is exactly what this
// describe block probes via bounding boxes rather than DOM order.

test.describe("R-03 detail reflow (tests.md:199, V-10, ui-spec.md §10)", () => {
  test("desktop (>=992px): two columns, operations to the right of read-only", async ({
    page,
  }) => {
    await page.setViewportSize(VIEWPORTS.desktop);
    await goToScreen(page, "staff-ticket-detail");

    const readonlyBox = await page
      .locator(".zen-staff-detail__readonly-column")
      .boundingBox();
    const operationsBox = await page
      .locator(".zen-staff-detail__card--operations")
      .boundingBox();
    expect(readonlyBox).not.toBeNull();
    expect(operationsBox).not.toBeNull();

    // Side by side: operations starts at or after the read-only column's
    // right edge...
    expect(operationsBox!.x).toBeGreaterThanOrEqual(readonlyBox!.x + readonlyBox!.width - 1);
    // ...and their vertical extents overlap (same grid row), not stacked.
    expect(operationsBox!.y).toBeLessThan(readonlyBox!.y + readonlyBox!.height);
    expect(operationsBox!.y + operationsBox!.height).toBeGreaterThan(readonlyBox!.y);
  });

  for (const viewportName of ["tablet", "mobile"] as const) {
    test(`${viewportName} (<992px): one column, operations panel first`, async ({ page }) => {
      await page.setViewportSize(VIEWPORTS[viewportName]);
      await goToScreen(page, "staff-ticket-detail");

      const readonlyBox = await page
        .locator(".zen-staff-detail__readonly-column")
        .boundingBox();
      const operationsBox = await page
        .locator(".zen-staff-detail__card--operations")
        .boundingBox();
      expect(readonlyBox).not.toBeNull();
      expect(operationsBox).not.toBeNull();

      // Stacked, operations above read-only: same horizontal band (one
      // column)...
      expect(Math.abs(operationsBox!.x - readonlyBox!.x)).toBeLessThan(1);
      // ...and it renders entirely above the read-only column.
      expect(operationsBox!.y + operationsBox!.height).toBeLessThanOrEqual(
        readonlyBox!.y + 1,
      );
    });
  }
});

// ---------------------------------------------------------------------------
// R-04: dialogs at mobile (V-14, ui-spec.md §11 / §12 / §13)
// ---------------------------------------------------------------------------

test.describe("R-04 dialogs usable and focus-restoring at mobile (tests.md:200, V-14)", () => {
  test("Create dialog is usable at 390px and restores focus to New user on close", async ({
    page,
  }) => {
    await page.setViewportSize(VIEWPORTS.mobile);
    await goToScreen(page, "user-management");

    const newUserButton = page.getByRole("button", { name: "New user" });
    await newUserButton.click();

    const dialog = page.getByRole("dialog");
    await expect(dialog.getByRole("heading", { name: "New user" })).toBeVisible();

    // Usable at 390px: every field and both actions are on-screen, not
    // clipped by the viewport (ui-spec.md §12: dialogs become full-screen
    // sheets below 768px).
    await expectFullyVisible(dialog.locator("#user-dialog-name"));
    await expectFullyVisible(dialog.locator("#user-dialog-email"));
    await expectFullyVisible(dialog.locator("#user-dialog-role"));
    await expectFullyVisible(dialog.locator("#user-dialog-active"));
    await expectFullyVisible(dialog.locator("#user-dialog-password"));
    await expectFullyVisible(dialog.getByRole("button", { name: "Cancel" }));
    await expectFullyVisible(dialog.getByRole("button", { name: "Save" }));

    await dialog.getByRole("button", { name: "Cancel" }).click();
    await expect(page.getByRole("dialog")).toHaveCount(0);
    // ui-spec.md §13: dialogs restore focus to their trigger on close.
    await expect(newUserButton).toBeFocused();
  });

  test("Edit dialog is usable at 390px and restores focus to its row's Edit button on close", async ({
    page,
  }) => {
    await page.setViewportSize(VIEWPORTS.mobile);
    await goToScreen(page, "user-management");

    // Mobile renders cards (`< 768px`), so the trigger is a card's Edit
    // button, not a table row's.
    const firstEditButton = page.locator(".zen-user-mgmt__card-edit").first();
    await expect(firstEditButton).toBeVisible();
    await firstEditButton.click();

    const dialog = page.getByRole("dialog");
    await expect(dialog.getByRole("heading", { name: "Edit user" })).toBeVisible();
    await expectFullyVisible(dialog.locator("#user-dialog-name"));
    await expectFullyVisible(dialog.locator("#user-dialog-email"));
    await expectFullyVisible(dialog.getByRole("button", { name: "Cancel" }));
    await expectFullyVisible(dialog.getByRole("button", { name: "Save" }));

    await dialog.getByRole("button", { name: "Cancel" }).click();
    await expect(page.getByRole("dialog")).toHaveCount(0);
    await expect(firstEditButton).toBeFocused();
  });
});

// ---------------------------------------------------------------------------
// R-05: focus visibility (V-09)
// ---------------------------------------------------------------------------
//
// Same Tab-traversal + computed-outline approach as lab-02's own R-06
// (`listFocusable`/`currentFocusSnapshot`), applied to all four Lab 3
// screens at all three viewports. This directly covers V-09's "including
// badges-as-links and the claim button" — the IT Staff Ticket Queue's
// ticket-number links (`.zen-staff-queue__row-link`) and IT Staff Ticket
// Detail's Claim button are both real, tabbable controls this traversal
// reaches, since `detailTicketId`'s fixture ticket is deliberately
// unassigned (see `beforeAll`).

interface FocusDescriptor {
  tag: string;
  type: string;
  id: string;
  name: string;
}

interface FocusSnapshot extends FocusDescriptor {
  outlineStyle: string;
  outlineWidth: string;
}

const FOCUSABLE_SELECTOR =
  'a[href], button:not([disabled]), input:not([disabled]):not([type="hidden"]), select:not([disabled]), textarea:not([disabled]), [tabindex]';

/** Every visible, keyboard-reachable control on the page, in DOM order — the order Tab is expected to visit them in (this app never uses a positive tabindex). */
async function listFocusable(page: Page): Promise<FocusDescriptor[]> {
  return page.evaluate((selector) => {
    function isVisible(el: Element): boolean {
      const style = getComputedStyle(el);
      if (style.display === "none" || style.visibility === "hidden") {
        return false;
      }
      const rect = el.getBoundingClientRect();
      return rect.width > 0 && rect.height > 0;
    }
    function describe(el: Element) {
      return {
        tag: el.tagName,
        type: (el as HTMLInputElement).type ?? "",
        id: el.id ?? "",
        name:
          el.getAttribute("aria-label") ??
          el.getAttribute("title") ??
          (el.textContent ?? "").trim().slice(0, 80),
      };
    }
    return Array.from(document.querySelectorAll(selector))
      .filter((el) => {
        const tabindex = el.getAttribute("tabindex");
        if (tabindex !== null && Number(tabindex) < 0) return false;
        return isVisible(el);
      })
      .map(describe);
  }, FOCUSABLE_SELECTOR);
}

/** The currently focused element's descriptor plus its computed outline — the ":focus-visible ring" R-05 requires. */
async function currentFocusSnapshot(page: Page): Promise<FocusSnapshot | null> {
  return page.evaluate(() => {
    const el = document.activeElement;
    if (!el || el === document.body) return null;
    const style = getComputedStyle(el);
    return {
      tag: el.tagName,
      type: (el as HTMLInputElement).type ?? "",
      id: el.id ?? "",
      name:
        el.getAttribute("aria-label") ??
        el.getAttribute("title") ??
        (el.textContent ?? "").trim().slice(0, 80),
      outlineStyle: style.outlineStyle,
      outlineWidth: style.outlineWidth,
    };
  });
}

test.describe("R-05 focus visibility (tests.md:201, V-09)", () => {
  for (const screen of SCREENS) {
    for (const viewportName of VIEWPORT_NAMES) {
      test(`${screen} at ${viewportName} reaches every control with a focus ring`, async ({
        page,
      }) => {
        await page.setViewportSize(VIEWPORTS[viewportName]);
        await goToScreen(page, screen);

        const expected = await listFocusable(page);
        expect(expected.length).toBeGreaterThan(0);

        // Start with nothing focused, so the first Tab lands on the first
        // focusable element in DOM order.
        await page.evaluate(() => {
          const active = document.activeElement as HTMLElement | null;
          active?.blur();
        });

        const visited: FocusSnapshot[] = [];
        for (let i = 0; i < expected.length; i++) {
          await page.keyboard.press("Tab");
          const snapshot = await currentFocusSnapshot(page);
          if (snapshot) visited.push(snapshot);
        }

        // Every expected control was reached, in DOM order — tabbing never
        // skipped one or stopped early.
        expect(visited.map((v) => ({ tag: v.tag, id: v.id, name: v.name }))).toEqual(
          expected.map((e) => ({ tag: e.tag, id: e.id, name: e.name })),
        );

        // Every one of them shows a real focus-visible ring.
        for (const snapshot of visited) {
          const hasNoOutline =
            snapshot.outlineStyle === "none" || snapshot.outlineWidth === "0px";
          expect(
            hasNoOutline,
            `expected a focus-visible ring on ${snapshot.tag} "${snapshot.name}" (id="${snapshot.id}"), got outline-style: ${snapshot.outlineStyle}, outline-width: ${snapshot.outlineWidth}`,
          ).toBe(false);
        }
      });
    }
  }
});

// ---------------------------------------------------------------------------
// R-06: screenshots (Issue #74's screenshot deliverable)
// ---------------------------------------------------------------------------

test.describe("R-06 screenshot capture (tests.md:202, Issue #74)", () => {
  for (const screen of SCREENS) {
    for (const viewportName of VIEWPORT_NAMES) {
      test(`captures ${screen} at ${viewportName}`, async ({ page }) => {
        await page.setViewportSize(VIEWPORTS[viewportName]);
        await goToScreen(page, screen);

        if (screen === "user-management") {
          // The full suite runs every lab-02 AND lab-03 spec in one
          // invocation before this screenshot test executes, and several
          // of those earlier specs create their own real, persisted Users
          // through the live UI (login fixtures, admin-created accounts)
          // that are never individually cleaned up mid-run — see
          // e2e/scripts/reset-e2e-db.ts's own comment on why "User" is
          // truncated once per invocation but necessarily stays populated
          // *within* one. Left unfiltered, this screenshot would show a
          // long tail of "E2E ... Fixture" rows alongside the real seed
          // accounts, which is accurate but not a readable admin-screen
          // deliverable. Every seeded account uses an "@example.edu"
          // address (server/prisma/seed.ts) while every E2E-created
          // fixture uses "@toktickit.local" — a real, structural
          // distinction, not a cosmetic one — so filtering through the
          // screen's own AC-46 search feature to "example.edu" shows
          // exactly the seeded roster this screenshot is meant to
          // demonstrate, using the real search the way an Administrator
          // would to find those accounts, not a special screenshot-only
          // code path.
          const search = page.locator("#user-mgmt-search");
          await search.fill("example.edu");
          // The search is debounced (SEARCH_DEBOUNCE_MS = 300ms) before it
          // re-fetches, so the unfiltered rows are still on screen
          // immediately after `fill`. Assert on the debounced OUTCOME
          // (every toktickit.local fixture row gone) rather than a fixed
          // wait — Playwright's auto-retrying `toHaveCount` polls through
          // the debounce and the re-fetch for us.
          await expect(
            page.locator("tbody tr, .zen-user-mgmt__card").filter({ hasText: "toktickit.local" }),
          ).toHaveCount(0);
          await expect(
            page.locator("tbody tr, .zen-user-mgmt__card").filter({ hasText: "example.edu" }).first(),
          ).toBeVisible();
        }

        const dir = path.join(SCREENSHOT_ROOT, screen);
        fs.mkdirSync(dir, { recursive: true });
        await page.screenshot({
          path: path.join(dir, `${viewportName}.png`),
          fullPage: true,
        });
      });
    }
  }
});
