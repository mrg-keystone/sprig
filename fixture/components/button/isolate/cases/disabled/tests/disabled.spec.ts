import { expect, test } from "@playwright/test";

// Tests for the `disabled` case — runs against its route /buttons/disabled.
test("renders a disabled button", async ({ page }) => {
  await page.goto("/buttons/regular/disabled");
  await expect(page.locator("#disabled")).toBeDisabled();
});
