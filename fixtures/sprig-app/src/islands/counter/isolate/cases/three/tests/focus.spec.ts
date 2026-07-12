import { expect, test } from "@playwright/test";

const BASE = process.env.ISOLATE_BASE_URL ?? "http://127.0.0.1:8000";

test("counter buttons are keyboard focusable", async ({ page }) => {
  await page.goto(`${BASE}/components/counter/default/three`);
  await page.locator("#increment").focus();
  await expect(page.locator("#increment")).toBeFocused();
});
