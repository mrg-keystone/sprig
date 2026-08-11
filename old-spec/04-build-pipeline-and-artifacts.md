# 04 — Build pipeline and the static artifact contract

> Subject: `framework/.sprig/compiler/build.ts` (~37KB) and the `static/` output set.
> Pinned by `build-single-core.test.ts`, `base-href-prefix.test.ts`, and the artifact
> consumers in `mod.ts`/`hydrate.ts`/`packages/keep`.

## 1. Pipeline (`buildClient(srcDir, outDir)`, build.ts:63-298)

**There is NO dev/prod variant** — dev serves the byte-identical bundle (dev freshness
comes from the dormant HMR receiver, not a different build).

1. **Discover + serialize** (build.ts:77-159): walk `template.html` files.
   `assertStaticPage` (mod.ts:500) is a **no-op** — kept only so existing call sites
   still resolve. The restriction it used to enforce ("a `pages/<name>/` folder can
   never be an island") is GONE: pages and islands are unified, so a page's own
   `logic.ts` may carry a browser hook and hydrate exactly like any other island, and
   this holds for ANY `template.html` + browser-hook `logic.ts` pair under `pages/` —
   page root or nested — island classification (below) never special-cases a `pages/`
   path. `serialize(parseTemplate(...))` — the **only** place tree-sitter runs AT BUILD
   TIME (the composed monorepo's start task falls back to live-parsing with tree-sitter
   at SSR boot when `templates.json` isn't found — step 6 below — so tree-sitter is not
   build-only and must still ship in the SSR runtime). Record every template into
   `templates[relDir]`. Classification:
   - no `logic.ts` → static component, classified by `relDir`: a template under
     `pages/<page>/components/<name>/` is page-local (keyed by page→selector, `page` =
     that path's page segment, `pageLocalOf`, mod.ts:471-477); every other template is
     global (keyed by selector alone) — EXCEPT a page's own root template
     (`isPageRoot`, build.ts:618-624: `pages/<name>/` itself and any of its
     non-`components/` descendants), which is never shipped to the CLIENT static
     registry (a page isn't embedded as a child of an island; the SSR registry still
     holds it as an ordinary global component). Duplicate selectors in either class are
     **hard build errors** — but statics and islands are two SEPARATE maps here
     (`globalStatics`/`pageStatics` vs. `seen`), so `buildClient` itself never
     cross-checks a global static against an island sharing one basename (two distinct
     folders). That collision is still a hard error, just not from this step: it
     surfaces at `createRenderer` construction (dev/prod boot, before any request is
     served), whose `global`/`pageLocal` registries key statics AND islands into ONE
     map per scope and `collision()` throws regardless of which kind either side is
     (spec 02 §5) — so it can never reach a shipped build silently. Client-side, if it
     were ever reached anyway, a static wins over a same-selector island
     (`componentsForPage`, hydrate.ts:130-131).
   - `logic.ts` but server-only route logic (`onServerLoad` and neither
     `onBrowserLoad` nor `onBrowserInit` — exactly these two names count as browser
     hooks; comments stripped before the check, build.ts:58-61) → skipped (no client
     chunk).
   - else island `{sel, logic, tpl, scope: componentScopeId(relDir)}` — applies
     uniformly, including to a page's own `logic.ts` (a page with a browser hook ships
     as a global island keyed by its folder basename, same as any other); duplicate
     island selector → hard error.
2. **Generate entries** (build.ts:165-212):
   - `client.ts` (eager loader): config read, conditional `startHmr`,
     `registerIslandSelectors(selector→{scope, trigger})` for EVERY island — the
     trigger travels too, so a late-mounted shell can be stamped with the correct
     `data-trigger` before its chunk loads (the late-mount fix, spec 03 §3),
     `registerComponent`/`registerPageComponent` with baked static templates,
     `bootstrapIslands` + `setupSoftNav` on ready. Framework imports use
     module-relative URLs (works local and from JSR).
   - Per island `isl.<sel>.ts`: imports the island's `logic`;
     `__setup = logic.setup ?? makeClassSetup(logic)`;
     `registerIsland(sel, { setup, template: BAKED_AST, scope })`. The AST is ALWAYS
     baked (prod shape, dev↔prod byte-identical).
3. **Bundle** (build.ts:214-242): clean stale `.js`/`.map`; write `import-map.json`
   from `forcedImportMap`; run **`deno bundle --platform browser --minify
   --code-splitting --import-map … --outdir <out> <entries>`** (deno bundle wraps
   esbuild — not a direct esbuild call). Code splitting dedups the shared runtime into
   ONE content-hashed `chunk-<HASH>.js`.
4. **Single-core gate** (build.ts:244-251, 551-607): `assertSingleRuntime` scans
   emitted `.js` for the `__sprig_runtime` sentinel (a property access esbuild won't
   rename); >1 carrier → throw a DUAL-CORE error that names likely culprits by scanning
   the app's deno.json layers for legacy `@sprig/(core|keep)` mappings. Count 0 is
   allowed (sentinel moved = framework change).
5. **CSS** (`buildCss`, build.ts:302-391): scope every `styles.css` via
   `scopeCss(css, componentScopeId(relDir))`; add the shell stylesheet under the shell
   scope; then Tailwind v4 from a persistent cache dir OUTSIDE the repo — base
   `Deno.env.get("HOME") || Deno.env.get("TMPDIR") || "/tmp"`, then `/.cache/sprig-tailwind`
   (build.ts:323-324 — HOME is NOT assumed set; it falls back to `$TMPDIR` then `/tmp`), with
   its own deno.json pinning `@tailwindcss/cli@^4`, `tailwindcss@^4`, `daisyui@^5`. The CLI
   input is written per-build as `input-<twKey>.css`, `twKey` = a base-36 `*31` rolling hash
   of `outDir` (build.ts:328-329), so a concurrent app build + workbench build sharing this
   ONE cache dir can't clobber each other's input file (`node_modules` stays shared — the
   speed win). Input = `@import "tailwindcss"` +
   `@plugin "daisyui" { themes: false }` (**critical** — daisyUI themes would override
   app tokens) + `@source` globs — `<srcDir>/**/*.html` (every raw, pre-`scopeCss`
   `template.html`, scanned as authored source text — NOT the `scopeCss`-scoped output
   or the serialized AST) plus, only when the sibling `ui/bootstrap/template.html`
   exists, `<srcDir>/../bootstrap/**/*.html` so the shell's own markup contributes
   classes too (build.ts:346-351) — + a framework `globalReset` base layer + optional
   design tokens read by `cssFromVariables` (build.ts:479-484): PREFERRED
   `<srcDir>/../bootstrap/css-tokens.json` (i.e. `ui/bootstrap/`, beside the shell),
   else legacy `<srcDir>/css-variables.json`, else none. Schema (`CssVariables`,
   build.ts:411-417): `{ default?: string, themes: Record<name, Record<token, value>> }`
   — `default` names the theme that becomes the document baseline and is REQUIRED
   whenever more than one theme is defined (a single theme implies it as its own
   default); every key in every theme must be a custom property (`--*`) or the
   reserved `color-scheme`, anything else is a hard build error. `emitThemeCss`
   (build.ts:426-476) then routes: the DEFAULT theme's tokens split into `@theme`
   (utility-generating namespace + a static value) vs `:root` (everything else in
   the default theme); every OTHER theme's tokens emit unsplit into that theme's own
   `[data-theme="<name>"]` block — the theme's own key in `themes` IS the selector
   value, no separate mapping. "Utility-generating namespace" is one of the fixed
   `TW_THEME_NAMESPACES` prefixes (build.ts:396-401): `--color-`, `--font-`,
   `--text-`, `--font-weight-`, `--tracking-`, `--leading-`, `--spacing-`,
   `--radius-`, `--shadow-`, `--inset-shadow-`, `--drop-shadow-`, `--text-shadow-`,
   `--blur-`, `--perspective-`, `--aspect-`, `--ease-`, `--animate-`,
   `--breakpoint-`, `--container-`; a token in one of these namespaces still routes
   to `:root` (not `@theme`) when its value contains `var(...)` — it must re-resolve
   live against whatever a `[data-theme]` swap changes underneath it (`isUtilityToken`,
   build.ts:407-409). + the scoped component parts →
   `@tailwindcss/cli -i input -o <out>/app.css --minify`.
6. **templates.json** (build.ts:257-268): every component's serialized AST keyed by
   relDir + the serialized shell `<body>` under key `"shell"` — so PROD SSR renders
   prebuilt ASTs instead of running tree-sitter, PROVIDED the renderer's lookup finds
   the file (spec 02 §5: `$SPRIG_ASSETS_DIR` else `<cwd>/static` — the composed
   monorepo's git-root start task misses it and live-parses at boot).
7. **Asset copy** (build.ts:270-281): the UI package's authored `assets/` dir —
   `<srcDir>/../assets`, i.e. `ui/assets/` beside `ui/src/` (NOT per-component
   folders) — has its CONTENTS, not the `assets/` folder itself, copied verbatim into
   the ROOT of `outDir`: each file's destination is its path taken RELATIVE TO
   `assets/` (the `assets/` segment is stripped, not preserved), so
   `ui/assets/fonts/x.woff2` lands at `outDir/fonts/x.woff2` and serves at
   `<base>/_assets/fonts/x.woff2` (build.ts:274-279).
8. **Hash** (build.ts:283-297): `shortHash` over the served `.js` + `app.css` set;
   returns `{islands, chunks, out, bytes, hash}`. **No manifest file** — the SSR
   recomputes the content hash on demand (`assetsVersioner`).

**Note:** `build-info.json` is NOT emitted by `buildClient` — none of the eight steps
above touches it. It is written by a separate deploy/stamp step (outside this
pipeline) that snapshots `.infra/git.json` into `static/build-info.json` —
`{repo, commit, branch, buildTime}` — after the build completes; see §2.

### forcedImportMap (build.ts:506-548)
Reconstructs the app's effective import map (walking deno.json layers up,
nearest-wins, relative → absolute file URLs), then forces `@mrg-keystone/sprig`:
**the app's own pin wins** (dev == prod resolution), falling back to the CLI's
`../core.ts` only when the app maps nothing; `@preact/signals-core` always pinned
`npm:@preact/signals-core@^1.8.0`. Pinned by build-single-core.test.ts.

### appName (build.ts:35)
`appName(startDir)` walks up the `deno.json` layers and returns the app's identity — the
workspace-ROOT `name` (the config carrying a `workspace` array) wins over a nearer member's,
and a leading `@scope/` org prefix is stripped (`@app/alfred` → `alfred`); undefined if none is
named. It is on the public JSR surface (`build.ts` is in the root `deno.json`'s
`publish.include`, deno.json:54) yet has NO CLI/runtime caller — its only repo reference is
`compiler.test.ts` — so a refactor should treat it as an exported-but-currently-unconsumed
helper (preserve or drop).

### base-href prefixing (render-side, not build)
`applyBasePrefix` in the renderer rewrites root-relative `href`/`action` onto a
non-root base (`/runs` → `/ui/runs`); reserved surfaces (`/api`, `/docs`, `/_assets` —
the skip list at mod.ts:357; the test matrix covers the first two),
protocol-relative/absolute/`#`/already-based untouched; base `""` = no-op
(base-href-prefix.test.ts).

## 2. The artifact set (`static/`)

| artifact | contents | consumer |
|---|---|---|
| `client.js` | eager loader (config, island selector registry, baked static templates, bootstrap + soft-nav); imports the shared chunk | `<script type="module" src="<base>/_assets/client.js?v=…">` in the document tail |
| `isl.<sel>.js` | one chunk per island: shared-chunk import + logic + `registerIsland(sel, {setup, template, scope})` | dynamic-imported on the island's trigger |
| `chunk-<HASH>.js` | the shared runtime (core + signals + interpreter + hydrate), dedup'd once | imported by client.js and every isl.*.js |
| `app.css` | Tailwind v4 layers + daisyUI (themes:false) + globalReset + per-component scoped rules (`[s<hash>]` on key compounds) | `<link rel="stylesheet" href="<base>/_assets/app.css?v=…">` |
| `templates.json` | serialized ASTs keyed by relDir + `"shell"` | SSR only — never shipped to the browser |
| `build-info.json` | `{repo, commit, branch, buildTime}` provenance (from `.infra/git.json`, written by the deploy/stamp step — NOT `buildClient`, see §1) | keep's `injectHeadMeta` → `<meta name="git-*">` tags |
| `import-map.json` | the forced map fed to `deno bundle --import-map` (§1 step 3) | build-time-only — consumed by that one bundler invocation and never read again; NOT part of the checked-in `static/` set (spec 08 §5's eight committed files) |

## 3. What SSR must inject for hydration (the HTML contract)

1. Head — the runtime bits injected into WHICHEVER head is in play (app or framework
   default, mod.ts:512-520): the `app.css` link, the `client.js` modulepreload
   (`<link rel="modulepreload" href="<base>/_assets/client.js?v=…">`), and the
   vendored chart script (`<script defer src="<base>/_assets/vendor/apexcharts.js">`
   — served from keep's VENDOR map, spec 06 §6); + optional favicon/app head, + a perf
   beacon snippet BEFORE the stylesheet when enabled (`perfHeadSnippet`, perf.ts:71-81)
   — a hidden, INFRA-only feature gated by `INFRA_PERF=true` + `INFRA_PERF_URL` (optional
   `INFRA_APP_ID`; `perfConfig`, perf.ts:35-54 — not part of the app-facing config
   surface) that inlines a tiny script POSTing two fire-and-forget beacons joined by
   one random `navId`: one stamped with `performance.timeOrigin` at `<head>` execution
   (nav start), one on the window `load` event (page loaded) — payload
   `{timestamp, navId, route: location.pathname, "infra-app-id"}`, sent via
   `navigator.sendBeacon` with a `keepalive` `fetch` fallback; a SOFT navigation's pair
   is instead fired by the client runtime off `__sprig_config.perf` (item 4, below);
   + keep's `injectHeadMeta` appending `<meta name="git-*">` tags sourced from
   `build-info.json` (§2).
2. Per island: the `<sprig-island>` host with `data-sel`, `data-trigger`, and the
   `<script class="sprig-props">` JSON bridge (spec 03 §2). An optional `data-page`
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
4. Tail: `<script type="application/json" id="__sprig_config">{base, v, reserved?,
   page?, perf?, hmr?}</script>` (every `<` as the JSON escape backslash-`u003c`,
   like the props bridge — spec 02 §4) then the `client.js` module script.
   `reserved` = the same reserved-path skip list `applyBasePrefix` uses (`/api`,
   `/docs`, `/_assets` — the skip list at mod.ts:357, §1); emitted only when base is
   non-root (base `""` omits it, matching the render-side no-op); consumer: client-side
   soft-nav mirrors this list so it skips base-prefixing the same paths the server
   does. Absent → treat as an empty list (no client-side base-prefix skips).
   `page` = the matched page's folder basename, emitted only when it is a registered
   page (mod.ts `pageName`); consumer: `bootstrapIslands` stores it via
   `setCurrentPage`, soft-nav re-reads it from each fetched document
   (`pageFromConfig`), and `componentsForPage(page)` uses it to mirror the server's
   `registryForPage` (spec 03 §6). Absent → global-only child resolution.
   `perf` = `{ url, app }` (the collector endpoint + reporting app id; `PerfEndpoint`,
   hydrate.ts), emitted only under the SAME hidden INFRA gate as the head beacon
   snippet (`INFRA_PERF`/`INFRA_PERF_URL`, optional `INFRA_APP_ID`; `perfConfig`,
   perf.ts — item 1 above); consumer: `setupSoftNav`'s navigate listener reads
   `cfg.perf` and fires the same fire-and-forget beacon pair for a SOFT navigation —
   one when the navigation is intercepted (nav start), one only once the outlet swap
   commits (a fallback-to-full-navigation or an aborted intercept reports nothing, so
   it's never double-counted against the head snippet and never counted when nothing
   actually navigated). Absent → no soft-nav beacons (the feature is off end-to-end).
   `hmr` = literal `true`, emitted only when the renderer is running in dev mode
   (`sprig dev`; prod never sets it, keeping the bundle byte-identical dev↔prod per §1);
   consumer: `client.ts`'s conditional `if (cfg.hmr) startHmr(cfg.base)` — the loader
   always compiles the dormant HMR client (`hmr.ts`), but only calls `startHmr` (opening
   the `${base}/_sprig/hmr` SSE channel and arming the template/CSS/reload receiver in
   `hydrate.ts`) when this flag is present. Absent → the compiled-in HMR client stays
   dormant for the life of the page.

Naming conventions: island chunk `<base>/_assets/isl.<sel>.js?v=<v>` (sel = folder
basename); shared `chunk-<HASH>.js`; scope attr `s<8hex>` = FNV-1a of relDir (identical
across build CSS, SSR markers, and client re-render — client prefers the
build-supplied `entry.scope`, falls back to `scopeId(sel)` for older chunks);
`data-sprig-hydrated="1"`, `data-sprig-armed="1"`; event markers
`data-sprig-<event>="<space-joined idx list>"` (`<event>` = the bound DOM event name,
e.g. `data-sprig-click` — the client's delegated listener matches
`[data-sprig-${event}]`, render.ts `Handler.base`; unrelated to the URL `base` used
elsewhere in this document).

## 4. Versioning / caching contract

- `?v=` = content hash of served `.js` + `app.css` (16 hex chars via SHA-256 over
  length-framed name+content tuples), tuples fed to the hash in ASCENDING
  lexicographic order of served name (e.g. `client.js` before `isl.foo.js`) —
  build-side `shortHash` (§1.8) and SSR-side `assetsVersioner` (below) both sort the
  file set this way before hashing, so independently-computed hashes are
  byte-identical.
- `assetsVersioner` memoizes behind a stat probe (name:size:mtime) — in-place rebuilds
  picked up, stale hash never blesses changed bytes.
- Degraded (missing/empty dir) → version `"dev"`, warn-once, never `immutable`.
- keep serves `immutable` only for content-addressed requests (`?v=` equals current
  hash, or filename matches `chunk-[A-Z0-9]{8}.js`); everything else `no-cache` + ETag
  (spec 06 §5).

## 5. Refactor notes

1. The dual-core failure class is defended in three places (forced import map, build
   sentinel scan, runtime one-shot reload) — a redesign should make "exactly one
   runtime" structural rather than defended.
2. Tailwind/daisyUI emit UNSCOPED utility/component CSS from any class name in sources
   (known collision hole — see spec 10 §1.3).
3. templates.json couples build output to SSR input; it is server-only yet lives in
   the publicly-served `static/` dir (served path exists — consider relocating).
4. `deno bundle` (esbuild) flags — `--platform browser --minify --code-splitting` —
   are the whole bundler contract; no plugins.
