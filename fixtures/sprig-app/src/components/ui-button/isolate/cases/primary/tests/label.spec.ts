import { expect, test } from "@playwright/test";

// Tests for the `primary` case, against its raw preview route.
const BASE = process.env.ISOLATE_BASE_URL ?? "http://127.0.0.1:8000";

test("renders the primary label", async ({ page }) => {
  await page.goto(`${BASE}/components/buttons/regular/primary`);
  await expect(page.locator("#primary")).toBeVisible();
  await expect(page.locator("#primary")).toHaveText("Click me");
});
