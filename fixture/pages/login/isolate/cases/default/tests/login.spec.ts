import { expect, test } from "@playwright/test";

// A page lives under /pages/ and composes several components.
test("renders the login page with both buttons", async ({ page }) => {
  await page.goto("/pages/login/auth/default");
  await expect(page.locator("h1")).toHaveText("Welcome back");
  await expect(page.locator("#submit")).toBeVisible();
  await expect(page.locator("#cancel")).toBeVisible();
});

test("each button instance has its own controls group", async ({ page }) => {
  await page.goto("/pages/login/auth/default");
  const submit = page.locator("#submit");
  const cancel = page.locator("#cancel");

  // Disabling the #submit group leaves #cancel untouched.
  await page.locator(".ctrl-group", { hasText: "#submit" }).locator("input[type=checkbox]").check();
  await expect(submit).toBeDisabled();
  await expect(cancel).toBeEnabled();
});

test("logs input events with the value the field emitted", async ({ page }) => {
  await page.goto("/pages/login/auth/default");
  await page.locator("#email").fill("hello");

  // Some row attributed to the email input carries the typed value.
  const valueRow = page.locator(".iso-log__row", { hasText: "hello" }).first();
  await expect(valueRow).toContainText("input#email");
  await expect(valueRow).toContainText("hello");
});

test("does not log events on inert markup (only controls)", async ({ page }) => {
  await page.goto("/pages/login/auth/default");
  await page.locator("h1").click(); // the heading is not a control
  await expect(page.locator(".iso-log__empty")).toBeVisible();
});

test("a disabled control emits no events (not even pointer events)", async ({ page }) => {
  await page.goto("/pages/login/auth/default");
  // Disable #cancel via its controls group.
  await page.locator(".ctrl-group", { hasText: "#cancel" }).locator("input[type=checkbox]").check();
  await expect(page.locator("#cancel")).toBeDisabled();

  // Force a click on the disabled button — pointer events fire but must be ignored.
  await page.locator("#cancel").click({ force: true });
  await expect(page.locator(".iso-log__row", { hasText: "button#cancel" })).toHaveCount(0);
});
