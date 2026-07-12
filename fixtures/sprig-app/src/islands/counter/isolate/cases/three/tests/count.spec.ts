import { expect, test } from "@playwright/test";
import { waitHydrated } from "isolate-events";

// Tests for the `three` case, against its raw preview route. The island SSRs with its
// own default (count=0); waitHydrated gates on the case's _signals (count=3) being
// applied, so the first assertion is deterministic.
const BASE = process.env.ISOLATE_BASE_URL ?? "http://127.0.0.1:8000";

test("increments and decrements the signal-backed count", async ({ page }) => {
  await page.goto(`${BASE}/components/counter/default/three`);
  await waitHydrated(page);
  const value = page.locator("p.tabular-nums");
  await expect(value).toHaveText("3");
  await page.locator("#increment").click();
  await expect(value).toHaveText("4");
  await page.locator("#decrement").click();
  await page.locator("#decrement").click();
  await expect(value).toHaveText("2");
});
