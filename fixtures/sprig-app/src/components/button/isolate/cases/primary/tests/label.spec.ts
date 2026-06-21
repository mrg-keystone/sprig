import { expect, test } from "@playwright/test";

// Tests for the `primary` case — runs against /components/buttons/regular/primary.
test("renders the primary label", async ({ page }) => {
  await page.goto("/components/buttons/regular/primary");
  await expect(page.locator("#primary")).toBeVisible();
  await expect(page.locator("#primary")).toHaveText("Click me");
});
