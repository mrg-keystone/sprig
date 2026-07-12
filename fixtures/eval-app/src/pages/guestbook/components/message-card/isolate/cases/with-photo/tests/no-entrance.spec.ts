import { expect, test } from "@playwright/test";

// The isolate runner exposes the preview server as ISOLATE_BASE_URL; no playwright
// config sets a baseURL, so resolve routes against it explicitly.
const BASE = process.env.ISOLATE_BASE_URL ?? "http://127.0.0.1:8000";

// Any non-new case (isNew = false): the entrance must NOT fire — `animate-rise` is
// absent from the <article>. The card itself still renders exactly once.
test("no entrance class when isNew is false", async ({ page }) => {
  await page.goto(`${BASE}/pages/guestbook/message-card/with-photo`);
  await expect(page.locator("article")).toHaveCount(1);
  await expect(page.locator("article.animate-rise")).toHaveCount(0);
});
