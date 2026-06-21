import { expect, test } from "@playwright/test";

test("renders placeholders for the mocked Button sub-components", async ({ page }) => {
  await page.goto("/components/counter/default/stubbed");
  // Both <Button> children are swapped for labeled stubs…
  await expect(page.locator(".iso-stub")).toHaveCount(2);
  await expect(page.locator(".iso-stub").first()).toHaveText("Button");
  // …and the real button is gone.
  await expect(page.locator("#increment")).toHaveCount(0);
});
