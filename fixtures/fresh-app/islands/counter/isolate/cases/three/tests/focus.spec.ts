import { expect, test } from "@playwright/test";

test("counter buttons are keyboard focusable", async ({ page }) => {
  await page.goto("/components/counter/default/three");
  await page.locator("#increment").focus();
  await expect(page.locator("#increment")).toBeFocused();
});
