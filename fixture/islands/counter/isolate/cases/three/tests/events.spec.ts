import { expect, test } from "@playwright/test";

// The event log captures every event the stage fires (scoped to the component).
// Filters: per-type checkboxes + an addable/removable list of regexes (AND).
test("regex filters are addable and removable", async ({ page }) => {
  await page.goto("/components/counter/default/three");
  const log = page.locator(".iso-log");
  await expect(log.locator(".iso-log__empty")).toBeVisible(); // empty at first

  await page.locator("#increment").click();
  await page.locator("#decrement").click();

  // Add a regex filter (Enter) → narrows to matching rows only.
  await log.locator(".iso-log__filter").fill("button#increment");
  await log.locator(".iso-log__filter").press("Enter");
  await expect(log.locator(".iso-log__chip")).toHaveCount(1);
  await expect(log.locator(".iso-log__chip")).toContainText("button#increment");
  await expect(log.locator(".iso-log__row", { hasText: "button#decrement" })).toHaveCount(0);
  await expect(log.locator(".iso-log__row", { hasText: "button#increment" })).not.toHaveCount(0);

  // Remove it → the filtered-out rows return.
  await log.locator(".iso-log__chip-x").click();
  await expect(log.locator(".iso-log__chip")).toHaveCount(0);
  await expect(log.locator(".iso-log__row", { hasText: "button#decrement" })).not.toHaveCount(0);
});

test("event-type checkboxes hide that type", async ({ page }) => {
  await page.goto("/components/counter/default/three");
  const log = page.locator(".iso-log");

  await page.locator("#increment").click();
  await expect(log.locator(".iso-log__row", { hasText: "pointerdown" })).toHaveCount(1);

  // Untick "pointerdown" → its rows disappear. Use click() (one deliberate click)
  // rather than uncheck(), which re-clicks a controlled checkbox mid-re-render.
  await log.locator(".iso-log__type", { hasText: "pointerdown" }).locator("input[type=checkbox]").click();
  await expect(log.locator(".iso-log__row", { hasText: "pointerdown" })).toHaveCount(0);
});
