## 1. Pipeline (`buildClient(srcDir, outDir)`, build.ts:63-298)

> **Byte-identity** (invariant 4 — canonical statement:
> [00-overview §6](../00-overview/06-the-invariants-that-define-the-system-full-versions-in-each-.md)):
> there is no dev/prod variant, guaranteed by three mechanisms working together —
> **(1)** a single build path: these eight steps run unchanged regardless of
> `SPRIG_DEV`, so there is no separate dev pipeline to drift from prod; **(2)** the
> template AST is ALWAYS baked into `isl.<sel>.ts` (step 2) in its prod shape, never
> a dev-only unbaked form; **(3)** dev freshness comes entirely from runtime data
> flags (`cfg.hmr`, [§3](03-3-what-ssr-must-inject-for-hydration-the-html-contract.md)
> item 4) and env (`SPRIG_DEV`, `SPRIG_ASSETS_DIR`), read by an HMR client that is
> COMPILED INTO every build but stays dormant unless `cfg.hmr` is set — dev and prod
> ship the identical bytes; only which flags are true differs.

| # | stage | input | output | notes |
|---|---|---|---|---|
| 1 | Discover + serialize (build.ts:77-159) | `template.html`/`logic.ts` walk | `templates[relDir]` + island set | classification below; one of two build-time tree-sitter sites (the other is the shell `<body>` parse in step 6) |
| 2 | Generate entries (build.ts:165-212) | island set + baked ASTs | `client.ts`, `isl.<sel>.ts` | AST always baked — byte-identity mechanism (2), above |
| 3 | Bundle (build.ts:214-242) | entries + import-map | `client.js`/`isl.*.js`/`chunk-<HASH>.js` | `deno bundle` (wraps esbuild); code-splitting dedups the shared runtime into ONE chunk |
| 4 | Single-core gate (build.ts:244-251, 551-607) | emitted `.js` | pass, or a DUAL-CORE throw | scans for the `__sprig_runtime` sentinel |
| 5 | CSS (`buildCss`, build.ts:302-391) | `styles.css` + tokens + `@source` globs | `app.css` | `scopeCss` + Tailwind v4 + daisyUI (`themes:false`); token routing detailed below |
| 6 | templates.json (build.ts:257-268) | serialized ASTs + shell `<body>` | `templates.json` | PROD SSR reads this instead of running tree-sitter |
| 7 | Asset copy (build.ts:270-281) | `ui/assets/` contents | files at `outDir` root | the `assets/` segment is stripped, not preserved |
| 8 | Hash (build.ts:283-297) | served `.js` + `app.css` set | `BuildResult`: `{islands, chunks, out, bytes, hash}` | `hash` is `shortHash(paths)`'s bare 16-hex output over that set; no manifest file — SSR recomputes on demand |

Per-step rationale:

1. **Discover + serialize** (build.ts:77-159): walk `template.html` files.
   `assertStaticPage` (mod.ts:500) is a **no-op** — kept only so existing call sites
   still resolve. The restriction it used to enforce ("a `pages/<name>/` folder can
   never be an island") is GONE: pages and islands are unified, so a page's own
   `logic.ts` may carry a browser hook and hydrate exactly like any other island, and
   this holds for ANY `template.html` + browser-hook `logic.ts` pair under `pages/` —
   page root or nested — island classification (below) never special-cases a `pages/`
   path. `serialize(parseTemplate(...))` — ONE of two places tree-sitter runs AT BUILD
   TIME (the other is the shell `<body>` parse in step 6, build.ts:262-266, which runs
   whenever `bootstrap/template.html` exists; the composed monorepo's start task falls
   back to live-parsing with tree-sitter at SSR boot when `templates.json` isn't found,
   so tree-sitter is not build-only either way and must still ship in the SSR runtime).
   Record every template into
   `templates[relDir]`. Classification (comments are stripped from `logic.ts` before the
   hook check, build.ts:58-61; exactly `onBrowserLoad`/`onBrowserInit` count as browser
   hooks):

   | has `logic.ts`? | hook shape | relDir shape → classification | key | shipped to the CLIENT registry? |
   |---|---|---|---|---|
   | No | — | `pages/<page>/components/<name>/` → page-local static | page→selector (`pageLocalOf`, mod.ts:471-477) | Yes |
   | No | — | `pages/<name>/` itself, or a non-`components/` descendant of it (`isPageRoot`, build.ts:618-624) → page-root static | selector (global class) | **No** — never shipped to the client static registry (a page isn't embedded as a child of an island; the SSR registry still holds it as an ordinary global component) |
   | No | — | anything else → global static | selector alone | Yes |
   | Yes | `onServerLoad` present, no browser hook → server-only route logic | any | — | No — skipped, no client chunk at all |
   | Yes | a browser hook present, `onServerLoad` or not | any, including a page's own root — island classification never special-cases a `pages/` path | selector = folder basename; scope = `componentScopeId(relDir)` | Yes — ships as an island `{sel, logic, tpl, scope}` |
   | Yes | neither `onServerLoad` nor a browser hook (a fully hookless `logic.ts`) | any, including a page's own root | selector = folder basename; scope = `componentScopeId(relDir)` | Yes — ships as an island `{sel, logic, tpl, scope}` — `isServerOnlyRouteLogic` (build.ts:58-61) only skips the `onServerLoad`-only shape above; a hookless `logic.ts` is NOT skipped |

   Duplicate selectors are **hard build errors** within either static class and within
   the island set — but statics and islands are two SEPARATE maps here
   (`globalStatics`/`pageStatics` vs. `seen`), so `buildClient` itself never
   cross-checks a global static against an island sharing one basename (two distinct
   folders); that collision is still a hard error, just not from this step (failure
   taxonomy below). Client-side, if it were ever reached anyway, a static wins over a
   same-selector island (`componentsForPage`, hydrate.ts:130-131).
2. **Generate entries** (build.ts:165-212):
   - `client.ts` (eager loader): config read, `if (cfg.hmr) startHmr(cfg.base)`
     (`enableHmr()` runs INSIDE `startHmr`, not called directly by the loader),
     `registerIslandSelectors(selector→scope)` for EVERY island — the registry value
     is the scope marker STRING, not a `{scope, trigger}` pair (island objects carry no
     `trigger` field, build.ts:81/:158). A late-mounted shell's `data-trigger` is read
     from the LIVE host via `islandTrigger` instead, never from this registry (the
     late-mount fix, spec 03 [§3](../03-islands-and-hydration/03-3-client-boot-trigger-arming.md)) —
     it's what lets a parent island's client re-render still resolve a child island
     whose chunk hasn't loaded yet to a proper `<sprig-island>` shell,
     `registerComponent`/`registerPageComponent` with baked static templates,
     `bootstrapIslands` + `setupSoftNav` on ready. Framework imports use
     module-relative URLs (works local and from JSR).
   - Per island `isl.<sel>.ts`: imports the island's `logic`;
     `__setup = logic.setup ?? makeClassSetup(logic)`;
     `registerIsland(sel, { setup, template: BAKED_AST, scope })`. The AST is ALWAYS
     baked — byte-identity mechanism (2), above.
3. **Bundle** (build.ts:214-242): clean stale `.js`/`.map`; write `import-map.json`
   from `forcedImportMap`; run **`deno bundle --platform browser --minify
   --code-splitting --import-map … --outdir <out> <entries>`** (deno bundle wraps
   esbuild — not a direct esbuild call). Code splitting dedups the shared runtime into
   ONE content-hashed `chunk-<HASH>.js`.
4. **Single-core gate** (build.ts:244-251, 551-607): `assertSingleRuntime` scans
   emitted `.js` for the `__sprig_runtime` sentinel (a property access esbuild won't
   rename). Count 0 is allowed (sentinel moved = framework change); >1 carrier is a
   hard build error (failure taxonomy below).
5. **CSS** (`buildCss`, build.ts:302-391): scope every `styles.css` via
   `scopeCss(css, componentScopeId(relDir))`; add the shell stylesheet under the shell
   scope; then run Tailwind v4 from a persistent cache dir OUTSIDE the repo — base
   `Deno.env.get("HOME") || Deno.env.get("TMPDIR") || "/tmp"`, then `/.cache/sprig-tailwind`
   (build.ts:323-324 — HOME is NOT assumed set; it falls back to `$TMPDIR` then `/tmp`), with
   its own deno.json pinning `@tailwindcss/cli@^4`, `tailwindcss@^4`, `daisyui@^5`. The CLI
   input is written per-build as `input-<twKey>.css`, `twKey` = a base-36 `*31` rolling hash
   of `outDir` (build.ts:328-329), so a concurrent app build + workbench build sharing this
   ONE cache dir can't clobber each other's input file (`node_modules` stays shared — the
   speed win).

   **`@source` glob set** — which `template.html` files Tailwind scans for utility
   classes, always the raw, pre-`scopeCss` authored source text, NEVER the
   `scopeCss`-scoped output or the serialized AST:

   | glob | included when |
   |---|---|
   | `<srcDir>/**/*.html` | always |
   | `<srcDir>/../bootstrap/**/*.html` | only when the sibling `ui/bootstrap/template.html` exists (build.ts:346-351) — so the shell's own markup contributes classes too |

   **Token-source precedence** (`cssFromVariables`, build.ts:479-484) — the first path
   that exists wins, opt-in overall:

   | order | source | notes |
   |---|---|---|
   | 1 | `<srcDir>/../bootstrap/css-tokens.json` | preferred — tokens live beside the shell (`ui/bootstrap/`) |
   | 2 | `<srcDir>/css-variables.json` | legacy fallback, kept for byte-identical builds of existing apps |
   | 3 | none | opt-in feature — no file present means no token CSS is emitted, build unchanged |

   Schema (`CssVariables`, build.ts:411-417): `{ default?: string, themes: Record<name, Record<token, value>> }`
   — `default` names the theme that becomes the document baseline and is REQUIRED
   whenever more than one theme is defined (a single theme implies it as its own
   default); every key in every theme must be a custom property (`--*`) or the
   reserved `color-scheme` — either violation is a hard build error (failure taxonomy
   below).

   **Input composition** — the CLI input file (`input-<twKey>.css`) is exactly, in order:

   | part | content |
   |---|---|
   | 1 | `@import "tailwindcss";` |
   | 2 | `@plugin "daisyui" { themes: false; }` — **critical**: daisyUI themes would override app tokens |
   | 3 | the `@source` glob set, above |
   | 4 | a framework `globalReset` base layer |
   | 5 | the token CSS, if any, routed by `emitThemeCss` (token-routing table below) |
   | 6 | every component's `scopeCss`-scoped parts (including the shell's own stylesheet) |

   `@tailwindcss/cli -i input -o <out>/app.css --minify` compiles that file to `app.css`.
6. **templates.json** (build.ts:257-268): every component's serialized AST keyed by
   relDir + the serialized shell `<body>` under key `"shell"` — the shell body is parsed
   HERE, when `bootstrap/template.html` exists (build.ts:262-266), the second build-time
   tree-sitter site named in step 1 above — so PROD SSR renders prebuilt ASTs instead of
   running tree-sitter, PROVIDED the renderer's lookup finds the file ([§5](05-5-refactor-notes.md): `$SPRIG_ASSETS_DIR` else `<cwd>/static` — the composed
   monorepo's git-root start task misses it and live-parses at boot).
7. **Asset copy** (build.ts:270-281): the UI package's authored `assets/` dir —
   `<srcDir>/../assets`, i.e. `ui/assets/` beside `ui/src/` (NOT per-component
   folders) — has its CONTENTS, not the `assets/` folder itself, copied verbatim into
   the ROOT of `outDir`: each file's destination is its path taken RELATIVE TO
   `assets/` (the `assets/` segment is stripped, not preserved), so
   `ui/assets/fonts/x.woff2` lands at `outDir/fonts/x.woff2` and serves at
   `<base>/_assets/fonts/x.woff2` (build.ts:274-279).
8. **Hash** (build.ts:283-297): `shortHash(paths)` runs over the served `.js` +
   `app.css` set and returns the bare 16-hex hash string. `buildClient` itself
   returns that string as the `hash` field of its own result, `BuildResult`:
   `{islands, chunks, out, bytes, hash}`. **No manifest file** — the SSR
   recomputes the content hash on demand (`assetsVersioner`, the SSR-side
   counterpart built on the same `shortHash`/`versionOf` primitives, [§4](04-4-versioning-caching-contract.md)).

### Build correctness (acceptance criteria)

A build produced by `buildClient` is correct — every downstream contract this doc and
its siblings depend on holds — exactly when all four of these pass. Each is defined
elsewhere in this pipeline or delegated to the spec that owns it; this table is the one
place that collects the pass/fail verdict, not a restatement of the mechanism:

| # | criterion | statement | verified by |
|---|---|---|---|
| 1 | Byte-identity | dev bundle === prod bundle, byte-for-byte — one build path (no dev/prod variant), AST always baked, dev freshness carried entirely by runtime flags, not by different bytes | invariant 4, above |
| 2 | Single-core count | the emitted `.js` set carries 0-or-1 `__sprig_runtime` carriers | step 4 (single-core gate) — 0 or 1 both pass; >1 is a hard build error (taxonomy below) |
| 3 | Output-set closure | every file `buildClient` writes under `outDir` is accounted for in the artifact catalog's closed set — nothing outside it | delegated to [§2](02-2-the-artifact-set-static.md) |
| 4 | Hash agreement | the build-side `shortHash` (step 8) and the SSR-side `assetsVersioner` recompute equal, byte-for-byte, over the same served `.js` + `app.css` set | delegated to [§4](04-4-versioning-caching-contract.md) |

A build that fails any of these is not shipped — the corresponding row in the
build-failure taxonomy below names the concrete error each criterion's violation raises.

### Build-failure taxonomy

| condition | error | surfaces at |
|---|---|---|
| Duplicate static selector within one class (global or page-local) in step 1 | hard build error | build-time, step 1 |
| Duplicate island selector in step 1 | hard build error | build-time, step 1 |
| A global static and an island share one basename (two distinct folders) — `globalStatics`/`pageStatics` and `seen` are separate maps and never cross-check each other | `collision()` throws — the renderer's `global`/`pageLocal` registries key statics AND islands into ONE map per scope and throw regardless of which kind either side is (spec 02 [§6](../02-template-compiler/06-5-mod-ts-registry-page-assembly-renderer.md)) | boot-time, `createRenderer` construction (dev/prod boot, before any request is served) |
| >1 emitted `.js` carries the `__sprig_runtime` sentinel | DUAL-CORE error naming likely culprits (scans the app's deno.json layers for legacy `@sprig/(core\|keep)` mappings) | build-time, step 4 (single-core gate) |
| `CssVariables` schema violation — `default` missing when >1 theme is defined, or a token key that isn't a custom property (`--*`) or the reserved `color-scheme` | hard build error | build-time, step 5 (CSS) |

### CSS token routing (`emitThemeCss`, build.ts:426-476)

Every token in the parsed `CssVariables` (step 5) routes to exactly one destination
block:

| token shape | destination |
|---|---|
| DEFAULT theme, key in a `TW_THEME_NAMESPACES` prefix, value has no `var(...)` | `@theme` (utility-generating) |
| DEFAULT theme, key in a `TW_THEME_NAMESPACES` prefix, value contains `var(...)` | `:root` — a utility-generating value that references another token must still re-resolve live against whatever a `[data-theme]` swap changes underneath it (`isUtilityToken`, build.ts:407-409) |
| DEFAULT theme, key NOT in a `TW_THEME_NAMESPACES` prefix | `:root` |
| any OTHER (non-default) theme's tokens | that theme's own `[data-theme="<name>"]` block, unsplit — the theme's own key in `themes` IS the selector value, no separate mapping |

`TW_THEME_NAMESPACES` (build.ts:396-401) is the fixed set of utility-generating
prefixes: `--color-`, `--font-`, `--text-`, `--font-weight-`, `--tracking-`,
`--leading-`, `--spacing-`, `--radius-`, `--shadow-`, `--inset-shadow-`,
`--drop-shadow-`, `--text-shadow-`, `--blur-`, `--perspective-`, `--aspect-`,
`--ease-`, `--animate-`, `--breakpoint-`, `--container-`.

### Worked examples

**Island.** `pages/home/components/counter/` (a `template.html` plus a `logic.ts` exporting
`onBrowserLoad`) through the steps relevant to one component:

1. Discover + serialize: `relDir = "pages/home/components/counter"` is recorded into
   `templates[relDir]`. `logic.ts` carries a browser hook, so it classifies as an
   island (step 1's decision table, browser-hook row): `{sel: "counter", logic, tpl, scope:
   componentScopeId(relDir)}` — `scope` is `s<8hex>`, the FNV-1a hash of `relDir`
   (naming convention, [§3](03-3-what-ssr-must-inject-for-hydration-the-html-contract.md)).
2. Generate entries: `client.ts` registers the selector
   (`registerIslandSelectors({counter: scope})` — the scope marker string only, no
   trigger); `isl.counter.ts` imports
   `logic`, sets `__setup = logic.setup ?? makeClassSetup(logic)`, and emits
   `registerIsland("counter", { setup: __setup, template: BAKED_AST, scope })` — the
   AST is baked, per byte-identity mechanism (2) above.
3. Bundle: `deno bundle` emits `isl.counter.js`, which imports the shared
   `chunk-<HASH>.js` for the deduped runtime rather than inlining it.
5. CSS: `counter/styles.css` scopes to `[s<8hex>]` (that same scope id) and its rules
   land in `app.css` alongside every other component's scoped rules.
6. templates.json: the identical serialized AST from step 1 is keyed by `relDir`
   (`"pages/home/components/counter"`), so PROD SSR renders it without running
   tree-sitter.

**Page-root static.** `pages/about/` (a `template.html` with no `logic.ts` — an
ordinary static page, no hooks to classify) through the steps relevant to a page root:

1. Discover + serialize: `relDir = "pages/about"` is recorded into `templates[relDir]`
   regardless of classification. No `logic.ts` → the static branch; `isPageRoot("pages/about")`
   is true (step 1's decision table, row 2), so it is a page-root static: excluded from
   `globalStatics`/`pageStatics` — the SSR registry still holds it as an ordinary global
   component (the parenthetical on that row), but it never enters either client-registry map.
2. Generate entries: the `registerComponent`/`registerPageComponent` loops over
   `globalStatics`/`pageStatics` never see `"about"` (excluded in step 1), so `client.ts`
   emits no registration for it; no `isl.about.ts` is generated either (classification never
   reached the island branch — there's no `logic.ts`).
3. Bundle: no `isl.about.js` chunk is emitted; `"about"` contributes zero bytes to the JS
   output.
6. templates.json: `templates["pages/about"]` still holds the serialized AST from step 1,
   so PROD SSR renders the page from the prebuilt AST — never shipped to the client static
   registry, never a client chunk, but never missing from the SSR side either.

**Note:** `build-info.json` is NOT emitted by `buildClient` — none of the eight steps
above touches it. It is written by a separate deploy/stamp step (outside this
pipeline) that snapshots `.infra/git.json` into `static/build-info.json` —
`{repo, commit, branch, buildTime}` — after the build completes; see [§2](02-2-the-artifact-set-static.md).

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
named. It is NOT on the importable JSR surface — the package's three export-map entries
are exactly `.`/`./keep`/`./cli` (spec 01 [§1](../01-core-runtime/01-1-public-api-surface-all-of-mrg-keystone-sprig.md)),
and `build.ts` isn't one of them; it ships only as `publish.include` BYTES
(deno.json:54) — reachable so the CLI can run it, not importable by an app. Spec 01 §1
classifies `appName` there as [Internal-but-must-survive](../01-core-runtime/01-1-public-api-surface-all-of-mrg-keystone-sprig.md#internal-but-must-survive),
alongside `buildClient` and `parseTemplate` — CLI-only, per `packages/keep/mod.ts`'s own
comment that the compiler's build/parse tooling "is CLI-only and is NOT re-exported." It
has NO CLI/runtime caller today — its only repo reference is `compiler.test.ts` — but
Internal-but-must-survive means a refactor may rename or restructure it, not drop it: it
must keep working under some name.

### base-href prefixing (render-side, not build)
`applyBasePrefix` in the renderer rewrites root-relative `href`/`action` onto a
non-root base (`/runs` → `/ui/runs`); reserved surfaces (`/api`, `/docs`, `/_assets` —
the skip list at mod.ts:357; the test matrix covers the first two),
protocol-relative/absolute/`#`/already-based untouched; base `""` = no-op
(base-href-prefix.test.ts).

