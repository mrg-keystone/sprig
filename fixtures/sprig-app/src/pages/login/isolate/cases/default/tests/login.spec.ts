import { expect, test } from "@playwright/test";

// A page lives under /pages/ and composes several components. The render test hits
// the raw preview route; the controls/console tests drive the workbench SHELL (this
// fixture declares TARGETED instance groups — "Sign in" → #submit etc. — whose edits
// write the live DOM node directly, no reload).
const BASE = process.env.ISOLATE_BASE_URL ?? "http://127.0.0.1:8000";
const ROUTE = "/pages/login/auth/default";

/** Open the shell with this case active + its surface published. */
async function openShell(page: import("@playwright/test").Page) {
  await page.goto(`${BASE}/#${ROUTE}`);
  await expect(page.locator(".crumb")).toContainText("Default", { timeout: 10000 });
  await expect(page.locator(".ctrl-group", { hasText: "Sign in" }).first()).toBeVisible({ timeout: 10000 });
  return page.frameLocator(".stage-frame");
}

test("renders the login page with both buttons", async ({ page }) => {
  await page.goto(`${BASE}${ROUTE}`);
  await expect(page.locator("h1")).toHaveText("Welcome back");
  await expect(page.locator("#submit")).toBeVisible();
  await expect(page.locator("#cancel")).toBeVisible();
});

test("each targeted instance group edits only its own element", async ({ page }) => {
  const frame = await openShell(page);

  // Disabling the "Sign in" (#submit) group leaves #cancel untouched — a targeted
  // group writes the live DOM property directly.
  await page.locator(".ctrl-group", { hasText: "Sign in" }).locator("input[type=checkbox]").check();
  await expect(frame.locator("#submit")).toBeDisabled();
  await expect(frame.locator("#cancel")).toBeEnabled();
});

test("logs input events with the value the field emitted", async ({ page }) => {
  const frame = await openShell(page);
  await frame.locator("#email").fill("hello");

  await page.locator(".dock-tab", { hasText: "console" }).click();
  // Locate the row by its SOURCE (the email input), not a broad "hello" text match
  // that any row could satisfy, then assert that row carries the typed value.
  const valueRow = page.locator(".con-row", { hasText: "input#email" }).first();
  await expect(valueRow).toContainText("input#email");
  await expect(valueRow).toContainText("hello");
});

test("does not log events on inert markup (only controls)", async ({ page }) => {
  const frame = await openShell(page);
  await frame.locator("h1").click(); // the heading is not a control

  await page.locator(".dock-tab", { hasText: "console" }).click();
  await expect(page.locator(".con-empty")).toBeVisible();
});

test("a disabled control emits no events (not even pointer events)", async ({ page }) => {
  const frame = await openShell(page);
  // Disable #cancel via its targeted controls group (live DOM write).
  await page.locator(".ctrl-group", { hasText: "Cancel" }).locator("input[type=checkbox]").check();
  await expect(frame.locator("#cancel")).toBeDisabled();

  // Force a click on the disabled button — the stage listener must ignore it —
  // then click the enabled #submit as the positive control that events DO flow.
  await frame.locator("#cancel").click({ force: true });
  await frame.locator("#submit").click();

  await page.locator(".dock-tab", { hasText: "console" }).click();
  await expect(page.locator(".con-row", { hasText: "button#submit" }).first()).toBeVisible();
  await expect(page.locator(".con-row", { hasText: "button#cancel" })).toHaveCount(0);
});
