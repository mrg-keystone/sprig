import { expect, test } from "@playwright/test";

test("forces disabled onto the Button sub-components via _mocks props", async ({ page }) => {
  await page.goto("/components/counter/default/disabled-subs");
  await expect(page.locator("#increment")).toBeDisabled();
  await expect(page.locator("#decrement")).toBeDisabled();
});
