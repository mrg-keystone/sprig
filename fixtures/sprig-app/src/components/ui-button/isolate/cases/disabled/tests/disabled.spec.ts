import { expect, test } from "@playwright/test";

// Tests for the `disabled` case, against its raw preview route.
// The runner exposes the preview server as ISOLATE_BASE_URL; no playwright
// config sets a baseURL, so resolve routes against it explicitly.
const BASE = process.env.ISOLATE_BASE_URL ?? "http://127.0.0.1:8000";

test("renders a disabled button", async ({ page }) => {
  await page.goto(`${BASE}/components/buttons/regular/disabled`);
  await expect(page.locator("#disabled")).toBeDisabled();
  await expect(page.locator("#disabled")).toHaveText("Can't touch this");
});
