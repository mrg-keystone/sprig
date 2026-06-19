# Playwright testing & the dev loop

> How to keep a living `user-stories.md` and prove each story works in a real browser,
> plus the Fresh 2 dev-server reliability rules that make those tests trustworthy.

## `user-stories.md` — the living spec

Maintain a `user-stories.md` at the project root: a running **bulleted list, one line per
thing a user can actually do** in the app. Add a bullet the moment you build the feature —
this file is the human-readable spec of what the app does, and the checklist your tests
must cover.

A good story is phrased as a user action with an **observable outcome**, and names the
HTTP-level fact when it matters (status code, redirect):

```md
# User stories
- Visit /blog and see the list of posts, newest first
- Open a post at /blog/:slug and read its full body
- Request an unknown /blog/:slug → see the 404 page AND get HTTP 404 (not a soft 200)
- Click the header dark-mode toggle → the footer "currently:" label flips instantly
- Submit the contact form with a valid email → land on /thanks (303 redirect)
- Submit the contact form with a bad email → stay on /contact with an inline error (422)
- Visit /admin while logged out → get redirected to /login (302)
- Log in with valid creds → reach /admin
```

Keep code and stories in lockstep: a new feature means a **new bullet here and a new
Playwright test**, in the same change. If a story is hard to phrase, the feature is
probably underspecified.

## One Playwright test per story

Every story gets a Playwright test that drives the **real running app** in a browser and
asserts the user-visible outcome. No mocks, no stubs, no fakes — exercise the actual SSR
HTML, island hydration, form POST/redirects, and status codes. (This matches the
project's no-mocks testing stance: test the real thing end to end.)

Test the things SSR + islands actually do, including the Fresh-2-specific facts:

- **SSR content** — assert text/markup is present in the server response.
- **Status codes** — assert `response.status()`, not just the DOM. A "404" page that
  returns 200 is a bug (soft 404); a real `HttpError(404)` returns 404. The DOM alone
  can't tell them apart.
- **Island interactivity** — click/type and assert the DOM reacts (this only passes if
  hydration works), e.g. a toggle that syncs two islands.
- **Forms** — submit and assert the redirect (`waitForURL("**/thanks")`) for the 303 PRG
  path, and the inline-error path for invalid input.
- **Auth/redirects** — hit a protected route logged out and assert the bounce to /login.

### Adaptable test file

Run with `deno test -A tests/user_stories.test.ts` (Playwright via the `npm:` specifier;
first run downloads the browser). Point `BASE_URL` at a freshly-started server (see below).

```ts
// tests/user_stories.test.ts
import { chromium, type Browser } from "npm:playwright";

const BASE = Deno.env.get("BASE_URL") ?? "http://localhost:8000";

Deno.test("user stories", async (t) => {
  const browser: Browser = await chromium.launch();
  const page = await browser.newPage();
  try {
    await t.step("visit /blog → posts listed newest-first", async () => {
      await page.goto(`${BASE}/blog`, { waitUntil: "load" });
      const titles = await page.locator("[data-post-title]").allTextContents();
      if (titles.length === 0) throw new Error("no posts rendered");
    });

    await t.step("unknown slug → HTTP 404 (not a soft 200)", async () => {
      const res = await page.goto(`${BASE}/blog/does-not-exist`);
      if (res?.status() !== 404) throw new Error(`expected 404, got ${res?.status()}`);
    });

    await t.step("dark-mode toggle syncs header + footer", async () => {
      await page.goto(BASE);
      const before = await page.locator("#theme-label").textContent();
      await page.locator("#theme-toggle").click();
      const after = await page.locator("#theme-label").textContent();
      if (before === after) throw new Error("footer label did not react to the toggle");
    });

    await t.step("contact form: valid email → /thanks (303)", async () => {
      await page.goto(`${BASE}/contact`);
      await page.fill('input[name="name"]', "Ada");
      await page.fill('input[name="email"]', "ada@example.com");
      await page.fill('textarea[name="message"]', "hello");
      await page.click('button[type="submit"]');
      await page.waitForURL("**/thanks");
    });

    await t.step("/admin while logged out → /login (302)", async () => {
      await page.goto(`${BASE}/admin`);
      await page.waitForURL("**/login**");
    });
  } finally {
    await browser.close();
  }
});
```

Add a `data-post-title`, `id="theme-toggle"`, `id="theme-label"`, etc. to the markup so
tests have stable hooks instead of brittle text/CSS selectors.

## Run story tests against a FRESH server (this is the important part)

Do **not** point story tests at a long-lived `deno task dev` server you've been editing.
The Fresh/Vite dev server keeps a module graph in memory, and some changes are not
invalidated on edit (see below), so a stale server can make a test pass or fail against
code that no longer matches disk. Always run the suite against a **freshly-started**
server so what you assert is what's actually on disk.

Two good options:

```ts
// Option A — test the production build (closest to reality):
//   deno task build && deno serve -A _fresh/server.js &   then BASE_URL=http://localhost:8000
//
// Option B — start a clean dev server for the run and tear it down:
async function startServer(port = 8123) {
  const cmd = new Deno.Command("deno", {
    args: ["task", "dev", "--port", String(port)],
    stdout: "piped", stderr: "piped",
  }).spawn();
  // wait until it answers
  for (let i = 0; i < 60; i++) {
    try { await fetch(`http://localhost:${port}/`); break; } catch { await new Promise(r => setTimeout(r, 500)); }
  }
  return cmd; // call cmd.kill() in a finally
}
```

## Why a fresh server: the dev-loop staleness rules

Reproduced behavior on Fresh 2.3 + Vite 7:

- **Route/island `.tsx` edits hot-reload reliably.** HMR applies (or triggers a full
  reload) and a normal browser reload always reflects them — the HTML is served with no
  cache headers, so reloads refetch fresh SSR. No service worker is involved.
- **Statically-imported JSON/data files go stale and stay stale.** `import data from
  "./data.json" with { type: "json" }` is cached in the SSR module graph; editing the
  file fires **no HMR**, and **every** request (reload *and* a brand-new tab) keeps
  serving the old value until you **restart the dev server**. This is the usual cause of
  "I changed it and nothing updates, even on reload." If opening a new tab ever seemed to
  fix it, a server restart had happened in between — the restart was the fix, not the tab.
  - **Fix:** read changing data at **request time** instead of importing it:
    ```ts
    const posts = JSON.parse(await Deno.readTextFile(new URL("../data/posts.json", import.meta.url)));
    ```
    Now edits show up on a plain reload, no restart — verified.
- **Server/config files need a restart:** `main.ts`, `vite.config.ts`, `deno.json`,
  `utils.ts` (define/State), `.env`. Editing these and only reloading the browser will
  show stale output.
- **Adding a *new* island or route file needs a restart, too.** `@fresh/plugin-vite`
  builds the island registry from a one-shot filesystem scan at dev-server start, then
  patches it incrementally from chokidar `add`/`unlink` events (across two plugins that
  share state). That incremental path drifts out of sync with a clean scan on a structural
  add — the observed symptom is the client entry emitting a bare `fresh-island::Name.tsx`
  specifier, which the browser reads as the URL scheme `fresh-island:` → CORS/404 → **no
  hydration at all, for every island on the page** (one broken specifier takes the whole
  page down). *Editing* an existing island hot-reloads fine; a structural **add** still needs
  a restart — the stale half is the server-side island registry, which only a restart
  rebuilds (no client reload trick rescues it). Restart `deno task dev` after adding an
  island/route (or wrap `vite` in a small supervisor that restarts only when the *set* of
  island/route files changes, so ordinary edits still hot-reload).

### Keep saves reflecting on the open tab — without breaking Safari

Use **standard Fresh HMR** (the default). Do **not** force a full reload on every change.

> ⚠️ **The `always-full-reload` plugin breaks Safari.** A tempting "fix" is a dev plugin whose
> `handleHotUpdate` does `server.ws.send({type:"full-reload"})`. It *looks* reliable on Chrome,
> but on **Safari** a full reload re-imports island modules at their stable `fresh-island::*`
> URLs, which Safari serves from its module cache **ignoring `no-store`** — so the island you
> just edited renders **stale** while a new tab shows it fresh. Reproduced + fixed in real
> Safari via `safaridriver`. Standard HMR avoids it by patching the changed module at a
> cache-busted `?t=` URL (which Safari refetches). **Don't reintroduce always-full-reload.**

1. **Standard HMR + `no-store`.** Island edits hot-patch in place; route/server edits
   full-reload. Keep `cache-control: no-store` for fetches/documents.

   ```ts
   // vite.config.ts
   import { fresh } from "@fresh/plugin-vite";
   // Optional: reload a tab whose HMR socket died during a server restart (Safari throttling
   // a backgrounded tab, a long restart). Dev-only; auto-ships the snippet to the client.
   import { devReconnect } from "@mrg-keystone/keep/vite";
   export default defineConfig({
     server: { headers: { "cache-control": "no-store" } },
     plugins: [fresh(), devReconnect()], // devReconnect() is optional
   });
   ```

2. **Read changing data at request time** (above) so reloads serve fresh data.

Verified together: editing a route *and* editing a request-time-read `data.json` each
auto-refreshed an already-open tab to the latest, with no manual reload and no new tab.
The only remaining blip is editing the dev config / server entry itself
(`vite.config.ts`/`main.ts`/`deno.json`) — that restarts the server; the tab reconnects
when it's back. **Tradeoff:** a full reload on every save loses island runtime state
(a counter resets) and is marginally slower than partial HMR — the price of never being
stale. Drop the plugin if you'd rather keep island state during a session.

### In Playwright

Don't trust a long-lived server: start fresh per run (above). As belt-and-suspenders
against any browser caching, navigate with a cache-buster
(`page.goto(url + "?_=" + Date.now())`) and `waitForSelector` on a known marker before
asserting. Assert **status codes** off the navigation `response`, not just the DOM.

## See also
- `testing.md` — Fresh's built-in server-side handler/middleware tests (fast, no browser)
- `concepts/data-fetching.md` — request-time data loading
- `advanced/error-handling.md` — `HttpError` + `_error.tsx` for correct 404/500 status
