import { test, expect } from "@playwright/test";

// Harness smoke test (Issue #20). This is the ONLY spec in this slice —
// E2E-01..05 and R-01..06 (docs/lab-02/tests.md §2) are written by later
// slices, several of which depend on PRs not yet merged into lab2-staging.
//
// Its only job is to prove the harness really boots the whole stack: the
// Requester Selection screen (ui-spec.md §6) renders active Requesters that
// can only have come from a live `GET /api/requesters` call, served by the
// real Express app, reading the real (seeded) `toktickit_e2e` Postgres
// database — see e2e/scripts/reset-e2e-db.ts and playwright.config.ts. If
// the client can't reach the server, the server can't reach the database,
// or the database wasn't seeded, this fails loudly instead of silently
// passing on mocked/hardcoded data.
test("boots the full stack: Requester Selection lists seeded active Requesters only", async ({
  page,
}) => {
  await page.goto("/select-requester");

  const select = page.locator("#requester-select");
  await expect(select).toBeVisible();

  const optionLabels = await select.locator("option").allTextContents();

  // The 4 active Requesters seeded by server/prisma/seed.ts, listed
  // alphabetically by the screen (RequesterSelectionScreen.tsx sorts by
  // name) after the "Select a requester…" placeholder.
  for (const activeName of [
    "David Lee",
    "Jennifer Anderson",
    "Michael Brown",
    "Sarah Johnson",
  ]) {
    expect(optionLabels).toContain(activeName);
  }

  // Robert Wilson is seeded INACTIVE (server/prisma/seed.ts) and must never
  // be offered here (api-spec.md §2.3, ui-spec.md §6 "Only active
  // development requesters are shown").
  expect(optionLabels).not.toContain("Robert Wilson");
});
