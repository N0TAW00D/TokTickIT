import { expect, test } from "@playwright/test";
import { loginAsSeededUser } from "../support/auth.js";

// R-06 (docs/lab-04/tests.md): the dashboard drill-down chip remove buttons
// keep visible text and a >= 44x44 px touch target at the mobile viewport
// (Lab 2 ui-spec: buttons have visible text, 44 px touch on mobile; Lab 4
// ui-spec §1 keeps those rules). Review follow-up on PR #109.

const IT_STAFF_EMAIL = "carlos.mendes@example.edu";

test.describe("R-06 drill-down chip remove buttons", () => {
  test("mobile: visible Remove label and >= 44x44 hit area", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await loginAsSeededUser(page, IT_STAFF_EMAIL);
    // Same URL the dashboard's "Follow-ups" card links to, with a second
    // drill-down so more than one chip is measured.
    await page.goto("/staff/tickets?followUp=true&myActions=true&scope=open");

    const chips = page.getByRole("list", { name: "Active filters" }).getByRole("button");
    await expect(chips.first()).toBeVisible();
    const count = await chips.count();
    expect(count).toBeGreaterThanOrEqual(2);

    for (let i = 0; i < count; i++) {
      const button = chips.nth(i);
      await expect(button).toContainText("Remove");
      const box = await button.boundingBox();
      expect(box, `chip ${i} has a bounding box`).not.toBeNull();
      expect(box!.width).toBeGreaterThanOrEqual(44);
      expect(box!.height).toBeGreaterThanOrEqual(44);
    }
  });
});
