import { expect, test, type Page } from "@playwright/test";
import { loginAsSeededUser } from "../support/auth.js";
import {
  IT_STAFF_EMAIL,
  REQUESTER_EMAIL,
  cleanupLab4Fixtures,
  createLab4FixtureTicket,
  watchConsole,
} from "../support/lab4.js";

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
