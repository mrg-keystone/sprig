import { expect, test } from "@playwright/test";

// The workbench SHELL's controls dock for this case: the counter's own `count` signal
// control (live edit — no reload) and ONE untargeted "ui-button" instance group whose
// edits apply as a _mocks force-prop via a stage reload (an untargeted group has no
// DOM target, so it maps to the component selector — ALL its instances).
const BASE = process.env.ISOLATE_BASE_URL ?? "http://127.0.0.1:8000";
const SHELL = `${BASE}/#/components/counter/default/three`;

/** Gate on THIS case being active + its surface published (the hash switch and the
 *  bridge's ready message are both async — a generic gate could match the shell's
 *  initial case instead). */
async function openShell(page: import("@playwright/test").Page) {
  await page.goto(SHELL);
  await expect(page.locator(".crumb")).toContainText("Starts at 3", { timeout: 10000 });
  await expect(page.locator(".ctrl-group", { hasText: "count" }).first()).toBeVisible({ timeout: 10000 });
  return page.frameLocator(".stage-frame");
}

test("the count signal control edits the live island (no reload)", async ({ page }) => {
  const frame = await openShell(page);
  await expect(frame.locator("p.tabular-nums")).toHaveText("3"); // case signal applied

  // the range control writes the signal through the bridge — the stage updates live.
  const row = page.locator(".ctrl-row", { hasText: "count" });
  await row.locator("input[type=range]").fill("7");
  await expect(frame.locator("p.tabular-nums")).toHaveText("7");
});

test("the ui-button instance group's disabled control forces the mock onto all instances", async ({ page }) => {
  const frame = await openShell(page);
  await expect(frame.locator("#increment")).toBeEnabled();
  await expect(frame.locator("#decrement")).toBeEnabled();

  // untargeted group → _m.ui-button.disabled query override → stage reload, both forced.
  const group = page.locator(".ctrl-group", { hasText: "ui-button" });
  await group.locator("input[type=checkbox]").check();
  await expect(frame.locator("#increment")).toBeDisabled({ timeout: 10000 });
  await expect(frame.locator("#decrement")).toBeDisabled();
});
