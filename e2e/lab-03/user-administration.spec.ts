import { expect, test } from "@playwright/test";
import { loginAs, loginAsSeededUser } from "../support/auth.js";
import { resetUserAdministrationFixtures } from "../support/adminFixtures.js";

// Lab 3 Administrator User Management E2E journey (docs/lab-03/tests.md
// §2.9, E2E-09). Drives the REAL `/admin/users` screen (ui-spec.md §11,
// Create/Edit `UserDialog` — client/src/components/UserDialog.tsx) exactly
// as an Administrator would, against the real client + real server + the
// shared `toktickit_e2e` Postgres database — no mocking, and no direct API
// calls to create or edit the user under test (only pre-test cleanup, via
// `adminFixtures.ts`, uses direct `pg` access, same as every other Lab 3
// fixture helper).
//
// Like staff-ticket-flow.spec.ts, this signs in as a seeded Administrator
// via `loginAsSeededUser` and then navigates DIRECTLY to `/admin/users`
// with `page.goto`, sidestepping the same real gap `e2e/support/auth.ts`'s
// own comment documents: a successful, non-forced login always redirects
// to the hardcoded `"/"` route, which resolves to the Requester-only
// `/tickets` route regardless of the caller's real role, landing a
// non-Requester on the forbidden state instead of their own role's landing
// page. Out of scope for this Create/Edit/duplicate-email surface —
// reported there, not re-fixed here.
//
// Per this dispatch's brief, this covers exactly AC-48, AC-49 and AC-51 —
// AC-45/46/47/50/52/53/54 are already covered elsewhere (API/component
// tests per tests.md) and are deliberately NOT exercised here; E2E-10
// (AC-52) and E2E-11 (AC-53, AC-54), which also live in this same planned
// spec file per tests.md, are separate, not-yet-written dispatches.

const ADMIN_EMAIL = "olivia.grant@example.edu"; // server/prisma/seed.ts SEED_ADMINISTRATORS

const NEW_USER_NAME = "Jordan Ellis";
const NEW_USER_EMAIL = "e2e-admin-created-user@toktickit.local";
const NEW_USER_INITIAL_PASSWORD = "E2E-Admin-Created-Initial-1!";

const DUPLICATE_ATTEMPT_NAME = "Alex Rivera";

const EDITED_NAME = "Jordan Ellis-Park";
const EDITED_EMAIL = "e2e-admin-edited-user@toktickit.local";

const USER_TABLE_ROWS = "table.zen-user-mgmt__table tbody tr";

test.describe("E2E-09 user admin (AC-48, AC-49, AC-51)", () => {
  test("an Administrator creates a user, hits the duplicate-email rejection, and edits all four fields", async ({
    page,
    browser,
  }) => {
    // Idempotent: clears any leftover row from a previous, uncleaned run
    // (e.g. a CI retry re-running this test against the same
    // `toktickit_e2e` database `pretest:e2e` only resets once per whole
    // `npm run test:e2e` invocation) before driving the real Create dialog
    // below — see adminFixtures.ts's own comment.
    await resetUserAdministrationFixtures([NEW_USER_EMAIL, EDITED_EMAIL]);

    await loginAsSeededUser(page, ADMIN_EMAIL);
    await page.goto("/admin/users");
    await expect(page.getByRole("heading", { name: "User Management" })).toBeVisible();

    const rows = page.locator(USER_TABLE_ROWS);

    // -------------------------------------------------------------------
    // AC-48: given valid input, an Administrator creates a user with one
    // role and an initial password — the account exists, is flagged to
    // change its password, and can log in.
    // -------------------------------------------------------------------
    await page.getByRole("button", { name: "New user" }).click();
    const createDialog = page.getByRole("dialog");
    await expect(createDialog.getByRole("heading", { name: "New user" })).toBeVisible();

    await createDialog.locator("#user-dialog-name").fill(NEW_USER_NAME);
    await createDialog.locator("#user-dialog-email").fill(NEW_USER_EMAIL);
    // "with one role" — a single role select, not a multi-select.
    await createDialog.locator("#user-dialog-role").selectOption("IT_STAFF");
    // ui-spec.md §11: Active defaults on — left checked deliberately, to
    // prove the created account is active without a redundant re-check.
    await expect(createDialog.locator("#user-dialog-active")).toBeChecked();
    await createDialog.locator("#user-dialog-password").fill(NEW_USER_INITIAL_PASSWORD);
    await createDialog.getByRole("button", { name: "Save" }).click();

    // Dialog closes back to the list on a successful create.
    await expect(page.getByRole("dialog")).toHaveCount(0);

    const newUserRow = rows.filter({ hasText: NEW_USER_EMAIL });
    await expect(newUserRow).toHaveCount(1);
    await expect(newUserRow).toContainText(NEW_USER_NAME);
    await expect(newUserRow).toContainText("IT Staff");
    await expect(newUserRow).toContainText("Active");

    // "...is flagged to change its password, and can log in" — proven with
    // a real, independent login using the exact credentials just submitted
    // through the dialog (not a DB read of the `mustChangePassword`
    // column). A wrong/rejected login would stay on /login with the safe
    // failure message (authentication.spec.ts E2E-01/E2E-03); landing on
    // /change-password instead proves both that this login succeeded AND
    // that the new account is flagged to change its password — the same
    // forced-path proof authentication.spec.ts's E2E-02 uses for the
    // identical redirect. A separate browser context keeps this a genuine
    // independent session rather than reusing the Administrator's own
    // cookie jar.
    const newUserContext = await browser.newContext();
    try {
      const newUserPage = await newUserContext.newPage();
      await loginAs(newUserPage, NEW_USER_EMAIL, NEW_USER_INITIAL_PASSWORD);
      await expect(newUserPage).toHaveURL(/\/change-password$/);
      await expect(
        newUserPage
          .getByRole("status")
          .filter({ hasText: "Choose a new password before continuing." }),
      ).toBeVisible();
    } finally {
      await newUserContext.close();
    }

    // -------------------------------------------------------------------
    // AC-49: given an email already in use, creating a user with it is
    // rejected with a clear message shown on the dialog.
    // -------------------------------------------------------------------
    await page.getByRole("button", { name: "New user" }).click();
    const duplicateDialog = page.getByRole("dialog");
    await expect(duplicateDialog.getByRole("heading", { name: "New user" })).toBeVisible();

    await duplicateDialog.locator("#user-dialog-name").fill(DUPLICATE_ATTEMPT_NAME);
    // The SAME email the account above was just created with.
    await duplicateDialog.locator("#user-dialog-email").fill(NEW_USER_EMAIL);
    await duplicateDialog.locator("#user-dialog-role").selectOption("REQUESTER");
    await duplicateDialog
      .locator("#user-dialog-password")
      .fill("E2E-Duplicate-Attempt-Password-1!");
    await duplicateDialog.getByRole("button", { name: "Save" }).click();

    // ui-spec.md §11 guard-rail table: field-level on Email, not a banner.
    await expect(duplicateDialog.locator("#user-dialog-email-error")).toContainText(
      "That email address is already in use.",
    );
    // Rejected: the dialog stays open, and no second row for this email
    // was created.
    await expect(page.getByRole("dialog")).toHaveCount(1);
    await expect(rows.filter({ hasText: NEW_USER_EMAIL })).toHaveCount(1);

    await duplicateDialog.getByRole("button", { name: "Cancel" }).click();
    await expect(page.getByRole("dialog")).toHaveCount(0);

    // -------------------------------------------------------------------
    // AC-51: given an existing user, an Administrator updates name, email,
    // role and activation state — all four change.
    // -------------------------------------------------------------------
    await newUserRow.getByRole("button", { name: `Edit ${NEW_USER_NAME}` }).click();
    const editDialog = page.getByRole("dialog");
    await expect(editDialog.getByRole("heading", { name: "Edit user" })).toBeVisible();

    // Pre-filled with the account's current values — proof this is
    // editing the real row, not a blank form.
    await expect(editDialog.locator("#user-dialog-name")).toHaveValue(NEW_USER_NAME);
    await expect(editDialog.locator("#user-dialog-email")).toHaveValue(NEW_USER_EMAIL);
    await expect(editDialog.locator("#user-dialog-role")).toHaveValue("IT_STAFF");
    await expect(editDialog.locator("#user-dialog-active")).toBeChecked();

    await editDialog.locator("#user-dialog-name").fill(EDITED_NAME);
    await editDialog.locator("#user-dialog-email").fill(EDITED_EMAIL);
    await editDialog.locator("#user-dialog-role").selectOption("ADMINISTRATOR");
    await editDialog.locator("#user-dialog-active").uncheck();
    await editDialog.getByRole("button", { name: "Save" }).click();

    await expect(page.getByRole("dialog")).toHaveCount(0);

    const editedRow = rows.filter({ hasText: EDITED_EMAIL });
    await expect(editedRow).toHaveCount(1);
    await expect(editedRow).toContainText(EDITED_NAME);
    await expect(editedRow).toContainText("Administrator");
    await expect(editedRow).toContainText("Inactive");
    // The stale email no longer appears anywhere in the list — proof this
    // is the SAME row updated in place, not a second row created alongside
    // an untouched original.
    await expect(rows.filter({ hasText: NEW_USER_EMAIL })).toHaveCount(0);

    // Persistence: a fresh load of the screen reflects all four real,
    // saved changes — same reload-and-recheck convention as
    // staff-ticket-flow.spec.ts's E2E-06.
    await page.reload();
    await expect(page.getByRole("heading", { name: "User Management" })).toBeVisible();
    const reloadedRow = page.locator(USER_TABLE_ROWS).filter({ hasText: EDITED_EMAIL });
    await expect(reloadedRow).toHaveCount(1);
    await expect(reloadedRow).toContainText(EDITED_NAME);
    await expect(reloadedRow).toContainText("Administrator");
    await expect(reloadedRow).toContainText("Inactive");
  });
});
