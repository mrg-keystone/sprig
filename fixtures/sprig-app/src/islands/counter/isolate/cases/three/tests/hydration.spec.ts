import { expect, test } from "@playwright/test";
import { waitHydrated } from "isolate-events";

// Clicking an island before it hydrates is a silent no-op against the SSR markup.
// waitHydrated() gates on the stage being interactive AND the case's _signals applied.
const BASE = process.env.ISOLATE_BASE_URL ?? "http://127.0.0.1:8000";

test("waitHydrated makes the first click register", async ({ page }) => {
  await page.goto(`${BASE}/components/counter/default/three`);
  const count = page.locator("p.tabular-nums");
  // (no pre-wait SSR assertion: hydration can seed the case signal before the first
  // poll lands, so "still shows the SSR default" is a race, not a property)

  await waitHydrated(page); // case signal (count=3) is applied by now
  await expect(count).toHaveText("3");
  await page.locator("#increment").click();

  await expect(count).toHaveText("4"); // click landed → island is live
});
