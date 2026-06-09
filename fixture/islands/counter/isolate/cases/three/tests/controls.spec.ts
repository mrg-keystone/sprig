import { expect, test } from "@playwright/test";

// The page renders Counter + two <Button>s (#increment, #decrement). Each button
// instance gets its OWN controls group, keyed by its id — editing one affects
// only that instance.
test("each Button instance has its own disabled control", async ({ page }) => {
  await page.goto("/components/counter/default/three");
  const inc = page.locator("#increment");
  const dec = page.locator("#decrement");
  await expect(inc).toBeEnabled();
  await expect(dec).toBeEnabled();

  // The "#increment" group's disabled control affects only #increment.
  const incGroup = page.locator(".ctrl-group", { hasText: "#increment" });
  await incGroup.locator("input[type=checkbox]").check();
  await expect(inc).toBeDisabled();
  await expect(dec).toBeEnabled();
});
