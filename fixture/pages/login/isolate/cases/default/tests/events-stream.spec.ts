import { expect, test } from "@playwright/test";
import { capture } from "isolate-events";

// Asserting on the EVENTS a component emits (not just DOM state), by observing
// the page's RxJS event stream from the test via the isolate-events bridge.
test("Sign in emits a click on the event stream", async ({ page }) => {
  const ev = await capture(page); // install the bridge before navigating
  await page.goto("/pages/login/auth/default");

  await page.locator("#submit").click();

  const e = await ev.expect((e) => e.source === "button#submit" && e.type === "click", { timeout: 3000 });
  expect(e.type).toBe("click");
  expect(e.detail).toContain("Sign in");
});

test("typing in the email field emits input events carrying the value", async ({ page }) => {
  const ev = await capture(page);
  await page.goto("/pages/login/auth/default");

  await page.locator("#email").fill("hi@x.com");

  const e = await ev.expect((e) => e.source === "input#email" && e.type === "input", { timeout: 3000 });
  expect(e.detail).toContain("hi@x.com");
});
