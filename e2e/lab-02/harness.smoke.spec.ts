import { test, expect } from "@playwright/test";
import {
  createPlainLoginFixtureUser,
  loginAs,
  LOCAL_DEV_PASSWORD,
  SAFE_LOGIN_FAILURE_MESSAGE,
} from "../support/auth.js";

// Harness smoke test (Issue #20; rewritten for Issue #74). This is the ONLY
// spec in this slice that just proves the harness boots the whole stack —
// E2E-01..12 and R-01..06 (docs/lab-03/tests.md §2.9) are the real behaviour
// coverage, written in e2e/lab-03/*.spec.ts.
//
// This file originally drove `/select-requester`, the Lab 2 Development
// Requester Selector — Lab 3 (#70) deleted that screen and route entirely
// (client/src/App.tsx: "`/select-requester` is gone with the selector it
// served"), so the original assertions no longer have anything to drive.
// Rewritten here to prove the same thing (the client can reach the server,
// the server can reach the database, and the database was seeded — no
// mocked/hardcoded data) through the real Login screen instead.

test("boots the full stack: a real account can log in and its real name/role render", async ({
  page,
}) => {
  // Every seeded Requester also carries mustChangePassword: true (auth.ts's
  // own comment explains why), which routes to the forced Change Password
  // screen — a deliberately shell-less layout with no UserBadge
  // (ChangePasswordScreen.tsx's `forced` branch). A plain fixture user
  // (mustChangePassword: false) reaches the real AppShell/UserBadge instead,
  // and — being a row this test itself just inserted into `toktickit_e2e` —
  // its name can only appear here if the client actually reached the
  // server, which actually read it back from the real database.
  const fixture = await createPlainLoginFixtureUser("harness-smoke");
  await loginAs(page, fixture.email, LOCAL_DEV_PASSWORD);

  const userBadge = page.locator(".zen-user-badge");
  await expect(userBadge.locator(".zen-user-badge__name")).toHaveText(fixture.name);
  await expect(userBadge.getByText("Requester", { exact: true })).toBeVisible();
});

test("boots the full stack: a real seeded INACTIVE account is refused login", async ({ page }) => {
  // Robert Wilson is seeded INACTIVE (server/prisma/seed.ts) and must never
  // be able to log in (api-spec.md §2.1, specification.md AC-05) — refused
  // with the exact same safe-failure message a wrong password gets, even
  // with the CORRECT password (so this isolates the `isActive` gate itself,
  // not just a wrong credential). This can only fail loudly (not silently
  // pass) if the server is actually checking `isActive` against the real
  // seeded row.
  await page.goto("/login");
  await page.locator("#login-email").fill("robert.wilson@example.edu");
  await page.locator("#login-password").fill(LOCAL_DEV_PASSWORD);
  await page.getByRole("button", { name: /^Sign in$/ }).click();

  await expect(page.getByText(SAFE_LOGIN_FAILURE_MESSAGE)).toBeVisible();
  await expect(page).toHaveURL(/\/login$/);
});
