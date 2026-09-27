import { AxeBuilder } from "@axe-core/playwright";
import { expect, test, type Locator, type Page, type TestInfo } from "@playwright/test";
import type { AxeResults, Result as AxeRuleResult } from "axe-core";
import {
  LOCAL_DEV_PASSWORD,
  createMustChangePasswordFixtureUser,
  createPlainLoginFixtureUser,
  loginAs,
  loginAsSeededUser,
} from "../support/auth.js";
import { createRequesterOwnedFixtureTicket } from "../support/staffFixtures.js";

// Lab 3 accessibility E2E coverage (docs/lab-03/tests.md §2.8/§2.9, Issue
// #74; specification.md AC-56 "the ui-spec.md visual checklist passes for
// clipping, overlap and focus"; ui-spec.md §13 Accessibility, which
// re-states "Lab 2 §12 applies unchanged" — docs/lab-02/ui-spec.md §12's
// label/landmark/contrast/focus rules). Before this file, no automated test
// anywhere in the repo ran an actual accessibility-rule-engine scan against
// a rendered Lab 3 screen: S-01..S-06 assert token/class discipline in
// jsdom, and R-05 asserts focus-ring *visibility* only. This file closes
// that gap with a real `axe-core` scan (via `@axe-core/playwright`) of the
// REAL rendered DOM, against the real client + real server + the shared
// `toktickit_e2e` Postgres database — same "no mocking" convention as every
// other Lab 3 spec in this directory.
//
// Scope: axe-core's automated ruleset catches a meaningful slice of WCAG
// (missing labels/names, contrast, landmark/ARIA misuse, etc.) but not
// everything a human accessibility audit would — it is a floor, not a
// substitute for the manual keyboard/reflow checks R-04/R-05 already cover.
// Every scan below runs the wcag2a/wcag2aa/wcag21a/wcag21aa tag set and
// fails on any 'serious' or 'critical' violation — 'minor'/'moderate'
// findings are reported (via the same detailed failure message) but do not
// fail the test, since Issue #74 asks for a genuine floor against real
// defects, not a zero-tolerance gate on debatable/cosmetic rule violations.
//
// IDs (A-01..) follow tests.md's per-level numbering convention (E2E-nn,
// R-nn, ...); this is the first "A-" (accessibility) level.

const IT_STAFF_EMAIL = "priya.natarajan@example.edu";
const ADMIN_EMAIL = "olivia.grant@example.edu";

const WCAG_TAGS = ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"];

/** Impact levels serious enough to fail a scan outright (Issue #74: "assert zero violations with impact 'serious' or 'critical'"). */
const FAILING_IMPACTS = new Set(["serious", "critical"]);

/**
 * `Button.css`'s `.zen-btn` rule transitions `background-color`/`color`
 * over 150ms, and `MessageThread.tsx`'s submit button toggles
 * `busy`/`disabled` around its `postEntry(...)` call — briefly disabling
 * the button (readonly-bg/muted-text colors), then re-enabling it
 * (primary/white) once the request resolves and the new entry renders.
 * Both the enabled state (white on `--zen-primary`) and the disabled state
 * (`--zen-text-muted` on `--zen-readonly-bg`) independently clear WCAG AA
 * contrast on their own — but a scan that lands mid-transition between the
 * two samples a transient, partially-blended colour pair that can fail
 * `color-contrast` even though neither real state ever does (observed
 * directly: axe reported `#a1aaa5` on `#89b9a4`, a blend of both states,
 * immediately after posting a comment). This waits for that button's
 * `background-color` to settle back to the real, fully-enabled `--zen-
 * primary` value before a scan runs, so the scan measures a state a user
 * (or a screen reader) actually rests on, not a ~150ms crossfade frame.
 */
async function waitForPrimaryButtonSettled(button: Locator): Promise<void> {
  await expect(button).toBeEnabled();
  await expect
    .poll(() => button.evaluate((el) => getComputedStyle(el).backgroundColor))
    .toBe("rgb(0, 107, 60)"); // --zen-primary (theme.css)
}

/**
 * Runs an axe-core scan against the current page and asserts no
 * 'serious'/'critical' violation exists. On failure, the assertion message
 * lists each failing rule's id, impact and every affected target selector —
 * "actionable", per this dispatch's own instructions, rather than a bare
 * pass/fail. Also attaches the full JSON report to the test result (visible
 * in the HTML/list reporter output and any trace) so a 'minor'/'moderate'
 * finding that didn't fail the test is still discoverable, not silently
 * dropped.
 */
async function assertNoSeriousViolations(page: Page, testInfo: TestInfo): Promise<void> {
  const results: AxeResults = await new AxeBuilder({ page }).withTags(WCAG_TAGS).analyze();

  await testInfo.attach("axe-results", {
    body: JSON.stringify(results.violations, null, 2),
    contentType: "application/json",
  });

  const failing = results.violations.filter(
    (violation: AxeRuleResult) =>
      violation.impact != null && FAILING_IMPACTS.has(violation.impact),
  );

  if (failing.length === 0) return;

  const detail = failing
    .map((violation: AxeRuleResult) => {
      const targets = violation.nodes
        .map((node) => `    - ${node.target.map((t) => (Array.isArray(t) ? t.join(" ") : t)).join(" ")}`)
        .join("\n");
      return (
        `  [${violation.impact}] ${violation.id}: ${violation.help}\n` +
        `  ${violation.helpUrl}\n` +
        `  targets:\n${targets}`
      );
    })
    .join("\n\n");

  expect(
    failing.length,
    `axe-core found ${failing.length} serious/critical violation(s):\n\n${detail}`,
  ).toBe(0);
}

// ---------------------------------------------------------------------------
// A-01: Login (AC-56, ui-spec.md §13 / Lab 2 §12)
// ---------------------------------------------------------------------------

test.describe("A-01 Login accessibility (AC-56)", () => {
  test("the Login screen has no serious/critical accessibility violations", async ({
    page,
  }, testInfo) => {
    await page.goto("/login");
    await expect(page.locator("#login-email")).toBeVisible();
    await assertNoSeriousViolations(page, testInfo);
  });
});

// ---------------------------------------------------------------------------
// A-02: Change Password, forced (AC-56, ui-spec.md §6/§13)
// ---------------------------------------------------------------------------

test.describe("A-02 Change Password (forced) accessibility (AC-56)", () => {
  test("the forced Change Password screen has no serious/critical accessibility violations", async ({
    page,
  }, testInfo) => {
    const fixtureUser = await createMustChangePasswordFixtureUser();
    await loginAs(page, fixtureUser.email, LOCAL_DEV_PASSWORD);
    await expect(page).toHaveURL(/\/change-password$/);
    await expect(
      page.getByRole("status").filter({ hasText: "Choose a new password before continuing." }),
    ).toBeVisible();
    await assertNoSeriousViolations(page, testInfo);
  });
});

// ---------------------------------------------------------------------------
// A-03: Requester My Tickets (AC-56)
// ---------------------------------------------------------------------------

test.describe("A-03 Requester My Tickets accessibility (AC-56)", () => {
  test("the My Tickets list has no serious/critical accessibility violations", async ({
    page,
  }, testInfo) => {
    const requester = await createPlainLoginFixtureUser("a11y-my-tickets");
    await loginAs(page, requester.email, LOCAL_DEV_PASSWORD);
    await expect(page).toHaveURL(/\/tickets$/);
    await expect(page.getByRole("heading", { name: "My Tickets" })).toBeVisible();
    await assertNoSeriousViolations(page, testInfo);
  });
});

// ---------------------------------------------------------------------------
// A-04: Requester Ticket Detail, with Public Comments (AC-56, AC-21, AC-42)
// ---------------------------------------------------------------------------

test.describe("A-04 Requester Ticket Detail (with Public Comments) accessibility (AC-56)", () => {
  test("Requester Ticket Detail, with a posted Public Comment, has no serious/critical accessibility violations", async ({
    page,
  }, testInfo) => {
    const ticket = await createRequesterOwnedFixtureTicket("a11y-requester-detail", "TKT-2026-991020");
    await loginAs(page, ticket.requester.email, LOCAL_DEV_PASSWORD);
    await page.goto(`/tickets/${ticket.id}`);
    await expect(page.getByRole("heading", { name: "Ticket Details" })).toBeVisible();

    // Post a real Public Comment so the scan covers a populated thread
    // (composer + at least one rendered entry), not just its empty state.
    await page.locator("#message-thread-public-body").fill("Checking in on this — any update?");
    const postButton = page.getByRole("button", { name: "Post comment" });
    await postButton.click();
    await expect(page.getByText("Checking in on this — any update?")).toBeVisible();
    await waitForPrimaryButtonSettled(postButton);

    await assertNoSeriousViolations(page, testInfo);
  });
});

// ---------------------------------------------------------------------------
// A-05: IT Staff Ticket Queue (AC-56)
// ---------------------------------------------------------------------------

test.describe("A-05 IT Staff Ticket Queue accessibility (AC-56)", () => {
  test("the Ticket Queue has no serious/critical accessibility violations", async ({
    page,
  }, testInfo) => {
    await loginAsSeededUser(page, IT_STAFF_EMAIL);
    await page.goto("/staff/tickets");
    await expect(page.getByRole("heading", { name: "Ticket Queue" })).toBeVisible();
    await expect(page.locator(".zen-staff-queue__row-link").first()).toBeVisible();
    await assertNoSeriousViolations(page, testInfo);
  });

  test("the Ticket Queue at mobile width (390px) has no serious/critical accessibility violations", async ({
    page,
  }, testInfo) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await loginAsSeededUser(page, IT_STAFF_EMAIL);
    await page.goto("/staff/tickets");
    await expect(page.getByRole("heading", { name: "Ticket Queue" })).toBeVisible();
    await expect(page.locator(".zen-staff-queue__card").first()).toBeVisible();
    await assertNoSeriousViolations(page, testInfo);
  });
});

// ---------------------------------------------------------------------------
// A-06: IT Staff Ticket Detail, with Internal Notes panel (AC-56, AC-41, AC-42)
// ---------------------------------------------------------------------------

test.describe("A-06 IT Staff Ticket Detail (with Internal Notes) accessibility (AC-56)", () => {
  test("IT Staff Ticket Detail, with the Internal Notes panel populated, has no serious/critical accessibility violations", async ({
    page,
  }, testInfo) => {
    const ticket = await createRequesterOwnedFixtureTicket("a11y-staff-detail", "TKT-2026-991021");
    await loginAsSeededUser(page, IT_STAFF_EMAIL);
    await page.goto(`/staff/tickets/${ticket.id}`);
    await expect(page.getByRole("heading", { name: "Ticket Details" })).toBeVisible();

    const internalThread = page.locator(".thread--internal");
    await expect(
      internalThread.getByRole("heading", { name: "Internal notes" }),
    ).toBeVisible();
    await page
      .locator("#message-thread-internal-body")
      .fill("Internal only: checked the logs, nothing unusual yet.");
    const saveNoteButton = internalThread.getByRole("button", { name: "Save internal note" });
    await saveNoteButton.click();
    await expect(
      internalThread.getByText("Internal only: checked the logs, nothing unusual yet."),
    ).toBeVisible();
    await waitForPrimaryButtonSettled(saveNoteButton);

    await assertNoSeriousViolations(page, testInfo);
  });
});

// ---------------------------------------------------------------------------
// A-07: Administrator User Management — list (AC-56)
// ---------------------------------------------------------------------------

test.describe("A-07 Administrator User Management (list) accessibility (AC-56)", () => {
  test("the User Management list has no serious/critical accessibility violations", async ({
    page,
  }, testInfo) => {
    await loginAsSeededUser(page, ADMIN_EMAIL);
    await page.goto("/admin/users");
    await expect(page.getByRole("heading", { name: "User Management" })).toBeVisible();
    await assertNoSeriousViolations(page, testInfo);
  });

  test("the User Management list at mobile width (390px) has no serious/critical accessibility violations", async ({
    page,
  }, testInfo) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await loginAsSeededUser(page, ADMIN_EMAIL);
    await page.goto("/admin/users");
    await expect(page.getByRole("heading", { name: "User Management" })).toBeVisible();
    await assertNoSeriousViolations(page, testInfo);
  });
});

// ---------------------------------------------------------------------------
// A-08: Administrator User Management — Create dialog open (AC-56)
// ---------------------------------------------------------------------------

test.describe("A-08 Administrator User Management (Create dialog) accessibility (AC-56)", () => {
  test("the open Create User dialog has no serious/critical accessibility violations", async ({
    page,
  }, testInfo) => {
    await loginAsSeededUser(page, ADMIN_EMAIL);
    await page.goto("/admin/users");
    await expect(page.getByRole("heading", { name: "User Management" })).toBeVisible();

    await page.getByRole("button", { name: "New user" }).click();
    const dialog = page.getByRole("dialog");
    await expect(dialog.getByRole("heading", { name: "New user" })).toBeVisible();

    await assertNoSeriousViolations(page, testInfo);
  });
});

// ---------------------------------------------------------------------------
// A-09: Forbidden screen (AC-18, AC-56)
// ---------------------------------------------------------------------------

test.describe("A-09 Forbidden screen accessibility (AC-18, AC-56)", () => {
  test("a Requester's forbidden-state view of an Administrator route has no serious/critical accessibility violations", async ({
    page,
  }, testInfo) => {
    const requester = await createPlainLoginFixtureUser("a11y-forbidden");
    await loginAs(page, requester.email, LOCAL_DEV_PASSWORD);
    await expect(page).toHaveURL(/\/tickets$/);

    await page.goto("/admin/users");
    await expect(
      page.getByRole("heading", { name: "You don't have access to this page" }),
    ).toBeVisible();

    await assertNoSeriousViolations(page, testInfo);
  });
});
