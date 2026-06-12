import { expect, test } from "@playwright/test";
import { waitHydrated } from "isolate-events";

// Clicking an island before it hydrates is a silent no-op against the SSR markup.
// waitHydrated() gates on the stage being interactive, so the first click registers.
test("waitHydrated makes the first click register", async ({ page }) => {
  await page.goto("/components/counter/default/three"); // signal starts at 3
  const count = page.locator(".ctrl-stage p");
  await expect(count).toHaveText("3"); // SSR value

  await waitHydrated(page);
  await page.locator("#increment").click();

  await expect(count).toHaveText("4"); // click landed → island is live
});
