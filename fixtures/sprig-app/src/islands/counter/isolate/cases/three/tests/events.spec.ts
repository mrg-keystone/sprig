import { expect, test } from "@playwright/test";

// The workbench SHELL's console: stage events stream up from the preview iframe via
// postMessage; the console dock tab lists them with a substring filter (.con-filter,
// over source+type+detail) and per-type toggle buttons (.con-type). These specs drive
// the shell page itself (hash-selected case) and interact with the stage through its
// iframe. (The v0.3 regex-chip filter UI was replaced by the single filter input.)
const BASE = process.env.ISOLATE_BASE_URL ?? "http://127.0.0.1:8000";
const SHELL = `${BASE}/#/components/counter/default/three`;

test("console filter narrows to matching rows and restores on clear", async ({ page }) => {
  await page.goto(SHELL);
  // the stage is live once the bridge published its surface (controls tab fills in)
  await expect(page.locator(".ctrl-group").first()).toBeVisible({ timeout: 10000 });
  const frame = page.frameLocator(".stage-frame");

  await frame.locator("#increment").click();
  await frame.locator("#decrement").click();

  await page.locator(".dock-tab", { hasText: "console" }).click();
  await expect(page.locator(".con-row", { hasText: "button#increment" }).first()).toBeVisible();
  await expect(page.locator(".con-row", { hasText: "button#decrement" }).first()).toBeVisible();

  // Filter narrows to matching rows only…
  await page.locator(".con-filter").fill("button#increment");
  await expect(page.locator(".con-row", { hasText: "button#decrement" })).toHaveCount(0);
  await expect(page.locator(".con-row", { hasText: "button#increment" }).first()).toBeVisible();

  // …and clearing it restores the filtered-out rows.
  await page.locator(".con-filter").fill("");
  await expect(page.locator(".con-row", { hasText: "button#decrement" }).first()).toBeVisible();
});

test("event-type toggles hide that type", async ({ page }) => {
  await page.goto(SHELL);
  await expect(page.locator(".ctrl-group").first()).toBeVisible({ timeout: 10000 });
  const frame = page.frameLocator(".stage-frame");

  await frame.locator("#increment").click();

  await page.locator(".dock-tab", { hasText: "console" }).click();
  // settle: "click" is the LAST type the stage click emits — once its toggle chip exists,
  // the event burst is fully in and the console has stopped re-rendering under us.
  await expect(page.locator(".con-row", { hasText: "pointerdown" }).first()).toBeVisible();
  await expect(page.locator(".con-type", { hasText: "click" }).first()).toBeVisible();

  // Toggle "pointerdown" off (retry: a click that lands mid re-render is swallowed;
  // the .off class is the proof the toggle took).
  await expect(async () => {
    await page.locator(".con-type", { hasText: "pointerdown" }).click();
    await expect(page.locator(".con-type", { hasText: "pointerdown" })).toHaveClass(/off/, { timeout: 1000 });
  }).toPass({ timeout: 10000 });
  await expect(page.locator(".con-row", { hasText: "pointerdown" })).toHaveCount(0);
});
