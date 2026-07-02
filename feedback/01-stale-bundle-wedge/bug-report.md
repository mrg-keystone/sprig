# Bug report: immutable caching on a frozen `?v=` URL wedges browsers after every redeploy — all islands fail with "inject() must be called synchronously…"

- **Package:** `@sprig/core` 0.12.13 (repo @ `597c582`, "release: v0.12.13")
- **Severity:** critical in production — a returning browser is permanently broken after any redeploy (every island dead, no data loads), and a normal reload does **not** recover it. Only a manual cache purge (Safari: Develop → Empty Caches) does.
- **Observed on:** alfred (`https://alfred.mrg-keystone.deno.net/ui`, Deno Deploy, served via `serveSprig`), Safari, 2026-07-01.
- **Repro:** [`repro/`](repro/README.md) — three scripts against the real framework code, no browser needed.

## Symptom

After a redeploy, a browser that had visited the previous deploy shows, for **every**
island on the page:

```
[sprig] failed to hydrate island "queue-count-badge" – Error: inject() must be called
synchronously within setup(), resolve(), or a service constructor   chunk-WH7TOYDR.js:2:17034
[sprig] failed to hydrate island "live-status-indicator" – …        chunk-WH7TOYDR.js:2:17034
… (17 islands, all identical)
```

The SSR HTML renders fine; nothing hydrates. A fresh browser (or the same browser after
emptying its cache) has **zero** errors on the same URL — which makes the bug look
non-deterministic and steers debugging toward DI/app code, i.e. entirely the wrong place.

## Evidence collected from the live incident

1. **The erroring file does not exist on the server.** Every console line points at
   `chunk-WH7TOYDR.js`; `curl https://…/ui/_assets/chunk-WH7TOYDR.js` → **404**. The
   current deployment's `client.js` imports `chunk-EDWBLDAN.js`. The bytes throwing the
   errors can only have come from the browser's HTTP cache — they are from an older deploy.
2. **No CDN staleness.** `client.js?v=dev` fetched through the CDN and with a cache-busting
   query returns the same etag (`W/"39923-19f1faa2868"`) — origin and edge agree. The skew
   is purely in the browser.
3. **The asset URL is frozen.** The HTML (correctly `no-store`) references
   `/ui/_assets/client.js?v=dev` — the literal string `dev`, on prod. The URL is identical
   before and after every redeploy.
4. **Assets are served immutable.** Every `/ui/_assets/*` response carries
   `cache-control: public, max-age=31536000, immutable` — "reuse for a year, never
   revalidate, not even on reload".
5. **Fresh sessions are clean.** Multiple fresh Chromium sessions on the same prod URL
   (21:48, 21:58, 22:59, 23:04 that day) show no hydrate errors — the deployed bundle is
   internally fine.

## Root cause — three defects that compose

### 1. `readVersion()` ignores the configured assets dir → the cache-bust is frozen
`framework/.sprig/compiler/mod.ts:175`

```ts
const staticDir = Deno.env.get("SPRIG_ASSETS_DIR") || join(Deno.cwd(), "static");
```

The renderer hashes `<cwd>/static` while `serveSprig` serves the `assetsDir` the app
configured. On Deno Deploy the cwd is not the app dir, `<cwd>/static` doesn't exist, and
the `catch`/empty-list paths (`mod.ts:184-186`) **silently** return the constant `"dev"`.
(If the cwd happens to contain an unrelated `static/` — monorepo root — you instead get a
hash of the *wrong directory*, frozen just the same. Repro 01 shows both.) The app has no
way to fix this through the public API: alfred's `serve.ts` already pins `assetsDir` via
`import.meta` for serving, and the version logic never sees it.

### 2. `serveAsset()` sends `immutable` unconditionally
`packages/keep/mod.ts:126`

`max-age=31536000, immutable` is only sound for **content-addressed URLs** — URLs
guaranteed to change when the bytes change. sprig's asset filenames are stable
(`client.js`, `isl.*.js`); only `?v=` provides the addressing. The moment `?v=` degrades
(defect 1), sprig is instructing browsers to pin a mutable URL for a year with no
revalidation. This is what turns a cosmetic versioning bug into an unrecoverable wedge.

### 3. The injection context is module-scoped → the failure mode is a baffling DI error
`framework/.sprig/core.ts:262`

```ts
let current: Injector | undefined;
```

The wedged browser loads deploy N-1's `client.js` + runtime chunk from cache, but any
island file it doesn't have cached (evicted, or an island added in deploy N) is fetched
fresh and imports deploy N's runtime chunk by its **new hashed name** — so **two copies of
the runtime** coexist. The old copy's `hydrate()` sets `current` in *its* module instance;
the island's component calls `inject()` from the *new* copy, where `current` is
`undefined` → throws `inject() must be called synchronously…` for every island, and the
old copy's catch (`hydrate.ts:279`) logs `[sprig] failed to hydrate island …` from the old
chunk — exactly the observed console. Notably `clientRoot()` already survives dual copies
(it lives on `globalThis.__sprig_root`); the context variable does not, and nothing
detects or reports the dual-runtime state.

### (aggravator) The degradation is silent
`mod.ts:184-186` fall back to `"dev"` with no log line. A production misconfiguration
produces zero signal at deploy time and detonates one redeploy later, in some browsers
only, with an error message three causal steps away from the cause.

## Failure timeline

1. Deploy N-1 is live. A browser visits `/ui`; caches `client.js?v=dev` +
   `chunk-<OLD>.js` (+ some `isl.*.js?v=dev`) — all immutable, 1 year.
2. Deploy N ships. All chunk hashes change. The HTML (no-store) is fresh on next visit —
   but references the same `client.js?v=dev`.
3. The browser reuses the cached deploy N-1 `client.js` and chunk without a single request
   (`immutable`). Any island file not in cache is fetched from deploy N and imports
   `chunk-<NEW>.js`.
4. Two runtime copies → every island's `inject()` throws → the page renders but nothing
   hydrates, no data loads, all interactivity dead.
5. Reload changes nothing (immutable skips revalidation). The user is wedged until manual
   cache purge — or until sprig ships real content-addressed URLs, since the fresh HTML
   would then point at new URLs (this is also the migration path: because the HTML is
   `no-store`, fixing `?v=` un-wedges every affected browser on their next visit,
   automatically).

## Why this reproduces "prod broken, localhost fine"

Local serving uses the same headers and the same `?v=dev` — the bug is latent there too —
but the localhost cache is usually primed *after* the last rebuild (dev loop reloads
constantly), so no old/new mix exists. The real variable isn't prod-vs-local; it's "does
this browser hold assets from a build that has since been replaced". Redeploys make that
true for every returning production visitor.

## Suggested fix

See [`suggestion.md`](suggestion.md). Immediate app-side workaround: set
`SPRIG_ASSETS_DIR` to the absolute assets path before `createRenderer` runs (e.g.
`Deno.env.set("SPRIG_ASSETS_DIR", fromFileUrl(new URL("./static", import.meta.url)))` at
the top of the serve entry) so `?v=` becomes a real hash today.
