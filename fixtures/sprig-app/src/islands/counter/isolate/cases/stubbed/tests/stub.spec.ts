import { expect, test } from "@playwright/test";
import { waitHydrated } from "isolate-events";

const BASE = process.env.ISOLATE_BASE_URL ?? "http://127.0.0.1:8000";

test("renders placeholders for the mocked ui-button sub-components", async ({ page }) => {
  await page.goto(`${BASE}/components/counter/default/stubbed`);
  await waitHydrated(page);
  // Both <ui-button> children are swapped for labeled stubs (the stub carries the
  // mocked selector as its label + data-stub attribute)…
  await expect(page.locator(".iso-stub")).toHaveCount(2);
  await expect(page.locator(".iso-stub").first()).toHaveText("ui-button");
  await expect(page.locator(".iso-stub").first()).toHaveAttribute("data-stub", "ui-button");
  // …and the real buttons are gone.
  await expect(page.locator("#increment")).toHaveCount(0);
});
