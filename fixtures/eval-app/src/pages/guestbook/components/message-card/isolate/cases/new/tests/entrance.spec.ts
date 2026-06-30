import { expect, test } from "@playwright/test";

// The isolate runner exposes the preview server as ISOLATE_BASE_URL; no playwright
// config sets a baseURL, so resolve routes against it explicitly.
const BASE = process.env.ISOLATE_BASE_URL ?? "http://localhost:8000";

// `new` case (isNew = true): the <article> carries `animate-rise`, so the CSS-only
// entrance plays. The isolate bridge does NOT surface CSS animation events
// (STAGE_EVENTS has no `animationend`, and it only logs interactive elements — an
// <article> is not one), so we assert the class is applied — the spec's documented
// fallback — rather than waiting on an animationend that never reaches the bridge.
test("the entrance class is applied when isNew", async ({ page }) => {
  await page.goto(`${BASE}/pages/guestbook/message-card/new`);
  await expect(page.locator("article.animate-rise")).toHaveCount(1);
});

// The entrance is the brand-rise overshoot: 320ms, fill `both`, on a compositor-only
// (opacity + transform) keyframe set.
test("the entrance is brand-rise (320ms, fill both)", async ({ page }) => {
  await page.goto(`${BASE}/pages/guestbook/message-card/new`);
  const anim = await page.locator("article.animate-rise").evaluate((el) => {
    const cs = getComputedStyle(el);
    return { name: cs.animationName, duration: cs.animationDuration, fill: cs.animationFillMode };
  });
  expect(anim.name).toBe("brand-rise");
  expect(anim.duration).toBe("0.32s");
  expect(anim.fill).toBe("both");
});
