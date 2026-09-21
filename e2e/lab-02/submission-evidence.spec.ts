import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  expect,
  request as playwrightRequest,
  test,
  type Browser,
  type Page,
} from "@playwright/test";
import {
  LOCAL_DEV_PASSWORD,
  createPlainLoginFixtureUser,
  loginAs,
  type FixtureUser,
} from "../support/auth.js";

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
// Labsheet demonstration 4 ("one valid and one invalid attachment upload")
// is covered by the "demonstration 4" test in the Create Ticket describe
// below: `lab2-staging` now renders the real `AttachmentUploader`
// (client/src/components/AttachmentUploader.tsx) on the Create Ticket
// screen, so two files can be selected through its real file input and the
// valid/invalid split asserted on screen before the capture.
//
// This file was originally written against Lab 2's dev-only "Development
// Requester Selector" (`GET /api/requesters`, `X-Requester-Id`,
// `/select-requester`), which Lab 3 (#70) deleted entirely in favour of real
// session-cookie authentication (`POST /api/auth/login`, `/login`). The
// "Part 6 — Development Requester Selection" describe block screenshotted
// that dev-only screen itself — a screen that no longer exists at all, with
// no auth-mechanism migration possible — so it has been deleted outright;
// its already-committed screenshots under
// `artifacts/lab-02/screenshots/submission/part-6-create-ticket/` remain
// frozen, referenced as-is by the already-graded `docs/lab-02/submission.typ`.
// "Part 6 — Create Ticket (create mode)" tests the real Create Ticket screen,
// which still exists, and has been migrated onto real login following the
// same idiom as `e2e/lab-02/requester-ticket-flow.spec.ts`: a dedicated
// fixture Requester (`createPlainLoginFixtureUser`, `mustChangePassword:
// false`) logged in through the real Login screen, since every *seeded*
// Requester (including "Jennifer Anderson", who this block originally used)
// is a migrated Lab 2 row with `mustChangePassword: true` and would hit a
// forced `/change-password` redirect before ever reaching Create Ticket —
// the same reason every other migrated lab-02 spec uses a fixture instead of
// a named seeded Requester. Nothing here depends on the Requester's name
// being specifically "Jennifer Anderson": every assertion that used to check
// for that literal string now checks the fixture's own `name` field instead,
// so the substance of what's demonstrated (the Requester field reflects
// whoever is actually signed in) is unchanged. "Part 7 — My Tickets" and
// "Part 8 — Ticket Detail & Attachments" below follow the same idiom: every
// named seeded Requester ("David Lee", "Sarah Johnson", "Michael Brown")
// that block originally used is replaced with a dedicated fixture Requester
// (`createPlainLoginFixtureUser`), since none of their assertions depend on
// a specific person's identity — only on "the Requester who is logged in"
// vs. "a different one", or (Part 8's info-card check) on whichever name is
// actually signed in. Mid-session "Change Requester" (a screen that no
// longer exists) becomes a real Logout (ui-spec.md §4.1 UserBadge menu)
// followed by a fresh login as the next Requester, the same substitution
// `e2e/lab-02/requester-ticket-flow.spec.ts`'s E2E-03 already made.

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
const PART7_DIR = path.join(SUBMISSION_ROOT, "part-7-my-tickets");
const PART8_DIR = path.join(SUBMISSION_ROOT, "part-8-ticket-detail");

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
  fs.mkdirSync(PART7_DIR, { recursive: true });
  fs.mkdirSync(PART8_DIR, { recursive: true });
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

// ---------------------------------------------------------------------------
// Answer Part 6 — Create Ticket screen, create mode (ui-spec.md §8,
// labsheet §8.2)
// ---------------------------------------------------------------------------

/**
 * Logs a fixture Requester in through the real Login screen (ui-spec.md §5)
 * for the tests below. Every `createPlainLoginFixtureUser` fixture has
 * `mustChangePassword: false`, so there is no forced `/change-password`
 * detour — same idiom as `requester-ticket-flow.spec.ts`'s `loginAsFixture`.
 */
async function loginAsCreateTicketFixture(
  page: Page,
  fixtureUser: FixtureUser,
): Promise<void> {
  await loginAs(page, fixtureUser.email, LOCAL_DEV_PASSWORD);
  await expect(page).not.toHaveURL(/\/login$/);
}

test.describe("Part 6 — Create Ticket (create mode)", () => {
  test("initial state and validation failure with field-level messages", async ({
    page,
  }) => {
    await page.setViewportSize(DESKTOP);
    const fixtureUser = await createPlainLoginFixtureUser("part6-create-ticket-initial");
    await loginAsCreateTicketFixture(page, fixtureUser);

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
    // the signed-in Requester's session (CreateTicketScreen.tsx: `user?.name`).
    await expect(page.locator("#create-ticket-requester")).toHaveValue(
      fixtureUser.name,
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
    const fixtureUser = await createPlainLoginFixtureUser("part6-create-ticket-success");
    await loginAsCreateTicketFixture(page, fixtureUser);

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
    expect(ticket.requester.id).toBe(fixtureUser.id);

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
    // The created ticket's detail page shows the same Requester that is
    // signed in — visual confirmation to go with the requesterId check
    // above. Scoped to the ticket info card, not just `getByText`, since the
    // app shell's own Requester badge in the header also reads the same
    // name on every screen.
    await expect(
      page.locator(".zen-ticket-detail__card").getByText(fixtureUser.name),
    ).toBeVisible();
    await page.screenshot({
      path: shot(PART6_DIR, "12-demo1-ticket-detail-requester-match.png"),
      fullPage: true,
    });
  });

  test("API failure on submit preserves entered form values", async ({
    page,
  }) => {
    await page.setViewportSize(DESKTOP);
    const fixtureUser = await createPlainLoginFixtureUser("part6-create-ticket-api-failure");
    await loginAsCreateTicketFixture(page, fixtureUser);

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
    const fixtureUser = await createPlainLoginFixtureUser("part6-create-ticket-demo2");
    await loginAsCreateTicketFixture(page, fixtureUser);

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

  test("demonstration 4: one valid and one invalid attachment on the Create Ticket screen", async ({
    page,
  }) => {
    await page.setViewportSize(DESKTOP);
    const fixtureUser = await createPlainLoginFixtureUser("part6-create-ticket-demo4");
    await loginAsCreateTicketFixture(page, fixtureUser);

    await page.goto("/tickets/new");
    await expect(
      page.getByRole("heading", { name: "Create Ticket", level: 1 }),
    ).toBeVisible();
    // Attachments section starts empty (ui-spec.md §8: the count header
    // reads "Attachments (n/5)").
    await expect(
      page.getByRole("heading", { name: "Attachments (0/5)", level: 2 }),
    ).toBeVisible();

    // Demonstration 4 (labsheet §8.2): select TWO files through the real
    // file input rendered by AttachmentUploader (client/src/components/
    // AttachmentUploader.tsx) — one VALID (a PDF within the 5 MB limit,
    // matching the `battery-report.pdf` row in ui-spec.md §8's
    // illustration) and one INVALID (a `.exe`, matching the same
    // illustration's `virus.exe` row). setInputFiles is programmatic, so it
    // bypasses the input's `accept=".jpg,.jpeg,.png,.webp,.pdf"` hint on
    // purpose — that is exactly the drag-and-drop / programmatic path the
    // component's own client-side MIME + extension check (`validateFile`)
    // exists to guard (see its comment). The two files are written to a
    // gitignored temp dir at runtime; nothing binary is committed.
    const fixtureDir = path.resolve(here, "../test-results/demo4-attachments");
    fs.mkdirSync(fixtureDir, { recursive: true });
    const validPdfPath = path.join(fixtureDir, "battery-report.pdf");
    const invalidExePath = path.join(fixtureDir, "virus.exe");
    // ~240 KB so the queued row shows a realistic "KB" size, well under the
    // 5 MB ceiling. A minimal but well-formed PDF envelope around the pad.
    fs.writeFileSync(
      validPdfPath,
      `%PDF-1.4\n${" ".repeat(240 * 1024)}\n%%EOF\n`,
    );
    fs.writeFileSync(invalidExePath, "MZ not a real attachment");

    await page
      .locator("#create-ticket-attachments-input")
      .setInputFiles([validPdfPath, invalidExePath]);

    // The valid file is queued: exactly one non-rejected row, showing name
    // + size + Remove, and the count header advances to "Attachments (1/5)"
    // (AC-18, AC-19, ui-spec.md §8).
    await expect(
      page.getByRole("heading", { name: "Attachments (1/5)", level: 2 }),
    ).toBeVisible();
    const queuedRow = page.locator(
      ".zen-attachment-uploader__item:not(.zen-attachment-uploader__item--rejected)",
    );
    await expect(queuedRow).toHaveCount(1);
    await expect(
      queuedRow.locator(".zen-attachment-uploader__name"),
    ).toHaveText("battery-report.pdf");
    await expect(
      queuedRow.locator(".zen-attachment-uploader__size"),
    ).toHaveText(/^\d+(\.\d+)?\s(KB|MB)$/);
    await expect(
      queuedRow.getByRole("button", { name: "Remove" }),
    ).toBeVisible();

    // The invalid file is rejected with its red per-file reason — the exact
    // string AttachmentUploader.tsx's `validateFile` returns for a bad type
    // — and is NOT added to the queue (AC-19). The rejection span carries
    // role="alert".
    const rejectedRow = page.locator(
      ".zen-attachment-uploader__item--rejected",
    );
    await expect(rejectedRow).toHaveCount(1);
    await expect(
      rejectedRow.locator(".zen-attachment-uploader__name"),
    ).toHaveText("virus.exe");
    await expect(rejectedRow.getByRole("alert")).toContainText(
      "Unsupported file type — not added.",
    );
    // "virus.exe" never became a queued file: still exactly one Remove
    // button on the whole screen (the valid row's).
    await expect(page.getByRole("button", { name: "Remove" })).toHaveCount(1);

    await page.screenshot({
      path: shot(PART6_DIR, "14-demo4-valid-and-invalid-attachment.png"),
      fullPage: true,
    });
  });
});

// ---------------------------------------------------------------------------
// Answer Part 7 — My Tickets screen (ui-spec.md §9, labsheet §8.4)
// ---------------------------------------------------------------------------

/**
 * Logs a fixture Requester in through the real Login screen (ui-spec.md §5)
 * and waits for the landing redirect to My Tickets. Every fixture from
 * `createPlainLoginFixtureUser` has `mustChangePassword: false`, so there is
 * no forced `/change-password` detour — same idiom as
 * `requester-ticket-flow.spec.ts`'s `loginAsFixture`.
 */
async function loginAsFixture(page: Page, fixtureUser: FixtureUser): Promise<void> {
  await loginAs(page, fixtureUser.email, LOCAL_DEV_PASSWORD);
  await expect(page).toHaveURL(/\/tickets$/);
}

/**
 * Establishes one real, cookie-based session for `fixtureUser` via a
 * throwaway browser context + the real Login screen, then carries that
 * session's `toktickit.sid` cookie into a raw `APIRequestContext`
 * (Playwright's own `storageState()`) — for seeding fixtures directly
 * against the real HTTP API without driving `page`. The server now derives
 * the acting Requester from the session, not a header, so this is the
 * real-auth equivalent of the old `X-Requester-Id` header — same idiom
 * `requester-ticket-flow.spec.ts`'s `loginApiContext` already established.
 */
async function loginApiContext(
  browser: Browser,
  fixtureUser: FixtureUser,
): Promise<Awaited<ReturnType<typeof playwrightRequest.newContext>>> {
  const loginContext = await browser.newContext();
  const loginPage = await loginContext.newPage();
  await loginAsFixture(loginPage, fixtureUser);
  const storageState = await loginContext.storageState();
  await loginContext.close();

  return playwrightRequest.newContext({ baseURL: SERVER_URL, storageState });
}

/**
 * Switches the signed-in Requester through a real Logout (ui-spec.md §4.1
 * UserBadge menu) followed by a fresh login as `nextUser` — the real
 * equivalent of the deleted "Change Requester" dev-selector flow, which used
 * to reuse the same `/select-requester` screen mid-session. Lands back on
 * `/tickets`, same as a first-time login.
 */
async function switchRequesterTo(page: Page, nextUser: FixtureUser): Promise<void> {
  await page.locator(".zen-user-badge__trigger").click();
  await page.getByRole("menuitem", { name: "Logout" }).click();
  await expect(page).toHaveURL(/\/login$/);
  await loginAsFixture(page, nextUser);
}

test.describe("Part 7 — My Tickets", () => {
  // Requester roles for this Part, kept disjoint from Part 6's fixtures and
  // from each other so no test's fixtures contaminate another test's
  // evidence. Every ticket these tests screenshot is created here, in this
  // `beforeAll`, through the real `POST /api/tickets` endpoint — nothing
  // depends on tickets left behind by another spec or an earlier run.
  // PR #42's `pretest:e2e` hook TRUNCATEs Ticket/Attachment/TicketCounter
  // before every `npm run test:e2e`, so each Requester below starts from
  // zero and this Part builds exactly the fixtures its assertions and
  // screenshots need.
  //
  // Originally three named seeded Requesters ("David Lee", "Sarah Johnson",
  // "Michael Brown"), replaced here with three dedicated fixture Requesters
  // (`createPlainLoginFixtureUser`): no assertion below depends on a
  // specific named person — only on "the Requester who is logged in" vs. "a
  // different one", and on one of the three reliably owning zero tickets. A
  // freshly created fixture row is reliably empty by construction, stronger
  // than depending on a seeded name no other spec happens to leave alone.
  //   - requesterA: seeded here with a self-contained set of 12 tickets —
  //     more than one page at the default page size of 10 (so
  //     `06-pagination-page2.png` is a genuine page 2) and spread across
  //     every seeded Category and all three priorities, so the search,
  //     filter and sort screenshots demonstrate real filtering that is
  //     asserted row by row against the rendered table.
  //   - requesterB: seeded here with their OWN small, distinct pair of
  //     tickets, so the "switch to B" screenshot shows a genuinely
  //     different non-empty list.
  //   - requesterEmpty: must own zero tickets — used ONLY for the
  //     empty-state and cross-Requester-rejection tests. No test in this
  //     file ever creates a ticket for them; the `beforeAll` still asserts
  //     their live count is zero rather than assuming it.
  let requesterA: FixtureUser;
  let requesterB: FixtureUser;
  let requesterEmpty: FixtureUser;
  // A ticket owned by requesterA that the search / filter screenshots key
  // off. Populated in the `beforeAll` from the real `POST /api/tickets`
  // response, so its id / number / category / priority are known facts,
  // not assumptions. Created LAST so it sits on page 1 of the default
  // newest-first list.
  let referenceTicket: {
    id: number;
    ticketNumber: string;
    categoryName: string;
    priority: "LOW" | "MEDIUM" | "HIGH";
  };
  const requesterATicketNumbers: string[] = [];
  const requesterBTicketNumbers: string[] = [];

  test.beforeAll(async ({ browser }) => {
    requesterA = await createPlainLoginFixtureUser("part7-a");
    requesterB = await createPlainLoginFixtureUser("part7-b");
    requesterEmpty = await createPlainLoginFixtureUser("part7-empty");

    const apiA = await loginApiContext(browser, requesterA);
    const apiB = await loginApiContext(browser, requesterB);
    const apiEmpty = await loginApiContext(browser, requesterEmpty);

    const categories: Array<{ id: number; name: string }> = await (
      await apiA.get("/api/categories")
    ).json();
    const relatedSystems: Array<{ id: number; name: string }> = await (
      await apiA.get("/api/related-systems")
    ).json();
    function categoryIdByName(name: string): number {
      const found = categories.find((c) => c.name === name);
      if (!found) {
        throw new Error(
          `Seeded category "${name}" not found via GET /api/categories — check server/prisma/seed.ts.`,
        );
      }
      return found.id;
    }
    function relatedSystemIdByName(name: string): number {
      const found = relatedSystems.find((s) => s.name === name);
      if (!found) {
        throw new Error(
          `Seeded related system "${name}" not found via GET /api/related-systems — check server/prisma/seed.ts.`,
        );
      }
      return found.id;
    }

    // Precondition for the empty-state screenshot (ui-spec.md §9 "Empty —
    // Requester owns zero tickets"): checked live, not assumed. A freshly
    // created fixture row is reliably empty by construction, but this
    // tripwire still guards against a future edit accidentally seeding a
    // ticket for `requesterEmpty`.
    const emptyTickets: { meta: { totalItems: number } } = await (
      await apiEmpty.get("/api/tickets")
    ).json();
    if (emptyTickets.meta.totalItems !== 0) {
      throw new Error(
        `Expected requesterEmpty (id ${requesterEmpty.id}) to own zero tickets ` +
          `for the empty-state screenshot, but found ${emptyTickets.meta.totalItems}.`,
      );
    }

    // --- requesterA: 12 self-created tickets -------------------------------
    // Ordered so the last one created (newest, therefore top of the default
    // list and on page 1) is the reference ticket the search / filter shots
    // assert on. Categories and priorities are spread deliberately: the
    // "filters applied" screenshot narrows to Network + High and every
    // remaining row is checked against that Category in the DOM.
    const requesterAFixtures: Array<{
      category: string;
      relatedSystem: string;
      priority: "LOW" | "MEDIUM" | "HIGH";
      summary: string;
      description: string;
    }> = [
      {
        category: "Hardware",
        relatedSystem: "Corporate Laptop",
        priority: "MEDIUM",
        summary: "Laptop fan runs at full speed constantly",
        description:
          "The corporate laptop fan spins at full speed within minutes of booting even with no heavy applications open.",
      },
      {
        category: "Hardware",
        relatedSystem: "Printer",
        priority: "LOW",
        summary: "Third-floor printer jams on every multi-page job",
        description:
          "The shared printer on the third floor jams on nearly every multi-page job and needs the tray cleared each time.",
      },
      {
        category: "Hardware",
        relatedSystem: "Corporate Laptop",
        priority: "HIGH",
        summary: "Corporate laptop will not power on at all",
        description:
          "The corporate laptop shows no lights and does not respond to the power button even after charging overnight.",
      },
      {
        category: "Software",
        relatedSystem: "LEB2 App",
        priority: "LOW",
        summary: "LEB2 app shows a stale course list after login",
        description:
          "The LEB2 application keeps showing last semester's course list and does not refresh after signing out and back in.",
      },
      {
        category: "Software",
        relatedSystem: "Grade Submission App",
        priority: "MEDIUM",
        summary: "Grade submission export fails partway through",
        description:
          "Exporting grades to a spreadsheet from the grade submission application fails with a generic error partway through.",
      },
      {
        category: "Software",
        relatedSystem: "LEB2 App",
        priority: "HIGH",
        summary: "Cannot sign in to LEB2 — unexpected error",
        description:
          "Signing in to the LEB2 application returns an unexpected error on every attempt since this morning, blocking all work.",
      },
      {
        category: "Account and Access",
        relatedSystem: "Email",
        priority: "MEDIUM",
        summary: "Mailbox over-quota warnings persist after archiving",
        description:
          "The mailbox keeps showing over-quota warnings even after archiving several gigabytes of old messages yesterday.",
      },
      {
        category: "Account and Access",
        relatedSystem: "Email",
        priority: "LOW",
        summary: "Department distribution list membership is wrong",
        description:
          "Messages sent to the department distribution list are not delivered to two team members who should be on it.",
      },
      {
        category: "Network",
        relatedSystem: "Campus Wi-Fi",
        priority: "LOW",
        summary: "Weak Wi-Fi signal in the ground-floor meeting room",
        description:
          "The Wi-Fi signal in the ground floor meeting room drops to one bar and disconnects during video calls.",
      },
      {
        category: "Network",
        relatedSystem: "VPN",
        priority: "MEDIUM",
        summary: "VPN is slow to establish a connection each morning",
        description:
          "The VPN client takes several minutes to establish a connection each morning before any internal site loads.",
      },
      {
        category: "Network",
        relatedSystem: "Campus Wi-Fi",
        priority: "HIGH",
        summary: "Campus Wi-Fi drops every few minutes on all devices",
        description:
          "The campus Wi-Fi connection drops roughly every five minutes on every device, forcing a manual reconnect each time.",
      },
      {
        category: "Network",
        relatedSystem: "VPN",
        priority: "HIGH",
        summary: "Cannot connect to VPN from the home network",
        description:
          "The VPN connection fails immediately from the home network with an authentication error, though the account works on site.",
      },
    ];

    for (const [index, fixture] of requesterAFixtures.entries()) {
      const response = await apiA.post("/api/tickets", {
        data: {
          categoryId: categoryIdByName(fixture.category),
          relatedSystemId: relatedSystemIdByName(fixture.relatedSystem),
          requestedPriority: fixture.priority,
          summary: fixture.summary,
          description: fixture.description,
        },
      });
      if (response.status() !== 201) {
        throw new Error(
          `Seed POST /api/tickets for requesterA failed: ${response.status()} ${await response.text()}`,
        );
      }
      const created: {
        id: number;
        ticketNumber: string;
        category: { name: string };
        requestedPriority: "LOW" | "MEDIUM" | "HIGH";
      } = await response.json();
      requesterATicketNumbers.push(created.ticketNumber);
      if (index === requesterAFixtures.length - 1) {
        referenceTicket = {
          id: created.id,
          ticketNumber: created.ticketNumber,
          categoryName: created.category.name,
          priority: created.requestedPriority,
        };
      }
    }

    // Guard the two facts the rest of this Part relies on, so an edit to
    // requesterAFixtures above can't silently invalidate the screenshots.
    if (requesterATicketNumbers.length <= 10) {
      throw new Error(
        "Part 7 needs requesterA to own more than one page of tickets (page " +
          `size 10); seeded only ${requesterATicketNumbers.length}.`,
      );
    }
    if (
      referenceTicket.categoryName !== "Network" ||
      referenceTicket.priority !== "HIGH"
    ) {
      throw new Error(
        "Part 7 expects the requesterA reference ticket to be Network / HIGH " +
          `(got ${referenceTicket.categoryName} / ${referenceTicket.priority}).`,
      );
    }

    // requesterB gets their own real tickets through the real
    // POST /api/tickets endpoint — never inserted directly.
    const requesterBFixtures = [
      {
        summary: "Requester B evidence ticket: mouse stopped working",
        description:
          "The wireless mouse disconnects randomly during the workday and needs a battery or driver check.",
        priority: "LOW" as const,
      },
      {
        summary: "Requester B evidence ticket: email sync delayed",
        description:
          "Incoming email is arriving with a delay of twenty to thirty minutes on the desktop client only.",
        priority: "MEDIUM" as const,
      },
    ];
    for (const [index, fixture] of requesterBFixtures.entries()) {
      const response = await apiB.post("/api/tickets", {
        data: {
          categoryId: categories[index % categories.length].id,
          relatedSystemId: relatedSystems[index % relatedSystems.length].id,
          requestedPriority: fixture.priority,
          summary: fixture.summary,
          description: fixture.description,
        },
      });
      if (response.status() !== 201) {
        throw new Error(
          `Seed POST /api/tickets for requesterB failed: ${response.status()} ${await response.text()}`,
        );
      }
      const created: { ticketNumber: string } = await response.json();
      requesterBTicketNumbers.push(created.ticketNumber);
    }

    await apiA.dispose();
    await apiB.dispose();
    await apiEmpty.dispose();
  });

  test("Requester A's ticket list, then switching to Requester B makes A's ticket disappear", async ({
    page,
  }) => {
    await page.setViewportSize(DESKTOP);
    await loginAsFixture(page, requesterA);

    const rows = page.locator(".zen-my-tickets__table tbody tr");
    await expect(rows.first()).toBeVisible();
    await expect(
      page.getByRole("link", { name: referenceTicket.ticketNumber, exact: true }),
    ).toBeVisible();
    await page.screenshot({
      path: shot(PART7_DIR, "01-requesterA-ticket-list.png"),
      fullPage: true,
    });

    await switchRequesterTo(page, requesterB);
    await expect(rows.first()).toBeVisible();
    for (const ticketNumber of requesterBTicketNumbers) {
      await expect(
        page.getByRole("link", { name: ticketNumber, exact: true }),
      ).toBeVisible();
    }
    // The core evidence: Requester A's ticket is genuinely gone from
    // Requester B's list.
    await expect(
      page.getByRole("link", {
        name: referenceTicket.ticketNumber,
        exact: true,
      }),
    ).toHaveCount(0);
    await page.screenshot({
      path: shot(PART7_DIR, "02-after-switch-requesterB-ticket-list.png"),
      fullPage: true,
    });
  });

  test("search in use, with a matching result", async ({ page }) => {
    await page.setViewportSize(DESKTOP);
    await loginAsFixture(page, requesterA);
    await expect(
      page.locator(".zen-my-tickets__table tbody tr").first(),
    ).toBeVisible();

    await page
      .getByPlaceholder("Search by ticket number or summary")
      .fill(referenceTicket.ticketNumber);

    const rows = page.locator(".zen-my-tickets__table tbody tr");
    await expect.poll(() => rows.count()).toBe(1);
    await expect(
      page.getByRole("link", { name: referenceTicket.ticketNumber, exact: true }),
    ).toBeVisible();
    await page.screenshot({
      path: shot(PART7_DIR, "03-search-matching-result.png"),
      fullPage: true,
    });
  });

  test("filters applied: category, priority, and status", async ({ page }) => {
    await page.setViewportSize(DESKTOP);
    await loginAsFixture(page, requesterA);
    await expect(
      page.locator(".zen-my-tickets__table tbody tr").first(),
    ).toBeVisible();

    const priorityLabel: Record<"LOW" | "MEDIUM" | "HIGH", string> = {
      LOW: "Low",
      MEDIUM: "Medium",
      HIGH: "High",
    };
    await page
      .getByLabel("Category")
      .selectOption({ label: referenceTicket.categoryName });
    await page
      .getByLabel("Priority")
      .selectOption({ label: priorityLabel[referenceTicket.priority] });
    await page.getByLabel("Status").selectOption({ label: "New" });

    const rows = page.locator(".zen-my-tickets__table tbody tr");
    await expect.poll(() => rows.count()).toBeGreaterThan(0);
    // Every visible row genuinely matches the chosen Category (independent
    // check against the rendered DOM, not a second parallel API call).
    const rowCount = await rows.count();
    for (let i = 0; i < rowCount; i++) {
      await expect(rows.nth(i).locator("td").nth(3)).toHaveText(
        referenceTicket.categoryName,
      );
    }
    // The reference ticket itself — which necessarily matches all three
    // filters — is genuinely among the results.
    await expect(
      page.getByRole("link", { name: referenceTicket.ticketNumber, exact: true }),
    ).toBeVisible();
    await page.screenshot({
      path: shot(PART7_DIR, "04-filters-applied.png"),
      fullPage: true,
    });
  });

  test("sorting applied: a non-default sort visibly active", async ({ page }) => {
    await page.setViewportSize(DESKTOP);
    await loginAsFixture(page, requesterA);

    const firstNumberCell = page
      .locator(".zen-my-tickets__table tbody tr")
      .first()
      .locator("td")
      .first();
    await expect(firstNumberCell).toBeVisible();
    const defaultTopTicketNumber = (await firstNumberCell.textContent())?.trim();

    await page
      .getByLabel("Sort", { exact: true })
      .selectOption({ label: "Ticket number (A→Z)" });

    // Wait for the reload to genuinely change the top row before reading
    // further — proves the sort actually took effect, not just that the
    // <select>'s own value changed.
    await expect
      .poll(async () => (await firstNumberCell.textContent())?.trim())
      .not.toBe(defaultTopTicketNumber);

    const rows = page.locator(".zen-my-tickets__table tbody tr");
    const sampleSize = Math.min(await rows.count(), 5);
    const ticketNumbers: string[] = [];
    for (let i = 0; i < sampleSize; i++) {
      const text = await rows.nth(i).locator("td").first().textContent();
      ticketNumbers.push((text ?? "").trim());
    }
    // Independently computed expectation (plain string sort on the
    // rendered values themselves) rather than a second call to the
    // endpoint under test.
    const expectedAscending = [...ticketNumbers].sort((a, b) =>
      a < b ? -1 : a > b ? 1 : 0,
    );
    expect(ticketNumbers).toEqual(expectedAscending);

    await page.screenshot({
      path: shot(PART7_DIR, "05-sorting-applied.png"),
      fullPage: true,
    });
  });

  test("pagination: page 2 with the range indicator visible", async ({
    page,
  }) => {
    await page.setViewportSize(DESKTOP);
    await loginAsFixture(page, requesterA);

    const summary = page.locator(".zen-pagination__summary");
    await expect(summary).toBeVisible();
    const initialText = (await summary.textContent()) ?? "";
    const match = initialText.match(/Showing 1–10 of (\d+)/);
    expect(match).not.toBeNull();
    const total = Number(match![1]);
    // Self-contained: requesterA's ticket count must be at least the number
    // this spec's beforeAll created for them (which alone already exceeds
    // the page size of 10), never a value assumed from accumulated data.
    expect(total).toBeGreaterThanOrEqual(requesterATicketNumbers.length);
    expect(requesterATicketNumbers.length).toBeGreaterThan(10);

    await page.getByRole("button", { name: "Page 2" }).click();
    await expect(summary).toHaveText(
      `Showing 11–${Math.min(20, total)} of ${total}`,
    );
    await expect(page.getByRole("button", { name: "Page 2" })).toHaveAttribute(
      "aria-current",
      "page",
    );
    await page.screenshot({
      path: shot(PART7_DIR, "06-pagination-page2.png"),
      fullPage: true,
    });
  });

  test("empty state: a Requester who owns zero tickets", async ({ page }) => {
    await page.setViewportSize(DESKTOP);
    await loginAsFixture(page, requesterEmpty);

    await expect(
      page.getByRole("heading", { name: "You haven't created any tickets yet." }),
    ).toBeVisible();
    // AC-29: the search/filter bar is hidden entirely in the true-empty
    // state — distinct from the no-results state below, where it stays
    // visible and populated.
    await expect(page.locator("#my-tickets-search")).toHaveCount(0);
    await page.screenshot({
      path: shot(PART7_DIR, "07-empty-state.png"),
      fullPage: true,
    });
  });

  test("no-results state: an active query matching nothing (distinct from empty)", async ({
    page,
  }) => {
    await page.setViewportSize(DESKTOP);
    await loginAsFixture(page, requesterA);
    await expect(
      page.locator(".zen-my-tickets__table tbody tr").first(),
    ).toBeVisible();

    await page
      .getByPlaceholder("Search by ticket number or summary")
      .fill("zzz-no-such-ticket-matches-this-zzz");

    await expect(
      page.getByText("No tickets match your search or filters."),
    ).toBeVisible();
    // Distinct from the empty-state wording/structure above: the search
    // bar (and the rest of the controls) stays visible and populated here.
    await expect(page.locator("#my-tickets-search")).toBeVisible();
    await expect(
      page.getByRole("heading", { name: "You haven't created any tickets yet." }),
    ).toHaveCount(0);
    await page.screenshot({
      path: shot(PART7_DIR, "08-no-results-state.png"),
      fullPage: true,
    });
  });

  test("cross-requester access rejected: Requester B visiting Requester A's ticket detail", async ({
    page,
  }) => {
    await page.setViewportSize(DESKTOP);
    await loginAsFixture(page, requesterEmpty);

    await page.goto(`/tickets/${referenceTicket.id}`);
    await expect(
      page.getByRole("heading", { name: "Ticket not found" }),
    ).toBeVisible();
    // client/src/screens/TicketDetailScreen.tsx's not-found copy no longer
    // mentions the deleted "development requester" concept — it now reads
    // "your account" for a real, session-authenticated Requester.
    await expect(
      page.getByText(
        "This ticket doesn't exist or isn't associated with your account.",
      ),
    ).toBeVisible();
    await page.screenshot({
      path: shot(PART7_DIR, "09-cross-requester-access-rejected.png"),
      fullPage: true,
    });
  });
});

// ---------------------------------------------------------------------------
// Answer Part 8 — Requester Ticket Detail & Attachments
// (ui-spec.md §10, api-spec.md §4, labsheet §8.5)
// ---------------------------------------------------------------------------

test.describe("Part 8 — Ticket Detail & Attachments", () => {
  // Every test here seeds its OWN ticket + attachment through the real
  // POST /api/tickets and POST /api/tickets/:id/attachments endpoints
  // (api-spec.md §3.1, §4.1), so no test depends on another's side effects
  // or on data left by Part 7. `pretest:e2e` TRUNCATEs the ticket tables
  // before every run.
  //
  // Originally "Sarah Johnson" (owner) and "Michael Brown" (a different
  // Requester, for the unauthorized-access shot) — replaced with two
  // dedicated fixture Requesters (`createPlainLoginFixtureUser`). The
  // owner's real name still needs to show up in the ticket-information card
  // (below), so this block, unlike Part 7, keeps an assertion against an
  // actual identity — it just reads the fixture's own `name` field instead
  // of a hardcoded literal, the same substitution Part 6 made.
  let requesterOwner: FixtureUser;
  let requesterOther: FixtureUser;
  let categoryId: number;
  let relatedSystemId: number;

  const FIXTURE_DIR = path.resolve(here, "../test-results/part8-attachments");

  /** A minimal but well-formed PDF envelope, `sizeKb` KB, under the 5 MB cap. */
  function writePdfFixture(name: string, sizeKb: number): string {
    fs.mkdirSync(FIXTURE_DIR, { recursive: true });
    const filePath = path.join(FIXTURE_DIR, name);
    fs.writeFileSync(filePath, `%PDF-1.4\n${" ".repeat(sizeKb * 1024)}\n%%EOF\n`);
    return filePath;
  }

  interface SeededTicket {
    id: number;
    ticketNumber: string;
    attachmentId: number;
  }

  /**
   * Creates one ticket owned by whoever `api`'s session belongs to, with a
   * single active PDF attachment, through the real API. Returns the ids the
   * tests key their assertions to. `api` must be a session-authenticated
   * context (`loginApiContext`) — the server derives the owning Requester
   * from the session, not a header.
   */
  async function seedTicketWithAttachment(
    api: Awaited<ReturnType<typeof playwrightRequest.newContext>>,
    attachmentName: string,
    sizeKb: number,
  ): Promise<SeededTicket> {
    const createResponse = await api.post("/api/tickets", {
      data: {
        categoryId,
        relatedSystemId,
        requestedPriority: "MEDIUM",
        summary:
          "Part 8 evidence: corporate laptop battery drains within an hour",
        description:
          "The corporate laptop battery drops from full to empty within an hour of unplugging, even with just a browser open.",
      },
    });
    if (createResponse.status() !== 201) {
      throw new Error(
        `Part 8 seed POST /api/tickets failed: ${createResponse.status()} ${await createResponse.text()}`,
      );
    }
    const created: { id: number; ticketNumber: string } =
      await createResponse.json();

    const pdfPath = writePdfFixture(attachmentName, sizeKb);
    const uploadResponse = await api.post(
      `/api/tickets/${created.id}/attachments`,
      {
        multipart: {
          file: {
            name: attachmentName,
            mimeType: "application/pdf",
            buffer: fs.readFileSync(pdfPath),
          },
        },
      },
    );
    if (uploadResponse.status() !== 201) {
      throw new Error(
        `Part 8 seed POST /api/tickets/:id/attachments failed: ${uploadResponse.status()} ${await uploadResponse.text()}`,
      );
    }
    const uploaded: { id: number } = await uploadResponse.json();
    return {
      id: created.id,
      ticketNumber: created.ticketNumber,
      attachmentId: uploaded.id,
    };
  }

  test.beforeAll(async () => {
    requesterOwner = await createPlainLoginFixtureUser("part8-owner");
    requesterOther = await createPlainLoginFixtureUser("part8-other");

    // GET /api/categories and /api/related-systems are unauthenticated
    // reference-data endpoints (server/src/app.ts mounts them with no
    // auth middleware), so a plain, session-less context is enough here.
    const api = await playwrightRequest.newContext({ baseURL: SERVER_URL });

    const categories: Array<{ id: number; name: string }> = await (
      await api.get("/api/categories")
    ).json();
    const relatedSystems: Array<{ id: number; name: string }> = await (
      await api.get("/api/related-systems")
    ).json();
    const cat = categories.find((c) => c.name === "Hardware")?.id;
    const rel = relatedSystems.find((r) => r.name === "Corporate Laptop")?.id;
    if (cat === undefined || rel === undefined) {
      throw new Error(
        "Part 8 seed: expected the seeded 'Hardware' category and 'Corporate Laptop' related system — check server/prisma/seed.ts.",
      );
    }
    categoryId = cat;
    relatedSystemId = rel;

    await api.dispose();
  });

  test("owned ticket detail (read-only header), adding an attachment via the Add control, and downloading an active one", async ({
    page,
    browser,
  }) => {
    const ATTACHMENT_NAME = "initial-report.pdf";
    const api = await loginApiContext(browser, requesterOwner);
    const ticket = await seedTicketWithAttachment(api, ATTACHMENT_NAME, 180);

    await page.setViewportSize(DESKTOP);
    await loginAsFixture(page, requesterOwner);
    await page.goto(`/tickets/${ticket.id}`);

    // --- Shot 1: a Requester viewing their own ticket's detail page ------
    await expect(
      page.getByRole("heading", { name: "Ticket Details", level: 1 }),
    ).toBeVisible();
    const infoCard = page.locator(".zen-ticket-detail__card").first();
    await expect(infoCard.getByText(ticket.ticketNumber)).toBeVisible();
    // The owning Requester shows in the ticket-information card — scoped
    // there, not the app-shell badge (which reads the same name on every
    // screen).
    await expect(infoCard.getByText(requesterOwner.name)).toBeVisible();
    // ui-spec.md §10 / BR-39 / tests.md C-29: every header field is static
    // text — the information card has no inputs at all.
    await expect(infoCard.locator("input, textarea, select")).toHaveCount(0);
    await expect(
      page.getByRole("heading", {
        name: "Attachments (1 active / 1 total)",
        level: 2,
      }),
    ).toBeVisible();
    const seededRow = page.locator(".zen-attachment-list__item", {
      hasText: ATTACHMENT_NAME,
    });
    await expect(seededRow).toBeVisible();
    await expect(
      seededRow.getByRole("button", { name: "Download" }),
    ).toBeVisible();
    await expect(
      seededRow.getByRole("button", { name: "Remove" }),
    ).toBeVisible();
    await page.screenshot({
      path: shot(PART8_DIR, "01-owned-ticket-detail.png"),
      fullPage: true,
    });

    // --- Shot 2: Add-attachment control after a file has been uploaded ---
    const addedName = "supplementary-log.pdf";
    await page
      .locator("#ticket-detail-attachments-input")
      .setInputFiles(writePdfFixture(addedName, 90));

    // A new active row appears and both counts in the heading advance
    // (ui-spec.md §10 "N active / M total", AC-21).
    await expect(
      page.getByRole("heading", {
        name: "Attachments (2 active / 2 total)",
        level: 2,
      }),
    ).toBeVisible();
    const addedRow = page.locator(".zen-attachment-list__item", {
      hasText: addedName,
    });
    await expect(addedRow).toBeVisible();
    await expect(
      addedRow.getByRole("button", { name: "Download" }),
    ).toBeVisible();
    await page.screenshot({
      path: shot(PART8_DIR, "02-add-attachment.png"),
      fullPage: true,
    });

    // --- Shot 3: downloading an active attachment (assert the GET is 200) -
    page.on("download", (download) => {
      // Accept + discard: the real <a download> click still fires (so the
      // save path is exercised) but the bytes aren't needed on disk.
      void download.path().catch(() => {});
    });
    const downloadResponsePromise = page.waitForResponse(
      (res) =>
        res.url().includes(`/api/attachments/${ticket.attachmentId}/download`) &&
        res.request().method() === "GET",
    );
    await seededRow.getByRole("button", { name: "Download" }).click();
    const downloadResponse = await downloadResponsePromise;
    // api-spec.md §4.3: an active attachment on an owned ticket → 200, with
    // the original filename in Content-Disposition.
    expect(downloadResponse.status()).toBe(200);
    expect(
      downloadResponse.headers()["content-disposition"] ?? "",
    ).toContain(ATTACHMENT_NAME);
    await page.screenshot({
      path: shot(PART8_DIR, "03-download-active-attachment.png"),
      fullPage: true,
    });

    await api.dispose();
  });

  test("soft removal with a reason: the confirmation dialog, the removed-row presentation, retained metadata, and the blocked download", async ({
    page,
    browser,
  }) => {
    const ATTACHMENT_NAME = "report-to-remove.pdf";
    const REMOVAL_REASON =
      "Uploaded the wrong report for this Part 8 evidence ticket";
    const api = await loginApiContext(browser, requesterOwner);
    const ticket = await seedTicketWithAttachment(api, ATTACHMENT_NAME, 180);

    await page.setViewportSize(DESKTOP);
    await loginAsFixture(page, requesterOwner);
    await page.goto(`/tickets/${ticket.id}`);

    const seededRow = page.locator(".zen-attachment-list__item", {
      hasText: ATTACHMENT_NAME,
    });
    await expect(
      seededRow.getByRole("button", { name: "Remove" }),
    ).toBeVisible();

    // --- Shot 4: Remove confirmation dialog open, reason typed in --------
    await seededRow.getByRole("button", { name: "Remove" }).click();
    const dialog = page.getByRole("dialog", { name: "Remove attachment" });
    await expect(dialog).toBeVisible();
    await expect(dialog).toContainText(ATTACHMENT_NAME);
    const reasonField = dialog.getByLabel("Reason for removal");
    await reasonField.fill(REMOVAL_REASON);
    await expect(reasonField).toHaveValue(REMOVAL_REASON);
    await page.screenshot({
      path: shot(PART8_DIR, "04-remove-dialog-with-reason.png"),
      fullPage: true,
    });

    // --- Shot 5: the result — the row in its "Removed" presentation -----
    await dialog.getByRole("button", { name: "Remove attachment" }).click();
    await expect(page.getByRole("dialog")).toHaveCount(0);
    // AC-34: a role="status" toast confirms the removal.
    await expect(
      page.locator(".zen-attachment-section__toast"),
    ).toContainText(`"${ATTACHMENT_NAME}" was removed.`);

    const removedRow = page.locator(".zen-attachment-list__item--removed");
    await expect(removedRow).toHaveCount(1);
    // ui-spec.md §10: the removed line is exactly `Removed <date> · "<reason>"`
    // — no "on", a middot separator, the reason wrapped in double quotes.
    await expect(
      removedRow.locator(".zen-attachment-list__removed-meta"),
    ).toHaveText(
      new RegExp(
        `^Removed \\d{1,2} [A-Z][a-z]{2}, \\d{2}:\\d{2} \\u00b7 "${REMOVAL_REASON.replace(
          /[.*+?^${}()|[\]\\]/g,
          "\\$&",
        )}"$`,
      ),
    );
    // This ticket's only attachment was just removed: 0 active, 1 total —
    // a removed attachment is retained, not deleted (BR-31).
    await expect(
      page.getByRole("heading", {
        name: "Attachments (0 active / 1 total)",
        level: 2,
      }),
    ).toBeVisible();
    await page.screenshot({
      path: shot(PART8_DIR, "05-attachment-removed-with-reason.png"),
      fullPage: true,
    });

    // --- Shot 6: retained metadata (BR-33, AC-36) ----------------------
    // name / size / type / removed-date / reason all still on the removed
    // row — the metadata is kept, only access is revoked.
    await expect(
      removedRow.locator(".zen-attachment-list__name"),
    ).toHaveText(ATTACHMENT_NAME);
    await expect(
      removedRow.locator(".zen-attachment-list__size"),
    ).toHaveText(/^\d+(\.\d+)?\s(KB|MB)$/);
    await expect(
      removedRow.locator(".zen-attachment-list__type"),
    ).toHaveText("PDF");
    await expect(removedRow).toContainText(REMOVAL_REASON);
    await page.screenshot({
      path: shot(PART8_DIR, "06-removed-metadata-retained.png"),
      fullPage: true,
    });

    // --- Shot 7: the removed attachment can't be downloaded ------------
    // The removed row offers no Download / Preview / Remove control
    // (BR-33, AC-36)…
    await expect(removedRow.getByRole("button")).toHaveCount(0);
    // …and the download endpoint itself now returns 410 ATTACHMENT_REMOVED
    // (api-spec.md §4.3) — proven by a direct API call, not just the UI.
    const blockedResponse = await api.get(
      `/api/attachments/${ticket.attachmentId}/download`,
    );
    expect(blockedResponse.status()).toBe(410);
    const blockedBody: { error: string } = await blockedResponse.json();
    expect(blockedBody.error).toBe("ATTACHMENT_REMOVED");
    await page.screenshot({
      path: shot(PART8_DIR, "07-removed-download-blocked.png"),
      fullPage: true,
    });

    await api.dispose();
  });

  test("unauthorized access rejected: a different Requester opening this ticket's /tickets/:id URL", async ({
    page,
    browser,
  }) => {
    const api = await loginApiContext(browser, requesterOwner);
    const ticket = await seedTicketWithAttachment(
      api,
      "owner-only-report.pdf",
      120,
    );
    await api.dispose();

    await page.setViewportSize(DESKTOP);
    // requesterOther is a distinct fixture row from requesterOwner
    // (createPlainLoginFixtureUser always inserts a fresh row per
    // discriminator), so it is not the ticket's owner by construction.
    await loginAsFixture(page, requesterOther);

    await page.goto(`/tickets/${ticket.id}`);
    // ui-spec.md §10 / AC-37, AC-38, BR-14: unknown and not-owned are the
    // same "Ticket not found" state, byte-identical copy.
    await expect(
      page.getByRole("heading", { name: "Ticket not found" }),
    ).toBeVisible();
    // client/src/screens/TicketDetailScreen.tsx's not-found copy no longer
    // mentions the deleted "development requester" concept — it now reads
    // "your account" for a real, session-authenticated Requester.
    await expect(
      page.getByText(
        "This ticket doesn't exist or isn't associated with your account.",
      ),
    ).toBeVisible();
    await page.screenshot({
      path: shot(PART8_DIR, "08-unauthorized-access-rejected.png"),
      fullPage: true,
    });
  });
});
