import { expect, test, type Browser, type Page } from "@playwright/test";
import { loginAsSeededUser } from "../support/auth.js";
import {
  IT_STAFF_EMAIL,
  cleanupLab4Fixtures,
  countActionsOf,
  createFlowStaffUser,
  createLab4FixtureTicket,
  setUserActive,
} from "../support/lab4.js";

// E2E-01..E2E-06 (docs/lab-04/tests.md §2): the Actions Taken flow end to end
// in the browser against the real server and the dedicated `toktickit_e2e`
// database. Every Ticket here is a fixture in the TKT-2026-9974xx band that
// `cleanupLab4Fixtures` removes in afterAll, so the seeded dashboards keep
// their numbers for the specs that run after this file.

const CARLOS_EMAIL = "carlos.mendes@example.edu";

test.afterAll(cleanupLab4Fixtures);

async function openStaffDetail(page: Page, email: string, ticketId: number): Promise<void> {
  await loginAsSeededUser(page, email);
  await page.goto(`/staff/tickets/${ticketId}`);
  await expect(page.getByRole("heading", { name: /^Actions Taken \(\d+\)$/ })).toBeVisible();
}

async function signedInPage(browser: Browser, email: string, ticketId: number): Promise<Page> {
  const context = await browser.newContext();
  const page = await context.newPage();
  await openStaffDetail(page, email, ticketId);
  return page;
}

/** `datetime-local` value (Bangkok wall clock, as the form uses) for `hoursFromNow` hours from now. */
function bangkokInputValue(hoursFromNow: number): string {
  const at = new Date(Date.now() + hoursFromNow * 3_600_000);
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat("en-CA", {
      timeZone: "Asia/Bangkok",
      hourCycle: "h23",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
    })
      .formatToParts(at)
      .map((p) => [p.type, p.value]),
  );
  return `${parts.year}-${parts.month}-${parts.day}T${parts.hour}:${parts.minute}`;
}

function rowOf(page: Page, text: string) {
  return page.getByRole("row").filter({ hasText: text });
}

// ---------------------------------------------------------------------------
// E2E-01
// ---------------------------------------------------------------------------

test("E2E-01 IT Staff records an Action: it lists with their name as performer and the chosen assignee (AC-01, AC-37)", async ({ page }) => {
  const ticket = await createLab4FixtureTicket("l4-e2e01", "TKT-2026-997400", { actions: [] });
  await openStaffDetail(page, IT_STAFF_EMAIL, ticket.id);
  await expect(page.getByText("No actions recorded yet.")).toBeVisible();
  await expect(page.locator(".zen-actions__shared")).toHaveText("Visible to the requester");

  await page.getByRole("button", { name: "Add action" }).click();
  const form = page.getByRole("form", { name: "Add action" });
  // Performed by is the signed-in user, as static text, never an input.
  await expect(form.locator(".zen-action-form__static")).toHaveText("Priya Natarajan");
  await expect(form.getByText("Recorded automatically.")).toBeVisible();
  await form.getByLabel("Description").fill("Re-seated the docking station cable.");
  await form.getByLabel("Assignee").selectOption({ label: "Carlos Mendes" });
  await form.getByRole("button", { name: "Save action" }).click();

  await expect(page.getByRole("status").filter({ hasText: "Action saved." })).toBeVisible();
  await expect(form).toHaveCount(0);
  await expect(page.getByRole("heading", { name: "Actions Taken (1)" })).toBeVisible();
  const row = rowOf(page, "Re-seated the docking station cable.");
  await expect(row).toContainText("Priya Natarajan");
  await expect(row).toContainText("→ Carlos Mendes");
  await expect(row.getByText("Planned", { exact: true })).toBeVisible();

  // It is persisted, not just rendered: a reload still lists it with the same performer and assignee.
  await page.reload();
  const reloaded = rowOf(page, "Re-seated the docking station cable.");
  await expect(reloaded).toContainText("Priya Natarajan");
  await expect(reloaded).toContainText("→ Carlos Mendes");
});

// ---------------------------------------------------------------------------
// E2E-02
// ---------------------------------------------------------------------------

test("E2E-02 different staff on one Ticket: each Action keeps its own performer and Carlos edits Priya's open Action (AC-11)", async ({ browser }) => {
  const ticket = await createLab4FixtureTicket("l4-e2e02", "TKT-2026-997401", {
    actions: [{ description: "Priya's planned driver rollout.", status: "PLANNED", hoursAgo: 3 }],
  });
  const priya = await signedInPage(browser, IT_STAFF_EMAIL, ticket.id);
  const carlos = await signedInPage(browser, CARLOS_EMAIL, ticket.id);

  // Priya records one; Carlos records one.
  await priya.getByRole("button", { name: "Add action" }).click();
  await priya.getByRole("form", { name: "Add action" }).getByLabel("Description").fill("Priya checked the print queue.");
  await priya.getByRole("form", { name: "Add action" }).getByRole("button", { name: "Save action" }).click();
  await expect(priya.getByRole("heading", { name: "Actions Taken (2)" })).toBeVisible();

  await carlos.reload();
  await expect(carlos.getByRole("heading", { name: "Actions Taken (2)" })).toBeVisible();
  await carlos.getByRole("button", { name: "Add action" }).click();
  await expect(carlos.getByRole("form", { name: "Add action" }).locator(".zen-action-form__static")).toHaveText("Carlos Mendes");
  await carlos.getByRole("form", { name: "Add action" }).getByLabel("Description").fill("Carlos tested a spare cable.");
  await carlos.getByRole("form", { name: "Add action" }).getByRole("button", { name: "Save action" }).click();
  await expect(carlos.getByRole("heading", { name: "Actions Taken (3)" })).toBeVisible();

  // Carlos moves Priya's open Action along; its performer does not change.
  await rowOf(carlos, "Priya's planned driver rollout.").getByRole("button", { name: /^Edit action/ }).click();
  const edit = carlos.getByRole("form", { name: "Edit action" });
  await edit.getByLabel("Status").selectOption("IN_PROGRESS");
  await edit.getByRole("button", { name: "Save action" }).click();
  await expect(carlos.getByRole("status").filter({ hasText: "Action saved." })).toBeVisible();
  const rolledOut = rowOf(carlos, "Priya's planned driver rollout.");
  await expect(rolledOut.getByText("In progress", { exact: true })).toBeVisible();
  await expect(rolledOut).toContainText("Priya Natarajan");

  // Priya's own session sees all three, each with its own performer.
  await priya.reload();
  await expect(priya.getByRole("heading", { name: "Actions Taken (3)" })).toBeVisible();
  await expect(rowOf(priya, "Priya checked the print queue.")).toContainText("Priya Natarajan");
  await expect(rowOf(priya, "Carlos tested a spare cable.")).toContainText("Carlos Mendes");
  await expect(rowOf(priya, "Priya's planned driver rollout.").getByText("In progress", { exact: true })).toBeVisible();

  await priya.context().close();
  await carlos.context().close();
});

// ---------------------------------------------------------------------------
// E2E-03
// ---------------------------------------------------------------------------

test("E2E-03 edit, progress, complete and cancel: a completed row loses Edit and Cancel goes through the confirm dialog (AC-09, AC-10)", async ({ page }) => {
  const ticket = await createLab4FixtureTicket("l4-e2e03", "TKT-2026-997402", {
    actions: [
      { description: "Swap the failing SSD.", status: "PLANNED", hoursAgo: 8 },
      { description: "Schedule the evening re-image.", status: "PLANNED", hoursAgo: 7 },
    ],
  });
  await openStaffDetail(page, IT_STAFF_EMAIL, ticket.id);
  const form = page.getByRole("form", { name: "Edit action" });
  const saved = page.getByRole("status").filter({ hasText: "Action saved." });

  // Edit the description of a Planned Action.
  await rowOf(page, "Swap the failing SSD.").getByRole("button", { name: /^Edit action/ }).click();
  await form.getByLabel("Description").fill("Swap the failing SSD in bay 2.");
  await form.getByRole("button", { name: "Save action" }).click();
  await expect(saved).toBeVisible();
  await expect(rowOf(page, "Swap the failing SSD in bay 2.").getByText("Planned", { exact: true })).toBeVisible();

  // Planned -> In progress: only permitted next states are offered.
  await rowOf(page, "Swap the failing SSD in bay 2.").getByRole("button", { name: /^Edit action/ }).click();
  await expect(form.getByLabel("Status").locator("option")).toHaveText(["Planned", "In progress", "Cancelled"]);
  await form.getByLabel("Status").selectOption("IN_PROGRESS");
  await form.getByRole("button", { name: "Save action" }).click();
  await expect(rowOf(page, "Swap the failing SSD in bay 2.").getByText("In progress", { exact: true })).toBeVisible();

  // In progress -> Completed needs a result; then the row loses Edit.
  await rowOf(page, "Swap the failing SSD in bay 2.").getByRole("button", { name: /^Edit action/ }).click();
  await form.getByLabel("Status").selectOption("COMPLETED");
  await form.getByRole("button", { name: "Save action" }).click();
  await expect(form.getByText("Enter the result to complete this action.")).toBeVisible();
  await form.getByLabel("Result").fill("New SSD installed and the disk check passed.");
  await form.getByRole("button", { name: "Save action" }).click();
  const done = rowOf(page, "Swap the failing SSD in bay 2.");
  await expect(done.getByText("Completed", { exact: true })).toBeVisible();
  await expect(done.getByRole("button", { name: /^Edit action/ })).toHaveCount(0);
  await expect(done.getByRole("button", { name: /^View action/ })).toBeVisible();

  // Cancel the other Action: dismissing the dialog changes nothing, confirming cancels it.
  await rowOf(page, "Schedule the evening re-image.").getByRole("button", { name: /^Edit action/ }).click();
  await form.getByLabel("Status").selectOption("CANCELLED");
  await form.getByRole("button", { name: "Save action" }).click();
  const dialog = page.getByRole("dialog", { name: "Cancel this action?" });
  await expect(dialog).toBeVisible();
  await dialog.getByRole("button", { name: "Cancel", exact: true }).click();
  await expect(dialog).toHaveCount(0);
  await expect(form).toBeVisible();
  await form.getByRole("button", { name: "Save action" }).click();
  await dialog.getByRole("button", { name: "Cancel action" }).click();
  await expect(saved).toBeVisible();
  const cancelled = rowOf(page, "Schedule the evening re-image.");
  await expect(cancelled.getByText("Cancelled", { exact: true })).toBeVisible();
  await expect(cancelled.getByRole("button", { name: /^Edit action/ })).toHaveCount(0);

  await page.reload();
  await expect(rowOf(page, "Swap the failing SSD in bay 2.").getByText("Completed", { exact: true })).toBeVisible();
  await expect(rowOf(page, "Schedule the evening re-image.").getByText("Cancelled", { exact: true })).toBeVisible();
});

// ---------------------------------------------------------------------------
// E2E-04
// ---------------------------------------------------------------------------

test("E2E-04 validation messages sit below their fields with the values kept (AC-04, AC-05, AC-06)", async ({ page }) => {
  const ticket = await createLab4FixtureTicket("l4-e2e04", "TKT-2026-997403", { actions: [] });
  await openStaffDetail(page, IT_STAFF_EMAIL, ticket.id);
  await page.getByRole("button", { name: "Add action" }).click();
  const form = page.getByRole("form", { name: "Add action" });

  // Empty description, Completed without a result, a future time on a non-planned Action, follow-up without a note.
  await form.getByLabel("Status").selectOption("COMPLETED");
  await form.getByLabel("Action date/time").fill("2099-01-01T10:00");
  await form.getByLabel("Follow-up required?").check();
  await form.getByLabel("Attachment notes").fill("the printer error screenshot");
  await form.getByRole("button", { name: "Save action" }).click();

  const messages = {
    description: form.getByRole("alert").filter({ hasText: "Enter a description." }),
    result: form.getByRole("alert").filter({ hasText: "Enter the result to complete this action." }),
    when: form.getByRole("alert").filter({ hasText: "A future time is allowed only for a planned or cancelled action." }),
    note: form.getByRole("alert").filter({ hasText: "Enter a follow-up note." }),
  };
  for (const message of Object.values(messages)) await expect(message).toBeVisible();

  // Each message is directly below its own field, not collected at the top of the form.
  const below = async (field: string, message: (typeof messages)[keyof typeof messages]) => {
    const fieldBox = await form.locator(field).boundingBox();
    const messageBox = await message.boundingBox();
    expect(fieldBox && messageBox, `${field} and its message are laid out`).toBeTruthy();
    expect(messageBox!.y, `message sits below ${field}`).toBeGreaterThanOrEqual(fieldBox!.y + fieldBox!.height - 1);
  };
  await below("#action-form-description", messages.description);
  await below("#action-form-result", messages.result);
  await below("#action-form-action-at", messages.when);
  await below("#action-form-follow-up-note", messages.note);
  await expect(form.locator("#action-form-description")).toHaveAttribute("aria-invalid", "true");
  // Focus goes to the first invalid field in form order (the date/time).
  await expect(form.locator("#action-form-action-at")).toBeFocused();

  // Values are kept, and nothing was created.
  await expect(form.getByLabel("Status")).toHaveValue("COMPLETED");
  await expect(form.getByLabel("Action date/time")).toHaveValue("2099-01-01T10:00");
  await expect(form.getByLabel("Attachment notes")).toHaveValue("the printer error screenshot");
  expect(await countActionsOf(ticket.id)).toBe(0);

  // Fixing the fields lets the same form save.
  await form.getByLabel("Description").fill("Collected the printer error details.");
  await form.getByLabel("Result").fill("Error code recorded.");
  await form.getByLabel("Action date/time").fill(bangkokInputValue(-1));
  await form.getByLabel("Follow-up note", { exact: false }).fill("Ask the vendor about the code.");
  await form.getByRole("button", { name: "Save action" }).click();
  await expect(page.getByRole("heading", { name: "Actions Taken (1)" })).toBeVisible();
});

test("E2E-04 an assignee deactivated meanwhile shows the field error and keeps the values (AC-08)", async ({ page }) => {
  const assignee = await createFlowStaffUser("e2e04-assignee", "Flow Assignee Fixture");
  const ticket = await createLab4FixtureTicket("l4-e2e04b", "TKT-2026-997404", { actions: [] });
  await openStaffDetail(page, IT_STAFF_EMAIL, ticket.id);
  await page.getByRole("button", { name: "Add action" }).click();
  const form = page.getByRole("form", { name: "Add action" });
  await form.getByLabel("Description").fill("Hand the headset replacement over.");
  await form.getByLabel("Assignee").selectOption({ label: assignee.name });

  // The person is deactivated after the form loaded its assignee list.
  await setUserActive(assignee.id, false);
  await form.getByRole("button", { name: "Save action" }).click();

  await expect(form.getByText("That person can't be assigned. Choose an active IT Staff member.")).toBeVisible();
  await expect(form.getByLabel("Assignee")).toHaveAttribute("aria-invalid", "true");
  await expect(form.getByLabel("Description")).toHaveValue("Hand the headset replacement over.");
  expect(await countActionsOf(ticket.id)).toBe(0);

  // Choosing Unassigned fixes it.
  await form.getByLabel("Assignee").selectOption("");
  await form.getByRole("button", { name: "Save action" }).click();
  await expect(page.getByRole("heading", { name: "Actions Taken (1)" })).toBeVisible();
});

// ---------------------------------------------------------------------------
// E2E-05
// ---------------------------------------------------------------------------

test("E2E-05 stale edit between two users: the second Save shows the first user's version and keeps its typed edits (AC-17, AC-38)", async ({ browser }) => {
  const ticket = await createLab4FixtureTicket("l4-e2e05", "TKT-2026-997405", {
    actions: [{ description: "Original wording.", status: "PLANNED", hoursAgo: 4 }],
  });
  const first = await signedInPage(browser, IT_STAFF_EMAIL, ticket.id);
  const second = await signedInPage(browser, CARLOS_EMAIL, ticket.id);

  await rowOf(first, "Original wording.").getByRole("button", { name: /^Edit action/ }).click();
  await rowOf(second, "Original wording.").getByRole("button", { name: /^Edit action/ }).click();

  const firstForm = first.getByRole("form", { name: "Edit action" });
  await firstForm.getByLabel("Description").fill("Priya's wording.");
  await firstForm.getByRole("button", { name: "Save action" }).click();
  await expect(first.getByRole("status").filter({ hasText: "Action saved." })).toBeVisible();

  const form = second.getByRole("form", { name: "Edit action" });
  await form.getByLabel("Description").fill("Carlos's wording.");
  await form.getByRole("button", { name: "Save action" }).click();

  const callout = form.getByRole("alert").filter({ hasText: "This action was changed by" });
  await expect(callout).toContainText("Priya Natarajan");
  await expect(callout).toBeFocused();
  const latest = form.getByRole("complementary", { name: "Latest version" });
  await expect(latest).toContainText("Priya's wording.");
  // Nothing typed is lost.
  await expect(form.getByLabel("Description")).toHaveValue("Carlos's wording.");

  // "Use latest version (keep my edits)" adopts the new version and the same Save now goes through.
  await callout.getByRole("button", { name: "Use latest version (keep my edits)" }).click();
  await expect(callout).toHaveCount(0);
  await expect(form.getByLabel("Description")).toHaveValue("Carlos's wording.");
  await form.getByRole("button", { name: "Save action" }).click();
  await expect(second.getByRole("status").filter({ hasText: "Action saved." })).toBeVisible();
  await expect(rowOf(second, "Carlos's wording.")).toBeVisible();

  await first.reload();
  await expect(rowOf(first, "Carlos's wording.")).toBeVisible();
  await first.context().close();
  await second.context().close();
});

// ---------------------------------------------------------------------------
// E2E-06
// ---------------------------------------------------------------------------

const ACTIONS_URL = /\/api\/tickets\/\d+\/actions-taken$/;

test("E2E-06 a double click on Save sends one request and creates exactly one Action (AC-38)", async ({ page }) => {
  const ticket = await createLab4FixtureTicket("l4-e2e06", "TKT-2026-997406", { actions: [] });
  await openStaffDetail(page, IT_STAFF_EMAIL, ticket.id);

  let posts = 0;
  await page.route(ACTIONS_URL, async (route) => {
    if (route.request().method() !== "POST") return route.continue();
    posts += 1;
    // Keep the request in flight long enough for the second click to land on a pending form.
    await new Promise((resolve) => setTimeout(resolve, 700));
    await route.continue();
  });

  await page.getByRole("button", { name: "Add action" }).click();
  const form = page.getByRole("form", { name: "Add action" });
  await form.getByLabel("Description").fill("Submitted twice by an impatient click.");
  await form.getByRole("button", { name: "Save action" }).dblclick();

  await expect(page.getByRole("heading", { name: "Actions Taken (1)" })).toBeVisible();
  await page.waitForTimeout(500);
  expect(posts, "one POST for a double click").toBe(1);
  expect(await countActionsOf(ticket.id)).toBe(1);
});

test("E2E-06 a response dropped after the server saved is retried with the same key and creates exactly one Action (AC-16, AC-38)", async ({ page }) => {
  const ticket = await createLab4FixtureTicket("l4-e2e06b", "TKT-2026-997407", { actions: [] });
  await openStaffDetail(page, IT_STAFF_EMAIL, ticket.id);

  const keys: (string | undefined)[] = [];
  await page.route(ACTIONS_URL, async (route) => {
    if (route.request().method() !== "POST") return route.continue();
    keys.push((JSON.parse(route.request().postData() ?? "{}") as { clientRequestId?: string }).clientRequestId);
    if (keys.length === 1) {
      // The server really receives and saves the first attempt; the browser never sees the answer.
      await route.fetch();
      await route.abort("connectionreset");
      return;
    }
    await route.continue();
  });

  await page.getByRole("button", { name: "Add action" }).click();
  const form = page.getByRole("form", { name: "Add action" });
  await form.getByLabel("Description").fill("Saved on the server, answer lost on the way back.");
  await form.getByRole("button", { name: "Save action" }).click();

  const alert = form.getByRole("alert").filter({ hasText: "Something went wrong. Try again." });
  await expect(alert).toBeVisible();
  expect(await countActionsOf(ticket.id), "the first attempt reached the server").toBe(1);
  await expect(form.getByLabel("Description")).toHaveValue("Saved on the server, answer lost on the way back.");

  await alert.getByRole("button", { name: "Retry" }).click();
  await expect(page.getByRole("status").filter({ hasText: "Action saved." })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Actions Taken (1)" })).toBeVisible();
  expect(keys).toHaveLength(2);
  expect(keys[0]).toBeTruthy();
  expect(keys[1], "the retry reuses the idempotency key").toBe(keys[0]);
  expect(await countActionsOf(ticket.id), "still exactly one Action").toBe(1);
});

// ---------------------------------------------------------------------------
// Tablet layout (ui-spec §5.1: "Tablet drops nothing; long text clamps")
// ---------------------------------------------------------------------------

test.describe("Actions table at tablet width (V-11)", () => {
  test.use({ viewport: { width: 820, height: 1180 } });

  test("row buttons and the When column keep their words on one line instead of breaking mid-word", async ({ page }) => {
    const ticket = await createLab4FixtureTicket("l4-tablet", "TKT-2026-997408", {
      actions: [
        { description: "Roll out the replacement power supply to the other lab machines.", status: "PLANNED", hoursAgo: 6 },
        { description: "Reproduced the problem and photographed the error screen.", result: "Replaced the unit.", status: "COMPLETED", hoursAgo: 30 },
      ],
    });
    await openStaffDetail(page, IT_STAFF_EMAIL, ticket.id);
    const broken = await page.locator(".zen-actions__table .zen-btn__label, .zen-actions__table tbody tr > td:first-child").evaluateAll((els) =>
      els
        .filter((el) => {
          // Count the distinct text lines the label or date actually occupies.
          const range = document.createRange();
          range.selectNodeContents(el);
          const lines = new Set(Array.from(range.getClientRects()).map((r) => Math.round(r.top)));
          return lines.size > 1;
        })
        .map((el) => `${el.tagName.toLowerCase()} "${(el.textContent ?? "").trim()}"`),
    );
    expect(broken, "wrapped buttons or dates").toEqual([]);
    // View and Edit are fully inside the viewport.
    for (const button of await page.locator(".zen-actions__table .zen-btn").all()) {
      const box = await button.boundingBox();
      expect(box!.width, "button is wide enough for its label").toBeGreaterThanOrEqual(50);
    }
  });
});
