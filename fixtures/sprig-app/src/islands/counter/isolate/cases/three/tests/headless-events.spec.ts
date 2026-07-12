import { expect, test } from "@playwright/test";
import { capture, waitHydrated } from "isolate-events";

// ISOLATE BUG 3 regression — the isolate-events helpers must work under plain headless
// `playwright test` navigation to the raw case route: the stage-bridge is the producer of
// both __isolateReady (waitHydrated) and the __isolateEmit event feed (capture). Before
// the fix NOTHING produced either signal, so waitHydrated always timed out (5s) and
// capture().expect() never resolved.
const BASE = process.env.ISOLATE_BASE_URL ?? "http://127.0.0.1:8000";

test("waitHydrated resolves headlessly and gates interactivity", async ({ page }) => {
  await page.goto(`${BASE}/components/counter/default/three`);
  await waitHydrated(page); // ← used to poll __isolateReady forever (no producer)

  // the island is live: the case signal (count=3) was applied and a click lands.
  await expect(page.locator(".counter .tabular-nums")).toHaveText("3");
  await page.locator("#increment").click();
  await expect(page.locator(".counter .tabular-nums")).toHaveText("4");
});

test("capture() receives stage events headlessly", async ({ page }) => {
  const events = await capture(page); // BEFORE goto: installs the binding first
  await page.goto(`${BASE}/components/counter/default/three`);
  await waitHydrated(page);

  await page.locator("#increment").click();
  const evt = await events.expect((e) => e.type === "click" && e.source.includes("increment"));
  expect(evt.type).toBe("click");
});
