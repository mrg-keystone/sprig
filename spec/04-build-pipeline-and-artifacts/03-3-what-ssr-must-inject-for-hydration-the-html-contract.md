## 3. What SSR must inject for hydration (the HTML contract)

| what | where | consumed by | required? |
| --- | --- | --- | --- |
| `app.css` link | head | browser stylesheet load | required |
| `client.js` modulepreload | head | preload hint for the tail module script | required |
| vendored chart script (`apexcharts.js`) | head | chart components at hydration | required |
| perf beacon snippet (`perfHeadSnippet`) | head, before the stylesheet | self-contained — posts its own beacons, no client-step consumer | optional — gated by `INFRA_PERF=true` + `INFRA_PERF_URL` (item 1 below) |
| `git-*`/`build-time` meta tags | head | external tooling, not the client runtime | optional — gated by `build-info.json` presence (item 1 below) |
| `<sprig-island>` host + `sprig-props` script | body-per-island | `bootstrapIslands` (03 [§3](../03-islands-and-hydration/03-3-client-boot-trigger-arming.md)); props parsed by hydrate (03 [§2](../03-islands-and-hydration/02-2-the-ssr-client-props-contract.md)) | required, one per island |
| `<sprig-outlet data-level>` | body-outlet | soft-nav's outlet-chain walk (03 [§7](../03-islands-and-hydration/07-7-soft-navigation-hydrate-ts-500-727.md)) | required, one per layout level |
| `#__sprig_config` | tail | client.js boot step 1 (03 [§3](../03-islands-and-hydration/03-3-client-boot-trigger-arming.md)) | required (its own fields vary — item 4 below) |
| `client.js` module script | tail | boot itself | required |

**Conformance.** A conforming SSR document satisfies, exactly:

- exactly one `#__sprig_config` tail script;
- exactly one `<sprig-island>` host + one `sprig-props` script per island;
- exactly one `<sprig-outlet data-level>` per layout level;
- the required head trio always present: the `app.css` link, the `client.js`
  modulepreload, and the vendored chart script;
- every optional element present IFF its gate holds — the perf snippet AND the
  config's `perf` field iff `INFRA_PERF=true` (+ `INFRA_PERF_URL`); the head-meta
  tags iff `build-info.json` is present; `hmr:true` iff the renderer is running in
  dev mode.

1. Head — the runtime bits injected into WHICHEVER head is in play (app or framework
   default, mod.ts:512-520), in document order:

   | element | emitted markup | source | required / gate |
   | --- | --- | --- | --- |
   | head-meta (`git-repo`/`git-commit`/`git-branch`/`build-time`) | one `<meta name="…" content="…">` per present field | keep's `injectHeadMeta`, spliced right after the opening `<head>` from `build-info.json` (06 [§7](../06-keep-serving-composition/07-7-head-meta-provenance-logging.md)) — the label "`git-*` meta" used elsewhere in this doc also covers the non-git-prefixed `build-time` tag | gated — present iff `build-info.json` exists; each of the four tags independently gated on its own field being a non-empty string |
   | perf beacon snippet (`perfHeadSnippet`) | inline `<script>` posting the nav-start beacon | perf.ts:71-81 | optional — gated by `INFRA_PERF=true` + `INFRA_PERF_URL` (optional `INFRA_APP_ID`; `perfConfig`, perf.ts:35-54 — not part of the app-facing config surface) |
   | `app.css` link | `<link rel="stylesheet" href="<base>/_assets/app.css?v=…">` | `documentHead` (mod.ts:512-520) — stamped by `assetsVersioner` like every other stable-named asset ([§4](04-4-versioning-caching-contract.md)) | required |
   | `client.js` modulepreload | `<link rel="modulepreload" href="<base>/_assets/client.js?v=…">` | `documentHead` — the SAME `version` value as the `app.css` link, right after it | required |
   | vendored chart script | `<script defer src="<base>/_assets/vendor/apexcharts.js">` | served from keep's VENDOR map, spec 06 §6 | required |

   Row order above IS document order: keep's `injectHeadMeta` splices the head-meta
   tags right after the opening `<head>`, BEFORE the framework's own runtime block;
   WITHIN that block the perf snippet comes BEFORE the stylesheet link — an inline
   script after a pending stylesheet blocks on the CSSOM, so the nav-start
   `timeOrigin` must be captured before the render-blocking CSS arrives. (Favicon/app
   head, when present, is the app's own and sits ahead of all of this — see below.)

   The app OWNS the document head via bootstrap/template.html's `<head>` — its
   charset, viewport, title, favicon, fonts, and meta are AUTHORITATIVE; the
   framework injects only the runtime bits above AFTER it, and generates no
   competing title/charset. When the app has no `<head>` of its own,
   `createRenderer({ favicon })` + a route's `meta.title` drive the framework's
   default head (charset, viewport, title, favicon) instead.

   The perf snippet inlines a tiny script POSTing two fire-and-forget beacons joined
   by one random `navId`: one stamped with `performance.timeOrigin` at `<head>`
   execution (nav start), one on the window `load` event (page loaded) — payload
   `{timestamp, navId, route: location.pathname, "infra-app-id"}`, sent via
   `navigator.sendBeacon` with a `keepalive` `fetch` fallback; a SOFT navigation's
   pair is instead fired by the client runtime off `__sprig_config.perf` (item 4,
   below).

   `app.css` DOES carry `?v=` in the head link: `documentHead` emits `<link rel="stylesheet"
   href="${base}/_assets/app.css?v=${version}" />` with the SAME `version` value stamped onto the
   `client.js` modulepreload right after it (mod.ts), and `assetsVersioner`/`versionOf`'s hashed
   file set is `.js` files + `app.css` by name (hash.ts) — so that `version` is itself computed
   FROM `app.css`'s own bytes, not merely applied to it. Matches [§4](04-4-versioning-caching-contract.md) and [§2](02-2-the-artifact-set-static.md) putting `app.css` in the
   versioned set, and [§1](01-1-pipeline-buildclient-srcdir-outdir-build-ts-63-298.md).8's `shortHash` computed over that same `.js` + `app.css` set.
2. Per island: the `<sprig-island>` host with `data-sel`, `data-trigger`, and the
   `<script class="sprig-props">` JSON bridge (spec 03 [§2](../03-islands-and-hydration/02-2-the-ssr-client-props-contract.md)). An optional `data-page`
   host attr is HONORED but never emitted by the framework (`islandHost` writes only
   the scope attr + `data-sel` + `data-trigger`, render.ts:19-29): hydrate resolves an
   island's page as `el.dataset.page ?? currentPage()` (hydrate.ts:787) — a per-host
   override hook for external tooling; the live mechanism is `__sprig_config.page`
   (item 4).
3. Outlets: `<sprig-outlet data-level="<value>">` nested per layout level — `<value>` is
   the matched route level's `load` string (`MatchedLevel.load`, spec 01 §3, e.g.
   `"routers/admin"` or `"pages/home"`) identifying the component instance rendered
   INSIDE that outlet — the same identifier `renderBody` threads through `renderLevel`'s
   `outletKey` param (mod.ts) into `data-level` (render.ts). It is a per-position content
   identifier, not an integer nesting depth; the client's soft-nav walk pairs current/
   fetched outlet chains by POSITION, outermost→inner (spec 03 §7).
4. Tail: `<script type="application/json" id="__sprig_config">{base, v, reserved,
   page?, perf?, hmr?}</script>` (every `<` as the JSON escape backslash-`u003c`,
   like the props bridge — spec 02 [§4](../02-template-compiler/05-4-render-ts-ssr-semantics.md)) then the `client.js` module script.

   | field | value / type | emitted when | consumer (client step + §) | absent → behavior |
   | --- | --- | --- | --- | --- |
   | `base` | string, the app's URL base prefix | always | boot step 1 read; threads into every base-relative URL — chunk loads, `bootstrapIslands`, `setupSoftNav` (03 [§3](../03-islands-and-hydration/03-3-client-boot-trigger-arming.md)) | n/a — always present |
   | `v` | string, build version | always | chunk-load URL versioning, `isl.<sel>.js?v=<v>` (03 [§3](../03-islands-and-hydration/03-3-client-boot-trigger-arming.md)) | n/a — always present |
   | `reserved` | string[], the reserved-path skip list threaded from `createRenderer`'s `opts.reserved`, defaulting to `["/api", "/docs"]` (mod.ts:76) — independent of `applyBasePrefix`'s OWN hardcoded `/api`/`/docs`/`/_assets` skip list (mod.ts:357, [§1](01-1-pipeline-buildclient-srcdir-outdir-build-ts-63-298.md)), which governs the SSR-side href/action rewrite, not this field | always, every base including root — `tailScripts` emits `{ base, v, reserved }` unconditionally (mod.ts:552) | `setupSoftNav`'s reserved-prefix skip check, mirroring the server (03 [§3](../03-islands-and-hydration/03-3-client-boot-trigger-arming.md), [§7](../03-islands-and-hydration/07-7-soft-navigation-hydrate-ts-500-727.md)) | n/a — always present |
   | `page` | string, the matched page's folder basename | the matched route is a registered page (mod.ts `pageName`) | `bootstrapIslands` → `setCurrentPage`; soft-nav re-reads it from each fetched document (`pageFromConfig`); `componentsForPage(page)` mirrors the server's `registryForPage` (03 [§3](../03-islands-and-hydration/03-3-client-boot-trigger-arming.md), §6) | global-only child resolution |
   | `perf` | `{ url, app }` — collector endpoint + reporting app id (`PerfEndpoint`, hydrate.ts) | under the SAME hidden INFRA gate as the head beacon snippet (`INFRA_PERF`/`INFRA_PERF_URL`, optional `INFRA_APP_ID`; `perfConfig`, perf.ts — item 1 above) | `setupSoftNav`'s navigate listener (03 [§3](../03-islands-and-hydration/03-3-client-boot-trigger-arming.md), [§7](../03-islands-and-hydration/07-7-soft-navigation-hydrate-ts-500-727.md)) | no soft-nav beacons (the feature is off end-to-end) |
   | `hmr` | literal `true` | the renderer is running in dev mode (`sprig dev`; prod never sets it, keeping the bundle byte-identical dev↔prod per [§1](01-1-pipeline-buildclient-srcdir-outdir-build-ts-63-298.md)) | boot step 2's `if (cfg.hmr) startHmr(cfg.base)` (03 [§3](../03-islands-and-hydration/03-3-client-boot-trigger-arming.md), [§9](../03-islands-and-hydration/09-9-hmr-hooks-in-the-client-runtime.md)) | the compiled-in HMR client (`hmr.ts`) stays dormant for the life of the page |

   `perf` beacon accounting (per-nav-leg counts, dedup by `navId`) is owned by 03
   [§7](../03-islands-and-hydration/07-7-soft-navigation-hydrate-ts-500-727.md) —
   soft-nav fires the same beacon pair the head snippet fires, off this field.

   `hmr`: the loader always compiles the dormant HMR client (`hmr.ts`), but only calls
   `startHmr(cfg.base)` when this flag is present — `startHmr` is what opens the
   `${base}/_sprig/hmr` SSE client and arms the template/CSS/reload receiver in
   `hydrate.ts`; `enableHmr()`, called from inside `startHmr` before the SSE connect,
   only flips the flag that `registerIsland`/`hydrateIsland` read.

**Worked example** — a minimal SSR document, non-root base, INFRA_PERF and dev-mode
HMR both on (so every optional field above has a real value; a prod build simply
omits `perf`/`hmr` and drops the perf snippet, and a build with no `build-info.json`
omits the head-meta tags — `reserved` and its default `["/api", "/docs"]` are
unconditional and appear either way):

```html
<head>
  <meta name="git-commit" content="3f9e2a1">
  <meta name="git-branch" content="main">
  <script>/* perfHeadSnippet — INFRA_PERF only; posts the nav-start beacon */</script>
  <link rel="stylesheet" href="/app/_assets/app.css?v=7f3c9a1e4b6d0852">
  <link rel="modulepreload" href="/app/_assets/client.js?v=7f3c9a1e4b6d0852">
  <script defer src="/app/_assets/vendor/apexcharts.js"></script>
</head>
<body>
  <sprig-outlet data-level="routers/admin">
    <sprig-outlet data-level="pages/home">
      <sprig-island s3f2a91c4 data-sel="cart-badge" data-trigger="load">
        <script type="application/json" class="sprig-props">{"count":3}</script>
        ...server-rendered inner HTML...
      </sprig-island>
    </sprig-outlet>
  </sprig-outlet>
  <script type="application/json" id="__sprig_config">{"base":"/app","v":"7f3c9a1e4b6d0852","reserved":["/api","/docs"],"page":"home","perf":{"url":"https://perf.example.com/collect","app":"storefront"},"hmr":true}</script>
  <script type="module" src="/app/_assets/client.js?v=7f3c9a1e4b6d0852"></script>
</body>
```

Naming conventions: island chunk `<base>/_assets/isl.<sel>.js?v=<v>` (sel = folder
basename); shared `chunk-<HASH>.js`; scope attr `s<8hex>` = FNV-1a of relDir (identical
across build CSS, SSR markers, and client re-render — client prefers the
build-supplied `entry.scope`, falls back to `scopeId(sel)` for older chunks);
`data-sprig-hydrated="1"`, `data-sprig-armed="1"`; event markers
`data-sprig-<event>="<space-joined idx list>"` (`<event>` = the bound DOM event name,
e.g. `data-sprig-click` — the client's delegated listener matches
`[data-sprig-${event}]`, render.ts `Handler.base`; unrelated to the URL `base` used
elsewhere in this document).

