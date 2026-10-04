import { expect, test } from "@playwright/test";
import {
  LOCAL_DEV_PASSWORD,
  SAFE_LOGIN_FAILURE_MESSAGE,
  createPlainLoginFixtureUser,
  loginAs,
  loginAsSeededUser,
} from "../support/auth.js";
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
// This file covers E2E-09 (AC-48, AC-49, AC-51, below) plus three later
// dispatches added alongside it: E2E-10 (AC-52, initial-password round
// trip), E2E-11 (AC-53 + AC-54, the two admin safety rails) and E2E-12
// (AC-55, forbidden admin access for a Requester). AC-45/46/47/50 are
// already covered elsewhere (API/component tests per tests.md) and are
// deliberately NOT exercised here.

const ADMIN_EMAIL = "olivia.grant@example.edu"; // server/prisma/seed.ts SEED_ADMINISTRATORS
// The seed's SECOND active Administrator (server/prisma/seed.ts
// SEED_ADMINISTRATORS keeps exactly 2 active Administrators, deliberately,
// per that file's own comment, so AC-53 and AC-54 can each be exercised
// independently) — E2E-11 below temporarily deactivates this account to
// reach "exactly one active Administrator" and restores it afterwards.
const SECOND_ADMIN_EMAIL = "noah.kim@example.edu";
const SECOND_ADMIN_NAME = "Noah Kim";

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

// ---------------------------------------------------------------------------
// E2E-10 (AC-52) — initial password round trip
// ---------------------------------------------------------------------------
//
// tests.md: "Admin sets a new initial password; that user logs in and is
// forced to change it." specification.md AC-52: "Given a user, when an
// Administrator sets a new initial password, then that user's next login
// requires a password change before the application opens." Driven through
// the real Edit dialog's separate "Set new initial password" section
// (ui-spec.md §11, client/src/components/UserDialog.tsx) — a structurally
// distinct field/button from Create's "Initial password" field, so a
// password reset can never happen by accident while editing a name. Proven
// the same way E2E-09 proves AC-48: a real, independent login round trip,
// not a DB read of `mustChangePassword`.

const PWRESET_USER_NAME = "Morgan Ellis";
const PWRESET_USER_EMAIL = "e2e-admin-password-reset-user@toktickit.local";
const PWRESET_INITIAL_PASSWORD = "E2E-Admin-Initial-Password-1!";
const PWRESET_NEW_PASSWORD = "E2E-Admin-New-Initial-Password-2!";

test.describe("E2E-10 initial password round trip (AC-52)", () => {
  test("an Administrator sets a new initial password on an existing user, and that user's next login is forced to change it", async ({
    page,
    browser,
  }) => {
    await resetUserAdministrationFixtures([PWRESET_USER_EMAIL]);

    await loginAsSeededUser(page, ADMIN_EMAIL);
    await page.goto("/admin/users");
    await expect(page.getByRole("heading", { name: "User Management" })).toBeVisible();

    const rows = page.locator(USER_TABLE_ROWS);

    // Create the fixture user through the real Create dialog first (same
    // convention as E2E-09) — this test's subject is the SEPARATE "set new
    // initial password" action, not creation itself, so the account's
    // starting password is irrelevant beyond needing one to create the row.
    await page.getByRole("button", { name: "New user" }).click();
    const createDialog = page.getByRole("dialog");
    await expect(createDialog.getByRole("heading", { name: "New user" })).toBeVisible();
    await createDialog.locator("#user-dialog-name").fill(PWRESET_USER_NAME);
    await createDialog.locator("#user-dialog-email").fill(PWRESET_USER_EMAIL);
    await createDialog.locator("#user-dialog-role").selectOption("REQUESTER");
    await createDialog.locator("#user-dialog-password").fill(PWRESET_INITIAL_PASSWORD);
    await createDialog.getByRole("button", { name: "Save" }).click();
    await expect(page.getByRole("dialog")).toHaveCount(0);

    const fixtureRow = rows.filter({ hasText: PWRESET_USER_EMAIL });
    await expect(fixtureRow).toHaveCount(1);

    // -------------------------------------------------------------------
    // AC-52: an Administrator sets a NEW initial password via the Edit
    // dialog's distinct "Set new initial password" section — a separate
    // request from the main Name/Email/Role/Active Save above.
    // -------------------------------------------------------------------
    await fixtureRow.getByRole("button", { name: `Edit ${PWRESET_USER_NAME}` }).click();
    const editDialog = page.getByRole("dialog");
    await expect(editDialog.getByRole("heading", { name: "Edit user" })).toBeVisible();
    await expect(editDialog.getByRole("heading", { name: "Set new initial password" })).toBeVisible();

    await editDialog.locator("#user-dialog-reset-password").fill(PWRESET_NEW_PASSWORD);
    await editDialog.getByRole("button", { name: "Set password" }).click();

    // ui-spec.md §11 / UserDialog.tsx: a `role="status"` confirmation next
    // to the password-reset section, separate from the main form's
    // `role="alert"` banner.
    await expect(
      editDialog.getByRole("status").filter({ hasText: "Password updated." }),
    ).toBeVisible();

    // Closing via Cancel, not Save: the password reset above already
    // persisted through its own request — the main Name/Email/Role/Active
    // form was never touched, so there is nothing left to save or discard.
    await editDialog.getByRole("button", { name: "Cancel" }).click();
    await expect(page.getByRole("dialog")).toHaveCount(0);

    // "...that user's next login requires a password change before the
    // application opens" — proven with a real, independent login using the
    // NEW password, exactly like E2E-09 proves the equivalent create-time
    // flag. A separate browser context keeps this a genuine independent
    // session.
    const resetUserContext = await browser.newContext();
    try {
      const resetUserPage = await resetUserContext.newPage();
      await loginAs(resetUserPage, PWRESET_USER_EMAIL, PWRESET_NEW_PASSWORD);
      await expect(resetUserPage).toHaveURL(/\/change-password$/);
      await expect(
        resetUserPage
          .getByRole("status")
          .filter({ hasText: "Choose a new password before continuing." }),
      ).toBeVisible();

      // The OLD initial password this account was created with no longer
      // works — proof the "set new initial password" action actually
      // replaced the stored password rather than merely re-flagging
      // `mustChangePassword` on the original one.
      await resetUserPage.goto("/login");
      await resetUserPage.locator("#login-email").fill(PWRESET_USER_EMAIL);
      await resetUserPage.locator("#login-password").fill(PWRESET_INITIAL_PASSWORD);
      await resetUserPage.getByRole("button", { name: "Sign in" }).click();
      await expect(resetUserPage.getByRole("alert")).toContainText(SAFE_LOGIN_FAILURE_MESSAGE);
      await expect(resetUserPage).toHaveURL(/\/login$/);
    } finally {
      await resetUserContext.close();
    }
  });
});

// ---------------------------------------------------------------------------
// E2E-11 (AC-53, AC-54) — admin safety rails
// ---------------------------------------------------------------------------
//
// tests.md: "Self-deactivation and last-active-Administrator are both
// refused in the UI." Both guard-rails are exercised in ONE test — same
// judgment call E2E-09 made combining three ACs — since AC-54's setup
// (getting to "exactly one active Administrator") and its teardown
// (restoring the second seeded Administrator) bracket the whole test, and
// splitting AC-53 into its own test would either duplicate that
// setup/teardown or leave AC-53 running against a DB state this test has
// deliberately perturbed.
//
// AC-53 (self-deactivation): ui-spec.md §11 — editing your OWN account
// disables the Active checkbox client-side, with explanatory helper text,
// so self-deactivation can't even be attempted through the UI (the 409
// SELF_DEACTIVATION banner path in UserDialog.tsx is defense in depth for
// reaching the same rule some other way). Same assertion shape as
// `client/tests/lab-03/UserManagement.test.tsx`'s own coverage ("pre-fills
// the form for the logged-in admin's own row, disabling Active with the
// exact helper text"), driven here against the real dialog and the real
// seeded Administrator instead of a mock.
//
// AC-54 (last active Administrator): server/prisma/seed.ts seeds exactly 2
// active Administrators FOR THIS REASON (see that file's own comment) — so
// AC-53 and AC-54 can each be exercised independently. This test
// deliberately deactivates the second one (`SECOND_ADMIN_EMAIL`) to reach a
// known "exactly one active Administrator" state, then attempts to DEMOTE
// (not deactivate — the Active checkbox is disabled for self, per AC-53
// above) that last remaining active Administrator's own role away from
// ADMINISTRATOR. server/src/routes/users.ts's own comment confirms this is
// the only reachable path to the LAST_ADMIN check in practice: "the only
// way to reach a count of zero here is a sole active Administrator
// changing their OWN role away from ADMINISTRATOR" — the exact scenario
// `UserManagement.test.tsx`'s own C-17-adjacent LAST_ADMIN coverage drives
// too. The on-screen message asserted below is the CLIENT-side
// `LAST_ADMIN_MESSAGE` constant (client/src/users/api.ts) that
// `LastAdminError`'s default message renders — not the raw server JSON
// `message` string, which client/src/users/api.ts's `updateUser` never
// surfaces to the UI.
//
// Isolation: `SECOND_ADMIN_EMAIL` is deactivated mid-test and MUST be
// reactivated before this test ends, in a `finally`, or every later spec
// (including a CI retry of this very file) inherits a DB with only one
// active Administrator. Setup also normalizes both seeded Administrators to
// Active FIRST (rather than assuming that starting state) and asserts
// exactly 2 active Administrators exist before proceeding — this test does
// not assume a clean starting state, it establishes and verifies one.

test.describe("E2E-11 admin safety rails (AC-53, AC-54)", () => {
  test("self-deactivation is blocked client-side, and demoting the last active Administrator is rejected with the LAST_ADMIN message", async ({
    page,
  }) => {
    await loginAsSeededUser(page, ADMIN_EMAIL);
    await page.goto("/admin/users");
    await expect(page.getByRole("heading", { name: "User Management" })).toBeVisible();

    const rows = page.locator(USER_TABLE_ROWS);

    /**
     * Opens Edit on the row for `email`, sets Active to exactly `active`
     * (via Save if it needs to change, via Cancel — a no-op — if it's
     * already correct), and waits for the dialog to close. Used both to
     * normalize starting state and to restore it afterwards.
     */
    async function setAdminActive(email: string, name: string, active: boolean): Promise<void> {
      const row = rows.filter({ hasText: email });
      await expect(row).toHaveCount(1);
      await row.getByRole("button", { name: `Edit ${name}` }).click();
      const dialog = page.getByRole("dialog");
      await expect(dialog.getByRole("heading", { name: "Edit user" })).toBeVisible();

      const activeCheckbox = dialog.locator("#user-dialog-active");
      const alreadyCorrect = (await activeCheckbox.isChecked()) === active;
      if (alreadyCorrect) {
        await dialog.getByRole("button", { name: "Cancel" }).click();
      } else {
        if (active) {
          await activeCheckbox.check();
        } else {
          await activeCheckbox.uncheck();
        }
        await dialog.getByRole("button", { name: "Save" }).click();
      }
      await expect(page.getByRole("dialog")).toHaveCount(0);
    }

    // --- setup: both seeded Administrators Active, verified, not assumed --
    await setAdminActive(ADMIN_EMAIL, "Olivia Grant", true);
    await setAdminActive(SECOND_ADMIN_EMAIL, SECOND_ADMIN_NAME, true);

    await page.locator("#user-mgmt-role").selectOption("ADMINISTRATOR");
    const activeAdminRows = rows.filter({ has: page.locator(".zen-user-mgmt__badge--active") });
    await expect(activeAdminRows).toHaveCount(2);
    // Back to the unfiltered list for the rest of the test.
    await page.locator("#user-mgmt-role").selectOption("");

    try {
      // -----------------------------------------------------------------
      // AC-53: the Administrator's own row has Active disabled, with the
      // exact ui-spec.md §11 helper text — self-deactivation cannot even
      // be attempted.
      // -----------------------------------------------------------------
      const ownRow = rows.filter({ hasText: ADMIN_EMAIL });
      await ownRow.getByRole("button", { name: "Edit Olivia Grant" }).click();
      const selfDialog = page.getByRole("dialog");
      await expect(selfDialog.getByRole("heading", { name: "Edit user" })).toBeVisible();

      const selfActiveCheckbox = selfDialog.locator("#user-dialog-active");
      await expect(selfActiveCheckbox).toBeChecked();
      await expect(selfActiveCheckbox).toBeDisabled();
      await expect(
        selfDialog.getByText("You can't deactivate your own account."),
      ).toBeVisible();

      await selfDialog.getByRole("button", { name: "Cancel" }).click();
      await expect(page.getByRole("dialog")).toHaveCount(0);

      // -----------------------------------------------------------------
      // AC-54: with exactly one active Administrator remaining, changing
      // that Administrator's role away from ADMINISTRATOR is rejected.
      // -----------------------------------------------------------------
      await setAdminActive(SECOND_ADMIN_EMAIL, SECOND_ADMIN_NAME, false);

      await page.locator("#user-mgmt-role").selectOption("ADMINISTRATOR");
      await expect(activeAdminRows).toHaveCount(1);
      await page.locator("#user-mgmt-role").selectOption("");

      await ownRow.getByRole("button", { name: "Edit Olivia Grant" }).click();
      const lastAdminDialog = page.getByRole("dialog");
      await expect(lastAdminDialog.getByRole("heading", { name: "Edit user" })).toBeVisible();
      // Active stays disabled (still editing self) — the only way to
      // attempt a change that would zero the active-Administrator count is
      // the Role select, which is NOT disabled for self.
      await expect(lastAdminDialog.locator("#user-dialog-active")).toBeDisabled();

      await lastAdminDialog.locator("#user-dialog-role").selectOption("IT_STAFF");
      await lastAdminDialog.getByRole("button", { name: "Save" }).click();

      await expect(lastAdminDialog.getByRole("alert")).toContainText(
        "This is the last active administrator. Promote another administrator first.",
      );
      // Rejected: dialog stays open, row unchanged.
      await expect(page.getByRole("dialog")).toHaveCount(1);
      await lastAdminDialog.getByRole("button", { name: "Cancel" }).click();
      await expect(page.getByRole("dialog")).toHaveCount(0);

      const stillOwnRow = rows.filter({ hasText: ADMIN_EMAIL });
      await expect(stillOwnRow).toContainText("Administrator");
      await expect(stillOwnRow).toContainText("Active");
    } finally {
      // Restore the seed's known-good state regardless of pass/fail above,
      // so no later spec (or CI retry of this file) inherits a DB with
      // only one active Administrator.
      await setAdminActive(SECOND_ADMIN_EMAIL, SECOND_ADMIN_NAME, true);
    }
  });
});

// ---------------------------------------------------------------------------
// E2E-12 (AC-55) — forbidden admin access
// ---------------------------------------------------------------------------
//
// tests.md: "A Requester navigating to /admin/users sees the forbidden
// state." specification.md AC-55: "Given a Requester and an IT Staff user,
// when each calls any Administrator endpoint, then both are refused." The
// IT-Staff half of AC-55 is already covered at the API level
// (authorization.api.test.ts per tests.md) — this E2E row's own scope, per
// tests.md's summary, is the single UI-level check: does a Requester
// actually see the real forbidden state (ui-spec.md §4.3,
// client/src/routes/RequireRole.tsx), not a blank page or a crash. Same
// assertion shape as `client/tests/lab-03/RequireRole.test.tsx`'s own C-09
// coverage, driven here against the real route/shell instead of a mock
// `RequireRole` harness.
//
// Uses a dedicated `createPlainLoginFixtureUser` Requester
// (`mustChangePassword: false`), not a seeded one, for the exact reason
// `support/auth.ts`'s own header comment documents (and this dispatch
// confirmed by hitting it directly): every seeded active Requester is
// migrated-forward Lab 2 data, flagged `mustChangePassword: true` by
// design, so logging in with one lands on the FORCED Change Password
// screen instead of anywhere `/admin/users` could be reached from — a
// forced-change redirect is proof of nothing about AC-55.
test.describe("E2E-12 forbidden admin access (AC-55)", () => {
  test("a Requester navigating directly to /admin/users sees the forbidden state, not the User Management screen", async ({
    page,
  }) => {
    const requester = await createPlainLoginFixtureUser("forbidden-admin-access");
    await loginAs(page, requester.email, LOCAL_DEV_PASSWORD);
    await expect(page).toHaveURL(/\/tickets$/);

    // Deliberate direct navigation to the Administrator-only route, same
    // `page.goto` convention as E2E-09's own header comment documents (a
    // successful login always redirects to the Requester-only `/tickets`
    // regardless of the caller's real role, so this can't be reached via a
    // normal post-login redirect for ANY role — including the Requester
    // used here, which makes this navigation exactly what a Requester
    // typing or bookmarking the URL would produce).
    await page.goto("/admin/users");

    await expect(
      page.getByRole("heading", { name: "You don't have access to this page" }),
    ).toBeVisible();
    await expect(
      page.getByText("Your account's role doesn't include this destination."),
    ).toBeVisible();

    // The real screen never mounts: no User Management heading, no table,
    // no admin-only content leaked into the DOM.
    await expect(page.getByRole("heading", { name: "User Management" })).toHaveCount(0);
    await expect(page.locator(USER_TABLE_ROWS)).toHaveCount(0);

    // The forbidden state's own action links back to the caller's OWN
    // landing page (ui-spec.md §4.3) — proof this is the real, functioning
    // guard, not a static error page.
    const backLink = page.getByRole("link", { name: "Go to My Tickets" });
    await expect(backLink).toBeVisible();
    await expect(backLink).toHaveAttribute("href", "/tickets");
  });
});
