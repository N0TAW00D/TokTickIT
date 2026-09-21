import { expect, test } from "@playwright/test";
import {
  LOCAL_DEV_PASSWORD,
  SAFE_LOGIN_FAILURE_MESSAGE,
  createMustChangePasswordFixtureUser,
  createPlainLoginFixtureUser,
  loginAs,
} from "../support/auth.js";

// Lab 3 authentication E2E journeys (docs/lab-03/tests.md §2.9, E2E-01..04).
//
// Lab 3 replaced Lab 2's dev-only "Development Requester Selector"
// (`GET /api/requesters`, `X-Requester-Id`) with real session-cookie
// authentication (`POST /api/auth/login`, api-spec.md §2; ui-spec.md §5
// Login, §6 Change Password). Every test below drives the REAL Login /
// Change Password screens exactly as a user would — no header injection,
// no direct API calls to establish a session — against the real client +
// real server + the shared `toktickit_e2e` Postgres database, exactly like
// e2e/lab-02/*.spec.ts drives the real stack for Lab 2. `e2e/support/auth.ts`
// holds the shared `loginAs`/`loginAsSeededUser` helpers so later Lab 3
// spec files (staff-ticket-flow, user-administration, ...) reuse the same
// real login path instead of each reinventing it.
//
// E2E-01 and E2E-04 need a login journey that does NOT hit the forced
// Change Password redirect. No *seeded* account reliably gives them that:
// every seeded active Requester is one of the rows migrated forward from
// Lab 2 and is, by design, flagged `mustChangePassword: true`; a seeded IT
// Staff/Administrator account IS flagged false, but currently lands on the
// forbidden state after login (`LoginScreen`/`App.tsx` route a successful
// non-forced login to the hardcoded `"/"`, which resolves to the
// REQUESTER-only `/tickets`, regardless of the caller's real role) — see
// `support/auth.ts`'s own comment for the full explanation of both quirks,
// which this dispatch reports rather than fixes (out of scope for the
// Login/Change-Password/Logout surface these four tests own). So both
// tests use a dedicated fixture Requester with `mustChangePassword: false`
// (`createPlainLoginFixtureUser`, support/auth.ts) instead — a real row in
// the real database, just not one `seed.ts` itself produces. E2E-02 below
// is the one journey that deliberately WANTS the forced-change path, and
// uses its own dedicated fixture for that.

// Seeded INACTIVE Requester (server/prisma/seed.ts SEED_INACTIVE_REQUESTERS)
// — never offered by any UI list, but still a real row with the same
// shared password, so this is a real inactive-account login attempt, not a
// stand-in for one.
const INACTIVE_REQUESTER_EMAIL = "robert.wilson@example.edu";

// ---------------------------------------------------------------------------
// E2E-01 (AC-01, AC-05) — login journey
// ---------------------------------------------------------------------------
//
// tests.md E2E-01: "Invalid login shows the safe failure; valid login
// enters the app showing name and role." specification.md AC-01: an active
// user with valid credentials gets authenticated access and their permitted
// identity + role back. AC-05: a wrong password, an unknown email and an
// inactive account all produce the same status code and message body
// (api-spec.md §2.1 BR-08) — this test proves the wrong-password half at
// the UI; E2E-03 below proves the inactive-account half produces the
// byte-identical on-screen message.

test.describe("E2E-01 login journey (AC-01, AC-05)", () => {
  test("an invalid attempt shows the safe failure message, and a valid attempt enters the app showing the authenticated user's name and role", async ({
    page,
  }) => {
    const fixtureUser = await createPlainLoginFixtureUser("login-journey");

    await page.goto("/login");
    await expect(page.locator("#login-email")).toBeVisible();

    // --- invalid attempt: right email, wrong password --------------------
    await page.locator("#login-email").fill(fixtureUser.email);
    await page.locator("#login-password").fill("Definitely-The-Wrong-Password-1!");
    await page.getByRole("button", { name: "Sign in" }).click();

    // ui-spec.md §5 "Failure": one role="alert" callout with the exact safe
    // wording — never "no such user", never anything password-specific.
    // `toContainText` (not `toHaveText`): `ErrorState` also renders an
    // `aria-hidden` ⚠ glyph inside the same alert, which is invisible to
    // assistive tech but still part of the element's raw text content.
    await expect(page.getByRole("alert")).toContainText(SAFE_LOGIN_FAILURE_MESSAGE);
    // No session was established: still on Login.
    await expect(page).toHaveURL(/\/login$/);

    // --- valid attempt: same email, the real password ---------------------
    await page.locator("#login-password").fill(LOCAL_DEV_PASSWORD);
    await page.getByRole("button", { name: "Sign in" }).click();

    // AC-01 / ROLE_LANDING (client/src/routes/RequireRole.tsx): a Requester
    // lands on My Tickets.
    await expect(page).toHaveURL(/\/tickets$/);
    await expect(page.getByRole("heading", { name: "My Tickets" })).toBeVisible();

    // ui-spec.md §4.1 UserBadge: shows the authenticated user's real name
    // (not just an avatar) and a RoleBadge — proof the login response's
    // identity + role actually reached the shell, not merely "some screen
    // rendered".
    const userBadge = page.locator(".zen-user-badge__trigger");
    await expect(userBadge).toContainText(fixtureUser.name);
    await expect(userBadge).toContainText("Requester");
  });
});

// ---------------------------------------------------------------------------
// E2E-02 (AC-02, AC-09) — first-login forced password change
// ---------------------------------------------------------------------------
//
// tests.md E2E-02: "Normal app opens only after a valid change is
// submitted." specification.md AC-02: given a user who must change the
// initial password, normal application screens remain unavailable until a
// valid new password is saved. AC-09: given a successful password change,
// the flag is cleared and the application opens.

test.describe("E2E-02 first-login forced password change (AC-02, AC-09)", () => {
  test("the normal app stays unreachable until a valid password change is submitted, then opens", async ({
    page,
  }) => {
    const fixtureUser = await createMustChangePasswordFixtureUser();

    // Logging in with a flagged account redirects straight to
    // /change-password (LoginScreen.tsx), not the role landing page.
    await loginAs(page, fixtureUser.email, LOCAL_DEV_PASSWORD);
    await expect(page).toHaveURL(/\/change-password$/);

    // ui-spec.md §6 "Forced" path: explanatory banner, no Current password
    // field, and (per the same section) no Cancel — every other route
    // redirects back here until this succeeds, proven below.
    await expect(
      page.getByRole("status").filter({ hasText: "Choose a new password before continuing." }),
    ).toBeVisible();
    await expect(page.locator("#change-password-current")).toHaveCount(0);

    // AC-02: the normal app is unreachable before a valid change — directly
    // (re-)navigating to a protected route bounces straight back here
    // (RequireAuth.tsx: `mustChangePassword` true -> redirect), never
    // rendering My Tickets even for a moment.
    await page.goto("/tickets");
    await expect(page).toHaveURL(/\/change-password$/);
    await expect(page.getByRole("heading", { name: "My Tickets" })).toHaveCount(0);

    // --- submit a valid change ---------------------------------------------
    const NEW_PASSWORD = "E2E-Fixture-New-Password-1!";
    await page.locator("#change-password-new").fill(NEW_PASSWORD);
    await page.locator("#change-password-confirm").fill(NEW_PASSWORD);
    await page.getByRole("button", { name: "Save password" }).click();

    await expect(
      page.getByRole("status").filter({ hasText: "Password changed." }),
    ).toBeVisible();

    // AC-09: the flag is cleared and the application opens — the screen's
    // own success timer (SUCCESS_REDIRECT_DELAY_MS) redirects to the role
    // landing page; a web-first wait absorbs that delay rather than a fixed
    // sleep.
    await expect(page).toHaveURL(/\/tickets$/);
    await expect(page.getByRole("heading", { name: "My Tickets" })).toBeVisible();
    await expect(page.locator(".zen-user-badge__trigger")).toContainText(fixtureUser.name);
  });
});

// ---------------------------------------------------------------------------
// E2E-03 (AC-05) — inactive account
// ---------------------------------------------------------------------------
//
// tests.md E2E-03: "Inactive login is refused with the same message as a
// wrong password." specification.md AC-05 / api-spec.md §2.1 BR-08: a wrong
// password, an unknown email and an inactive account all produce the
// byte-identical 401 body — never a distinct "account inactive" message,
// which would let an attacker enumerate which emails exist and are
// disabled. This asserts the on-screen text is identical to E2E-01's
// wrong-password case by comparing against the same
// `SAFE_LOGIN_FAILURE_MESSAGE` constant, not a second hand-typed copy of
// the string that could quietly drift.

test.describe("E2E-03 inactive account (AC-05)", () => {
  test("an inactive account's login attempt is refused with the same message a wrong password gets", async ({
    page,
  }) => {
    await page.goto("/login");
    await page.locator("#login-email").fill(INACTIVE_REQUESTER_EMAIL);
    // The CORRECT shared password — proves the refusal is because the
    // account is inactive, not because the password was wrong.
    await page.locator("#login-password").fill(LOCAL_DEV_PASSWORD);
    await page.getByRole("button", { name: "Sign in" }).click();

    await expect(page.getByRole("alert")).toContainText(SAFE_LOGIN_FAILURE_MESSAGE);
    await expect(page).toHaveURL(/\/login$/);
  });
});

// ---------------------------------------------------------------------------
// E2E-04 (AC-10) — logout
// ---------------------------------------------------------------------------
//
// tests.md E2E-04: "Logout returns to Login; Back and a typed protected URL
// both land on Login." specification.md AC-10: given an authenticated
// session, when the user logs out and then calls a protected endpoint with
// the same token, the call is unauthenticated. ui-spec.md §4.1: afterwards
// the browser Back button and any directly-typed protected route both land
// on Login, never a cached authenticated view.

test.describe("E2E-04 logout (AC-10)", () => {
  test("logout returns to Login, and the browser Back button and a re-typed protected URL both land back on Login", async ({
    page,
  }) => {
    const fixtureUser = await createPlainLoginFixtureUser("logout-journey");
    await loginAs(page, fixtureUser.email, LOCAL_DEV_PASSWORD);
    await expect(page).toHaveURL(/\/tickets$/);

    // A real (pushed, not replaced) client-side navigation to a second
    // protected route, so the Back button below has a genuine authenticated
    // history entry to return to — the login redirect itself uses
    // `replace`, so without this the only prior entry would be the
    // pre-login blank page.
    await page.getByRole("link", { name: "Create Ticket" }).click();
    await expect(page).toHaveURL(/\/tickets\/new$/);

    // ui-spec.md §4.1 UserBadge menu -> Logout.
    await page.locator('button[aria-haspopup="menu"]').click();
    await page.getByRole("menuitem", { name: "Logout" }).click();
    await expect(page).toHaveURL(/\/login$/);

    // AC-10 / ui-spec.md §4.1: the Back button lands back on Login — the
    // session cookie was cleared server-side (api-spec.md §2.2: the row is
    // deleted, not merely expired), so navigating back to the previously
    // visited protected route (My Tickets) re-runs RequireAuth's own
    // session check, finds none, and redirects here instead of rendering
    // any cached view of that route.
    await page.goBack();
    await expect(page).toHaveURL(/\/login$/);
    await expect(page.locator("#login-email")).toBeVisible();
    await expect(page.getByRole("heading", { name: "My Tickets" })).toHaveCount(0);

    // Directly (re-)typing a protected URL afterwards must also land on
    // Login, not a cached authenticated view.
    await page.goto("/tickets");
    await expect(page).toHaveURL(/\/login$/);
    await expect(page.locator("#login-email")).toBeVisible();
  });
});
