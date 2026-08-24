## 5. mod.ts — registry, page assembly, renderer

`createRenderer(srcDir, base="/ui", opts) → Promise<SsrRenderer { renderDocument,
renderStream, selectors, srcDir, reparse, astFor, loadResolve }>` (mod.ts:23-50, 68-72) —
**async**: it awaits a filesystem walk, `readTextFile`, and a dynamic `import()` of
every `logic.ts`, so every caller must `await createRenderer(...)`.

- **Discovery**: walk `srcDir` for `template.html`; folder basename = selector; relDir =
  identity. `logic.ts` presence ⇒ island. Class default export → `IslandDef` with sync
  `scope` + async `resolve` (wrapped in `withServerInjector`), `trigger`, `snapshot`,
  `serverOnly`; `{setup}` default → scope wraps setup. "Server-only" = has
  `onServerLoad` and neither `onBrowserLoad` nor `onBrowserInit` (the closed
  browser-hook set — [§6](07-6-supporting-modules.md)) → static, no client chunk. Route hook: `onServerLoad`
  (preferred over `onServerInit` when both exist — [§6](07-6-supporting-modules.md)) receives `RouteCtx`.
- **Two registries**: `global` (basename-keyed; **collision throws**, mod.ts:178,
  479-486) and `pageLocal` (`pages/<page>/components/<name>/` shadows same-named global
  within that page; `registryForPage` overlays). `pageLocal` **also collision-throws**:
  two page-local components sharing one basename under the SAME page throw too
  (mod.ts:172-174) — it shadows global, it does not last-write-wins against its own
  page (04 §1's build-failure taxonomy: "duplicate static selector within one class,
  global OR page-local, is a hard build error"). This server-side collision-throw
  (both the global and the intra-page page-local case) is **unpinned**: source-only at
  mod.ts:172-174, 178, 479-486, no dedicated regression test covers it, so a refactor
  could silently drop it back to last-write-wins without any test catching the
  regression. Do not confuse this with `static-page-local-clobber.test.ts`, which pins a
  different contract in a different subsystem — the CLIENT-side page-aware static
  resolution (page-local vs. global resolved per-page on the client after hydration,
  no silent last-write-wins there either) covered by spec 03
  [§6](../03-islands-and-hydration/06-6-nested-islands-the-zz-contracts.md)'s `resolve`
  precedence.
- **templates.json**: build-serialized `relDir → SerializedTemplate` map, read ONCE at
  `createRenderer` boot (mod.ts:100) from `$SPRIG_ASSETS_DIR/templates.json` (the dev
  temp cache) else `<cwd>/static/templates.json`; found → prebuilt ASTs, no
  tree-sitter; absent → live parse at boot (lazy tree-sitter import). NB `serveSprig`
  does NOT thread its `assetsDir` into this lookup (it threads only the per-request
  `assetsVersion`), so under the composed monorepo's start task (cwd = git root,
  build output at `ui/static/` — spec 05 §5) the lookup MISSES and prod SSR
  live-parses at boot unless `SPRIG_ASSETS_DIR` is set. Known gap, not a guarantee.
- **Shell** (mod.ts:188-210):

  | form | trigger | registered selector | head source | head split? | body parsing |
  | --- | --- | --- | --- | --- | --- |
  | preferred: `bootstrap/template.html` | `<srcDir>/../bootstrap/template.html` exists | the shell selector (`"shell"`, or `opts.shell`) | raw `<head>` lifted verbatim via `splitShellHtml`; `bootstrap/head.html` honored as a fallback when the file has no `<head>` | yes — head lifted out, never parsed | only `<body>` parsed as a fragment |
  | fallback: scanned `shell/` | `bootstrap/template.html` absent | the shell selector, backed by the scanned `<srcDir>/shell/` component (what the scaffold emits — spec 05 [§3](../05-cli-dev-hmr/03-3-sprig-init-the-scaffold-contract.md)) | framework DEFAULT: charset, viewport, `<title>` from route `meta.title` else `sprig`, optional `favicon` renderer opt (mod.ts:512-546) | no — NO head split | the whole file is a body-only fragment, parsed like any component |

  Both forms get the runtime head bits (perf snippet, `app.css` link, `client.js`
  modulepreload, vendor script) injected into whichever head is in play.
- **Assembly**: `renderLevel` (logic + outlet splice + island hosts) → `renderBody`
  nests chain inner→outer (page → layouts → shell), outlets keyed by inner load for
  soft-nav level diffing. The `chrome` 4th arg of `renderDocument`/`renderStream`
  (bootstrap passes `{ nav: buildNav(...) }` — spec 01 [§4](../01-core-runtime/04-4-bootstrap-request-pipeline-core-ts-709-850.md) step 9) is consumed here:
  renderBody hands it as the INPUTS of every layout level and the shell, while the
  leaf page keeps its resolved inputs (mod.ts:322-339) — a template-only layout/shell
  reads `nav` straight from scope, a layout's logic.ts via `ctx.input("nav")`; pages
  never see chrome, and no other channel carries it.
  - **Trace** — a matched chain `pages/home` inside layout `routers/app` inside the
    shell (`chain = [{load: "routers/app"}, {load: "pages/home"}]`, outer→inner per
    the chain, rendered inner→outer):
    1. `renderLevel("pages/home", inputs, registryForPage("home"))` — no `outlet`, no
       `outletKey` (the leaf nests nothing); `inputs` is the page's own resolved
       data, never `chrome`.
    2. `renderLevel("routers/app", chromeInputs, registry, outlet=<page html>,
       outletKey="pages/home")` — the layout's INPUTS are `chrome` (`nav`), not the
       page's data; its `<sprig-outlet data-level="pages/home">` carries the page's
       rendered html.
    3. `renderLevel("shell", chromeInputs, registry, outlet=<layout html>,
       outletKey="routers/app")` — the shell also receives `chrome` as its inputs;
       its `<sprig-outlet data-level="routers/app">` wraps the layout, which already
       has the page nested inside it.

    Final document nesting: shell (outermost) ⊃ `routers/app` layout ⊃ `pages/home`
    (innermost, leaf content).
  - `applyBasePrefix` rewrites root-relative `href`/`action` onto the base. Matched
    (rewritten): `/products` → `${base}/products`, `/products?x=1` →
    `${base}/products?x=1`. Not matched (left untouched): `//cdn.example` and
    `https://…` (protocol-relative/absolute never match the root-relative regex),
    `#frag` (fragment, same reason), `/api/…`, `/docs/…`, `/_assets/…` (the reserved
    off-base surfaces), an already-based `/ui/…` (already sits on the base). `base ==
    ""` is a global no-op — the whole pass is skipped (mod.ts:351-363, spec 04
    [§1](../04-build-pipeline-and-artifacts/01-1-pipeline-buildclient-srcdir-outdir-build-ts-63-298.md)).
  - Streaming flushes the head at first byte.
- **loadResolve**: auto-import `<srcDir>/<load>/resolve.ts` (stat-first so a
  present-but-throwing module propagates — load-resolve-throw.test.ts).
- **Dev seams**: `reparse` (keyed by relDir; no-op on unchanged bytes; suppresses
  ERROR-AST swaps; clears static cache) and `astFor` (relDir → island-by-selector →
  any-by-selector — **island must win over a same-basename page**,
  ast-island-selector.test.ts).

