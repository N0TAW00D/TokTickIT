import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { expect, request as playwrightRequest, test, type Page } from "@playwright/test";

// Responsive + screenshot-evidence harness (docs/lab-02/tests.md R-01..R-06,
// Issue #20). E2E-01..05 are a later slice and are NOT written here (several
// depend on PRs not yet merged into this stack).
//
// Every test below drives the REAL client against the REAL server + the
// dedicated `toktickit_e2e` Postgres database (see ../playwright.config.ts)
// — no mocked responses, no stubbed components.

const here = path.dirname(fileURLToPath(import.meta.url));

// R-05 / specification.md A-13: "artifacts/lab-02/screenshots/
// {create-ticket,my-tickets,ticket-detail}/" holds the committed
// screenshots. `here` is e2e/lab-02, so the repo root is two levels up.
const SCREENSHOT_ROOT = path.resolve(
  here,
  "../../artifacts/lab-02/screenshots",
);

// The server always listens on :3000 (server/src/index.ts hardcodes it —
// see the SERVER_URL comment in ../playwright.config.ts). playwright.config
// doesn't export that constant, so it's duplicated here rather than
// re-derived from anything network-observable.
const SERVER_URL = "http://localhost:3000";

/**
 * AC-39 (specification.md:688) viewport bands: desktop >= 992px, tablet
 * 768-991px, mobile < 768px. One representative width per band, chosen away
 * from the exact boundary values so a future off-by-one in a media query
 * would still be caught by the *other* two bands' assertions:
 *   - desktop: 1280 (well above 992)
 *   - tablet: 820 (mid-band, between 768 and 991)
 *   - mobile: 375 (a common phone width, well below 768)
 */
const VIEWPORTS = {
  desktop: { width: 1280, height: 900 },
  tablet: { width: 820, height: 1024 },
  mobile: { width: 375, height: 812 },
} as const;

type ViewportName = keyof typeof VIEWPORTS;
const VIEWPORT_NAMES: ViewportName[] = ["desktop", "tablet", "mobile"];

const SCREENS = ["create-ticket", "my-tickets", "ticket-detail"] as const;
type ScreenName = (typeof SCREENS)[number];

// ---------------------------------------------------------------------------
// Fixture data: seeded once for the whole file via the real HTTP API (never
// by talking to Prisma/the DB directly), so My Tickets / Ticket Detail have
// real, populated rows to render and screenshot.
// ---------------------------------------------------------------------------

let requesterId: number;
let requesterName: string;
let ticketId: number;
let ticketNumber: string;

const TICKET_FIXTURES: Array<{
  summary: string;
  description: string;
  requestedPriority: "LOW" | "MEDIUM" | "HIGH";
}> = [
  {
    summary: "VPN disconnects every few minutes on campus Wi-Fi",
    description:
      "The VPN client drops the connection roughly every five minutes while connected to the campus Wi-Fi, requiring a manual reconnect each time. This has been happening since yesterday morning.",
    requestedPriority: "HIGH",
  },
  {
    summary: "Cannot access shared grade submission folder",
    description:
      "Opening the shared grade submission folder returns a permission denied error since this morning. It worked fine yesterday afternoon and no permissions were intentionally changed.",
    requestedPriority: "MEDIUM",
  },
  {
    summary: "Printer on 3rd floor jams repeatedly",
    description:
      "The department printer on the 3rd floor jams on almost every print job larger than a single page. Clearing the jam works but it recurs within a few pages every time.",
    requestedPriority: "LOW",
  },
];

test.beforeAll(async () => {
  const api = await playwrightRequest.newContext({ baseURL: SERVER_URL });

  const requestersResponse = await api.get("/api/requesters");
  if (!requestersResponse.ok()) {
    throw new Error(
      `GET /api/requesters failed: ${requestersResponse.status()} ${await requestersResponse.text()}`,
    );
  }
  const requesters: Array<{ id: number; name: string }> =
    await requestersResponse.json();
  if (requesters.length === 0) {
    throw new Error(
      "No active requesters seeded — expected server/prisma/seed.ts to have run (pretest:e2e).",
    );
  }
  requesterId = requesters[0].id;
  requesterName = requesters[0].name;

  const categoriesResponse = await api.get("/api/categories");
  const categories: Array<{ id: number; name: string }> =
    await categoriesResponse.json();
  const relatedSystemsResponse = await api.get("/api/related-systems");
  const relatedSystems: Array<{ id: number; name: string }> =
    await relatedSystemsResponse.json();
  if (categories.length === 0 || relatedSystems.length === 0) {
    throw new Error(
      "No active categories/related systems seeded — expected server/prisma/seed.ts to have run.",
    );
  }

  let lastCreated: { id: number; ticketNumber: string } | undefined;
  for (const [index, fixture] of TICKET_FIXTURES.entries()) {
    const category = categories[index % categories.length];
    const relatedSystem = relatedSystems[index % relatedSystems.length];
    const response = await api.post("/api/tickets", {
      headers: { "X-Requester-Id": String(requesterId) },
      data: {
        categoryId: category.id,
        relatedSystemId: relatedSystem.id,
        requestedPriority: fixture.requestedPriority,
        summary: fixture.summary,
        description: fixture.description,
      },
    });
    if (response.status() !== 201) {
      throw new Error(
        `Seed POST /api/tickets failed: ${response.status()} ${await response.text()}`,
      );
    }
    lastCreated = await response.json();
  }

  // TICKET_FIXTURES[2] ("Printer on 3rd floor jams repeatedly") is the last
  // one created — used for the Ticket Detail screenshot/tests so it has a
  // fully realistic set of fields, including a non-default (LOW) priority.
  ticketId = lastCreated!.id;
  ticketNumber = lastCreated!.ticketNumber;

  await api.dispose();
});

// ---------------------------------------------------------------------------
// Navigation helpers
// ---------------------------------------------------------------------------

function screenPath(screen: ScreenName): string {
  switch (screen) {
    case "create-ticket":
      return "/tickets/new";
    case "my-tickets":
      return "/tickets";
    case "ticket-detail":
      return `/tickets/${ticketId}`;
  }
}

/**
 * Drives the real Requester Selection screen (ui-spec.md §6) exactly as a
 * user would: pick the seeded Requester from the dropdown and click
 * Continue. Lands on `/tickets`. Deliberately does not poke localStorage
 * directly — every test's "logged in" state is produced by the same UI flow
 * E2E-01 will exercise later.
 */
async function loginAsSeededRequester(page: Page): Promise<void> {
  await page.goto("/select-requester");
  await page
    .getByLabel("Development Requester")
    .selectOption({ label: requesterName });
  await page.getByRole("button", { name: /Continue/ }).click();
  await expect(page).toHaveURL(/\/tickets$/);
}

/** Navigates to `screen` (already logged in) and waits for real, populated
 * content — never a loading spinner or an error state — to be on screen. */
async function goToPopulatedScreen(
  page: Page,
  screen: ScreenName,
  viewportName: ViewportName,
): Promise<void> {
  if (screen !== "my-tickets") {
    await page.goto(screenPath(screen));
  }

  if (screen === "create-ticket") {
    // Reference-data dropdowns (Category, Related System) must have
    // actually loaded — more than just the "Select…" placeholder option —
    // before this counts as "ready" (R-05's populated-UI requirement).
    await expect(page.locator("#create-ticket-category")).toBeVisible();
    await expect
      .poll(() => page.locator("#create-ticket-category option").count())
      .toBeGreaterThan(1);
    await expect
      .poll(() => page.locator("#create-ticket-related-system option").count())
      .toBeGreaterThan(1);
  } else if (screen === "my-tickets") {
    // The `toktickit_e2e` database is shared across worktrees/agent runs on
    // this machine (docs' harness boots against one dedicated Postgres
    // container, not a per-run throwaway one), so this Requester may already
    // own tickets from other sessions. Assert "at least our fixtures are
    // here" rather than an exact row count, and confirm one of OUR fixtures
    // (by ticket number, sorted to the top by the default createdAt-desc
    // sort) is genuinely visible — never just "some row exists".
    const isTableLayout = viewportName !== "mobile";
    const rows = isTableLayout
      ? page.locator(".zen-my-tickets__table tbody tr")
      : page.locator(".zen-my-tickets__card");
    await expect(rows.first()).toBeVisible();
    await expect
      .poll(() => rows.count())
      .toBeGreaterThanOrEqual(TICKET_FIXTURES.length);
    // getByText would also match the row's visually-hidden "ticket
    // TKT-..." span (an accessible-name helper, see MyTicketsScreen.tsx) —
    // scope to the actual ticket-number link/text to keep this a single
    // match.
    await expect(
      page.getByRole("link", { name: ticketNumber, exact: true }),
    ).toBeVisible();
  } else if (screen === "ticket-detail") {
    await expect(page.getByRole("heading", { name: "Ticket Details" })).toBeVisible();
    await expect(page.getByText(ticketNumber)).toBeVisible();
  }
}

/**
 * `getBoundingClientRect()`-based "on screen, not clipped" check — used for
 * R-04's "primary action / label visible in the layout box" requirement.
 *
 * PR #44 review (Palapluem): my-tickets/desktop.png visibly clipped the
 * Status badge and hid Last Updated entirely, yet R-04 was green — the
 * previous version of this helper only asserted a non-zero bounding box,
 * which stays true even for an element sitting entirely past the right
 * edge of a scrolled-off `overflow-x: auto` ancestor (exactly what
 * happened to those two columns inside `.zen-my-tickets__table-scroll`).
 * This version additionally asserts the box is:
 *   - horizontally within the page's own viewport (an element pushed past
 *     the right edge by page-level overflow would fail this even though
 *     `toBeVisible()` and a non-zero box would not catch it); and
 *   - fully within `container`'s bounding box, when one is given — i.e.
 *     not clipped by a scrollable ancestor's unscrolled visible area.
 * Vertical position is deliberately NOT checked against the outer
 * viewport: normal page-level vertical scroll (My Tickets' table plus
 * pagination routinely exceeds one screenful) is expected and is not the
 * defect this guards against. Vertical containment IS checked against
 * `container`, since a container's own clipped box is exactly what
 * hid Last Updated in the reported defect.
 */
async function expectFullyVisible(
  locator: ReturnType<Page["locator"]>,
  container?: ReturnType<Page["locator"]>,
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

  if (container) {
    const containerBox = await container.boundingBox();
    expect(containerBox).not.toBeNull();
    // 0.5px slack absorbs sub-pixel layout rounding, not real clipping.
    expect(box!.x).toBeGreaterThanOrEqual(containerBox!.x - 0.5);
    expect(box!.y).toBeGreaterThanOrEqual(containerBox!.y - 0.5);
    expect(box!.x + box!.width).toBeLessThanOrEqual(
      containerBox!.x + containerBox!.width + 0.5,
    );
    expect(box!.y + box!.height).toBeLessThanOrEqual(
      containerBox!.y + containerBox!.height + 0.5,
    );
  }
}

// ---------------------------------------------------------------------------
// R-05: screenshot capture
// ---------------------------------------------------------------------------

test.describe("R-05 screenshot capture (tests.md:137, specification.md A-13)", () => {
  for (const screen of SCREENS) {
    for (const viewportName of VIEWPORT_NAMES) {
      test(`captures ${screen} at ${viewportName}`, async ({ page }) => {
        await page.setViewportSize(VIEWPORTS[viewportName]);
        await loginAsSeededRequester(page);
        await goToPopulatedScreen(page, screen, viewportName);

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

// ---------------------------------------------------------------------------
// R-01: no horizontal scroll
// ---------------------------------------------------------------------------

test.describe("R-01 no horizontal scroll (tests.md:133, AC-39)", () => {
  for (const screen of SCREENS) {
    for (const viewportName of VIEWPORT_NAMES) {
      test(`${screen} at ${viewportName} has no horizontal scroll`, async ({
        page,
      }) => {
        await page.setViewportSize(VIEWPORTS[viewportName]);
        await loginAsSeededRequester(page);
        await goToPopulatedScreen(page, screen, viewportName);

        // Measured on `document.documentElement`, deliberately NOT on
        // `document.body` and not via a wheel-scroll probe. theme.css sets
        // `body { overflow-x: hidden }` as the AC-39 backstop, and that
        // single declaration forces BOTH of those weaker checks to pass no
        // matter how far content actually overflows: it clamps
        // `body.scrollWidth` to `body.clientWidth` by construction, and it
        // makes the page unscrollable so `window.scrollX` is pinned at 0.
        // A test that cannot fail is not evidence. Verified: with the
        // `.zen-my-tickets__table-scroll` containing-block fix reverted,
        // my-tickets at tablet genuinely overflowed the document by 105px
        // while both the body metric and the wheel probe still reported
        // clean.
        //
        // The earlier concern that `documentElement` over-reports a nested
        // scroll container's internal overflow does not hold here: the
        // table scrolls inside `.zen-my-tickets__table-scroll` and
        // contributes nothing to this number. The 105px came from
        // `position: absolute` `.zen-visually-hidden` spans escaping that
        // container because it was not a containing block.
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
// R-02: table -> cards
// ---------------------------------------------------------------------------

test.describe("R-02 table -> cards (tests.md:134, AC-39, ui-spec §9)", () => {
  for (const viewportName of VIEWPORT_NAMES) {
    const expectCards = viewportName === "mobile";

    test(`my-tickets renders ${expectCards ? "cards" : "a table"} at ${viewportName}`, async ({
      page,
    }) => {
      await page.setViewportSize(VIEWPORTS[viewportName]);
      await loginAsSeededRequester(page);
      await goToPopulatedScreen(page, "my-tickets", viewportName);

      if (expectCards) {
        await expect(page.locator("table")).toHaveCount(0);
        await expect(page.locator(".zen-my-tickets__card").first()).toBeVisible();
      } else {
        await expect(page.locator("table")).toBeVisible();
        await expect(page.locator(".zen-my-tickets__card")).toHaveCount(0);
      }
    });
  }
});

// ---------------------------------------------------------------------------
// R-03: nav collapses
// ---------------------------------------------------------------------------

test.describe("R-03 nav collapses (tests.md:135, AC-39, ui-spec §4)", () => {
  for (const screen of SCREENS) {
    for (const viewportName of VIEWPORT_NAMES) {
      test(`${screen} at ${viewportName}`, async ({ page }) => {
        await page.setViewportSize(VIEWPORTS[viewportName]);
        await loginAsSeededRequester(page);
        await goToPopulatedScreen(page, screen, viewportName);

        const inlineNav = page.locator(".zen-app-shell__nav--inline");
        const hamburger = page.locator(".zen-app-shell__hamburger");

        if (viewportName === "mobile") {
          await expect(hamburger).toBeVisible();
          await expect(hamburger).toHaveAttribute("aria-expanded", "false");
          await expect(inlineNav).toBeHidden();
        } else {
          await expect(inlineNav).toBeVisible();
          await expect(hamburger).toBeHidden();
        }
      });
    }
  }
});

// ---------------------------------------------------------------------------
// R-04: no clipped label / hidden primary action
// ---------------------------------------------------------------------------

const FIELD_LABEL_SELECTOR: Record<ScreenName, string> = {
  "create-ticket": ".zen-field__label",
  "my-tickets": ".zen-field__label",
  "ticket-detail": ".zen-ticket-detail__field-label",
};

// The one primary/only actionable navigation control per screen. Ticket
// Detail has no "primary"-styled button (it's read-only), so its one real
// action — leaving the screen — stands in for "the primary action" there.
const PRIMARY_ACTION_NAME: Record<ScreenName, RegExp> = {
  "create-ticket": /^Submit ticket$/,
  "my-tickets": /Create Ticket/,
  "ticket-detail": /Back to My Tickets/,
};

test.describe("R-04 no clipped label / hidden primary action (tests.md:136, AC-39)", () => {
  for (const screen of SCREENS) {
    for (const viewportName of VIEWPORT_NAMES) {
      test(`${screen} at ${viewportName}`, async ({ page }) => {
        await page.setViewportSize(VIEWPORTS[viewportName]);
        await loginAsSeededRequester(page);
        await goToPopulatedScreen(page, screen, viewportName);

        const primaryAction = page
          .getByRole("button", { name: PRIMARY_ACTION_NAME[screen] })
          .first();
        await expectFullyVisible(primaryAction);

        const labels = page.locator(FIELD_LABEL_SELECTOR[screen]);
        const labelCount = await labels.count();
        expect(labelCount).toBeGreaterThan(0);
        for (let i = 0; i < labelCount; i++) {
          await expectFullyVisible(labels.nth(i));
        }

        // A `<select>` never overflows its own box — it silently truncates
        // the option text instead, so `expectFullyVisible` on the control
        // passes while the user sees "Created (newe". ui-spec.md:549
        // requires "Filters, sort, Clear Filters, and pagination are usable
        // and unclipped at every viewport", so measure the widest option's
        // rendered text against the control's content box directly. Two of
        // the four controls failed this before the flex-basis fix (Sort by
        // 36.6px, Category by 21.2px).
        if (screen === "my-tickets") {
          const shortfalls = await page.evaluate(() => {
            const out: Array<{ id: string; longest: string; by: number }> = [];
            for (const select of document.querySelectorAll("select")) {
              const style = getComputedStyle(select);
              const probe = document.createElement("span");
              probe.style.cssText = `position:absolute;visibility:hidden;white-space:nowrap;font:${style.font}`;
              probe.textContent = [...select.options].reduce(
                (widest, option) =>
                  option.text.length > widest.length ? option.text : widest,
                "",
              );
              document.body.appendChild(probe);
              const needed =
                probe.getBoundingClientRect().width +
                parseFloat(style.paddingLeft) +
                parseFloat(style.paddingRight);
              probe.remove();
              const shortfall =
                needed - select.getBoundingClientRect().width;
              if (shortfall > 0) {
                out.push({
                  id: select.id,
                  longest: probe.textContent ?? "",
                  by: Math.round(shortfall * 10) / 10,
                });
              }
            }
            return out;
          });
          expect(
            shortfalls,
            `selects whose longest option does not fit: ${JSON.stringify(shortfalls)}`,
          ).toEqual([]);
        }

        // Strengthened per PR #44 review (Palapluem): the checks above
        // never looked inside the My Tickets table, which is exactly
        // where the Status badge was visibly clipped and Last Updated was
        // hidden entirely — behind `.zen-my-tickets__table-scroll`'s own
        // `overflow-x: auto` (MyTicketsScreen.css) — while this describe
        // block stayed green. At `≥ 992px` the table has the full 1120px
        // container (ui-spec.md:67, :492) to lay out eight columns of
        // bounded-length content (ticket number/date formats, fixed
        // badge text) in, so at the desktop test viewport every column —
        // including Status and Last Updated, both header and first-row
        // cell — must render fully inside the table's own scroll
        // container without needing to scroll it. This is scoped to
        // desktop: at tablet (768-991px) ui-spec.md §11 only promises
        // "ticket list stays a table", not that all eight columns fit
        // without the table's own sanctioned internal scroll (ui-spec.md
        // §11 "no horizontal page scroll" is a page-level rule; a wide
        // table scrolling inside itself is the documented tablet
        // fallback, confirmed empirically: even after this fix, real
        // seeded data (server/prisma/seed.ts's "Account and Access" /
        // "Grade Submission App") still needs ~1005px of column width,
        // which the ~722px tablet content area cannot fit no matter how
        // the two truncated columns are sized).
        if (screen === "my-tickets" && viewportName === "desktop") {
          const scrollContainer = page.locator(".zen-my-tickets__table-scroll");
          const overflow = await scrollContainer.evaluate(
            (el) => el.scrollWidth - el.clientWidth,
          );
          expect(overflow).toBeLessThanOrEqual(0);

          const headers = page.locator(".zen-my-tickets__table thead th");
          const statusHeader = headers.nth(6);
          const lastUpdatedHeader = headers.nth(7);
          await expect(statusHeader).toHaveText(/Status/);
          await expect(lastUpdatedHeader).toContainText("Last Updated");
          await expectFullyVisible(statusHeader, scrollContainer);
          await expectFullyVisible(lastUpdatedHeader, scrollContainer);

          const firstRowCells = page
            .locator(".zen-my-tickets__table tbody tr")
            .first()
            .locator("td");
          const statusCell = firstRowCells.nth(6);
          const lastUpdatedCell = firstRowCells.nth(7);
          await expect(statusCell.locator(".zen-badge")).toBeVisible();
          await expectFullyVisible(statusCell, scrollContainer);
          await expectFullyVisible(lastUpdatedCell, scrollContainer);
        }
      });
    }
  }
});

// ---------------------------------------------------------------------------
// R-06: keyboard traversal
// ---------------------------------------------------------------------------

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

/** Every visible, keyboard-reachable control on the page, in DOM order —
 * the order Tab is expected to visit them in (none of this app's markup
 * uses a positive tabindex, so DOM order and tab order coincide). */
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

/** The currently focused element's descriptor plus its computed outline —
 * the ":focus-visible ring" R-06 requires. */
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

test.describe("R-06 keyboard traversal (tests.md:138, AC-40, ui-spec §12)", () => {
  for (const screen of SCREENS) {
    for (const viewportName of VIEWPORT_NAMES) {
      test(`${screen} at ${viewportName} reaches every control with a focus ring`, async ({
        page,
      }) => {
        await page.setViewportSize(VIEWPORTS[viewportName]);
        await loginAsSeededRequester(page);
        await goToPopulatedScreen(page, screen, viewportName);

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
