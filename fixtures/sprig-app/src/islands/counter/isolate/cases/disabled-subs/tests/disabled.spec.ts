import { expect, test } from "@playwright/test";
import { waitHydrated } from "isolate-events";

const BASE = process.env.ISOLATE_BASE_URL ?? "http://127.0.0.1:8000";

// _mocks force-props must hold through hydration: the mocks ride the island's props
// bridge (__mocks) so the client re-render keeps the children forced too.
test("forces disabled onto the ui-button sub-components via _mocks props", async ({ page }) => {
  await page.goto(`${BASE}/components/counter/default/disabled-subs`);
  await waitHydrated(page);
  await expect(page.locator("#increment")).toBeDisabled();
  await expect(page.locator("#decrement")).toBeDisabled();
});
