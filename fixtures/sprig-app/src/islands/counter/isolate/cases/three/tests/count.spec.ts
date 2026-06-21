import { expect, test } from "@playwright/test";

// Tests for the `three` case — runs against its route /components/counter/default/three.
test("increments and decrements the signal-backed count", async ({ page }) => {
  await page.goto("/components/counter/default/three");
  const value = page.locator("p.tabular-nums");
  await expect(value).toHaveText("3");
  await page.locator("#increment").click();
  await expect(value).toHaveText("4");
  await page.locator("#decrement").click();
  await page.locator("#decrement").click();
  await expect(value).toHaveText("2");
});
