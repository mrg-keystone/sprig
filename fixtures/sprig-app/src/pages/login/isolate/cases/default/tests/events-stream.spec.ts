import { expect, test } from "@playwright/test";
import { capture, waitHydrated } from "isolate-events";

// Asserting on the EVENTS a component emits (not just DOM state), by observing
// the page's event stream from the test via the isolate-events bridge. The
// stage-bridge produces the events under direct headless navigation; capture()
// must be called BEFORE page.goto, and waitHydrated gates interaction on the
// bridge being live (its stage listeners are what feed the stream).
const BASE = process.env.ISOLATE_BASE_URL ?? "http://127.0.0.1:8000";
const ROUTE = `${BASE}/pages/login/auth/default`;

test("Sign in emits a click on the event stream", async ({ page }) => {
  const ev = await capture(page); // install the bridge before navigating
  await page.goto(ROUTE);
  await waitHydrated(page);

  await page.locator("#submit").click();

  const e = await ev.expect(
    (e) => e.source === "button#submit" && e.type === "click",
    { timeout: 3000 },
  );
  expect(e.type).toBe("click");
  expect(e.detail).toContain("Sign in");
});

test("typing in the email field emits input events carrying the value", async ({ page }) => {
  const ev = await capture(page);
  await page.goto(ROUTE);
  await waitHydrated(page);

  await page.locator("#email").fill("hi@x.com");

  const e = await ev.expect(
    (e) => e.source === "input#email" && e.type === "input",
    { timeout: 3000 },
  );
  expect(e.detail).toContain("hi@x.com");
});

// Negative path: the bridge must REJECT (time out) when no matching event ever
// fires — not hang — so a wrong predicate fails a spec instead of stalling it.
test("ev.expect times out (rejects) when no matching event fires", async ({ page }) => {
  const ev = await capture(page);
  await page.goto(ROUTE);
  await waitHydrated(page);

  // No interaction, and a predicate that can never match.
  let rejected = false;
  try {
    await ev.expect((e) => e.type === "never-fires", { timeout: 500 });
  } catch {
    rejected = true; // rxjs timeout() → firstValueFrom rejects, as designed
  }
  expect(rejected).toBe(true);
});
