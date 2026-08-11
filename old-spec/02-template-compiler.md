# 02 — Template compiler: parse, expressions, SSR render, serialization, CSS scoping

> Subject: `framework/.sprig/compiler/` — the server-side half (`parse.ts`, `node.ts`,
> `expr.ts`, `render.ts`, `serialize.ts`, `scope.ts`, `mod.ts`, `hash.ts`,
> `lifecycle.ts`, `perf.ts`, `island-infer.ts`) plus the grammar in
> `tree-sitter-angular-template/`. The client half (hydrate/build/dev) is spec 03/04/05.

## 0. The framing design fact

The interpreter (`node.ts`/`expr.ts`/`render.ts`/`serialize.ts`/`scope.ts`/
`lifecycle.ts`) has **no tree-sitter import**: the identical code walks a wasm-backed
tree-sitter node on the server and a `JsonNode` (reconstructed from JSON) on the client
(node.ts:1-6). `parse.ts` is the sole static importer of `web-tree-sitter` (top-level
`import`); `mod.ts` never statically imports it but reaches it transitively via a lazy
dynamic `import()` of `parse.ts` when a live parse is needed (mod.ts:14-15). No other
module in the interpreter imports it, statically or dynamically. When the prebuilt
`templates.json` is found, prod renders serialized
ASTs and tree-sitter never loads at runtime — but the lookup can miss under the
composed monorepo layout and fall back to live parse (see §5).

## 1. Template syntax (grammar: `tree-sitter-angular-template/grammar.js`)

Top-level nodes (grammar.js:73-87): `element`, `script_element`, `style_element`,
`self_closing_element`, `erroneous_end_tag`, `text`, `interpolation`, `if_block`,
`for_block`, `switch_block`, `defer_block`, `let_declaration`.

- **Interpolation** `{{ expr }}` — HTML-escaped at render; allowed inside attribute
  values.
- **Attribute forms** (grammar.js:121-222): plain `attribute` (value may interpolate),
  `[prop]="expr"`, `(event)="stmt"` (handler = `;`-separated assignments/expressions),
  `[(twoWay)]="expr"`, `*structural="microsyntax"`, `#ref`, `let-name`. `binding_name`
  is one token supporting `@anim`, dotted (`style.width.px`, `attr.xlink:href`,
  `style.--var`), trailing `.%`.
- **Control flow**: `@if/@else if/@else` (with `; as alias`), `@for (x of coll; track t;
  let i = $index, …) {} @empty {}` (locals `$index $count $first $last $even $odd`),
  `@switch/@case/@default`, `@let name = expr;`, `@defer (…) {} @placeholder/@loading/
  @error` (triggers `idle immediate hover interaction viewport timer(ms)` + `prefetch`).
- **Components**: any non-native tag resolves through the registry; selector = folder
  basename. A `NATIVE` tag set (render.ts:131-142) always renders native (the
  web-component rule). Component-tag attrs become the child's `@inputs`
  (property bindings + two-way + literal attributes — render.ts:243-257).
- **Projection**: `<content>` (may self-close) and `<ng-content>` are aliases; `select`
  attr supports `[attr]`, `.class`, tag; default slot = unmatched nodes; slot children
  are fallback (render.ts:534-572). `<ng-container>` groups without a DOM element.
  `<router-outlet>` → `<sprig-outlet data-level=…>` wrapping `opts.outlet`.
- **Expression atoms**: identifiers, **single-quoted strings only** (double quotes in
  expressions are a deliberate grammar limitation — grammar.js:510-513), decimal/
  scientific numbers, booleans.

**Known dead syntax:** `*ngIf`/`*ngFor` structural directives and microsyntax **parse
but never execute** — no render handler; only `@`-block forms run at SSR. `[@anim]`
bindings are ignored. `@defer`'s trigger list (+ `prefetch`) and its
`@placeholder/@loading/@error` clauses are equally inert: no code on either side reads
them — the main block always renders eagerly (§4).

### Grammar packaging: why `grammar.bin` not `.wasm`

JSR/`deno publish` treats any `.wasm` as a Wasm ES module and rewrites its `env` import
to `./env` on ingest; web-tree-sitter's `Language.load` instantiates raw bytes and
throws on the rewritten form. A non-`.wasm` filename ships as opaque bytes
(parse.ts:21-27). `grammar.bin` is byte-identical to the built
`tree-sitter-angular_template.wasm` (85,949 bytes). Grammar source: `grammar.js` + a
hand-written external C scanner (`src/scanner.c`: open-tag stack, raw-text
script/style, implicit end tags — adapted from tree-sitter-html). Build:
`tree-sitter generate` → `tree-sitter build` → rename.

### parse.ts contract
- `Parser.init()` + `Language.load(bytes)` memoized; bytes read via `Deno.readFile`
  (file:) or `fetch` (served from JSR) (parse.ts:12-37).
- `parseTemplate` **throws on a dirty parse by default** (malformed template never
  ships); `{allowError:true}` for the dev-HMR reparse path. `parseCached` memoizes by
  source string.

## 2. AST + wire format

- `Node` (node.ts:5-6) is structural: `{ type, text, startIndex, endIndex,
  namedChildren, childForFieldName }` — satisfied by tree-sitter nodes AND `JsonNode`.
- `serialize.ts` wire format `SNode = { t, s, e, c: SNode[], n: named-indices[],
  f: field→child-index }`; `SerializedTemplate = { source, root }`.
  - **First-write-wins for repeated field names** (serialize.ts:36-41) to mirror
    `childForFieldName` (returns first match) — divergence would break hydration
    (pipe `argument` is a repeated field).
  - `serialize` of a `JsonNode` round-trips via `toSerialized` (a JsonNode has no
    `childCount`; re-walking would yield an empty tree — serialize-jsonnode.test.ts).
- `JsonNode` (serialize.ts:55-86) reimplements the Node API over `SNode` + source
  string. Client renders are byte-identical to server (compiler.test.ts:89-99).

## 3. expr.ts — the expression interpreter

`evalExpr(node, scope)` — pure interpreter, **no `new Function`** (expr.ts:3). Globals:
`true/false/null/undefined` only; identifier resolution scope → globals → `undefined`.

Supported: strings/numbers/booleans, parenthesized/non-null unwrap, member +
safe-member (both null-safe; `?.` ≡ `.`), subscript, calls, unary `! - +`, binary with
short-circuit `&& || ??` plus `+ - * / % == != === !== < > <= >=`, ternary, pipes,
array/object literals, arrow functions.

Contracts pinned by tests:
- **Method calls evaluate the receiver exactly once** and rebind `this` to it (incl.
  computed member `obj[key]()`); a bare identifier call naming a scope member binds
  `this = scope` (expr.ts:45-78; bugs G/P1).
- **Arrow bodies** use `Object.create(scope)` (prototype preserved so class methods
  resolve; params as own props; shared scope never mutated) (expr.ts:138-151).
- **`unquote` never throws**: `\u{…}`, `\uXXXX`, `\xNN`, named escapes via an
  `Object.create(null)` map (prototype-key guard); malformed escapes degrade to the
  literal char (a RangeError would abort the whole SSR render) (expr.ts:153-183).
- **Event statements** (`evalStatement`, client-side): child scope with `$event` as own
  prop (never leaks), assignment targets support identifier (with signal `.set()`
  detection), member, subscript (expr.ts:383-416).

**Pipes** (expr.ts:199-284): `uppercase lowercase titlecase json slice number percent
currency date keyvalue truncate i18nPlural i18nSelect`. Multi-arg via all
`pipe_argument` children. Unknown pipe → passthrough. Soundness contracts:
- `titlecase`/`truncate` iterate by code point (astral-safe; `truncate` uses `…`,
  non-positive limit = no truncation).
- `number/percent/currency` clamp DigitsInfo to Intl range; non-finite → `""`;
  `percent` scales via Intl (never `*100` float rounding).
- `date`: named styles + custom token patterns (`yyyy yy y MMMM…a`); **date-only ISO
  parsed as LOCAL midnight** (SSR-vs-client TZ drift); `yy` never emits a sign.
- `i18nPlural` never leaks "NaN" (falls to `other`).

## 4. render.ts — SSR semantics

- **Escaping**: element content escapes `& < >`; attribute values escape `& " ' < >`.
  Author `attribute_text` is trusted raw; interpolations/bound values are always escaped
  **except `[innerHTML]`**, the one deliberate raw/trusted sink (see Bindings below); a
  `preEscaped` set prevents double-escaping, and any key a property binding wrote is
  re-escaped; `class`/`style` always re-escaped (re-aggregated) (render.ts:590-644;
  bug E).
- **Entity decoding** (`decodeEntities`, render.ts:721-734): single-pass, named +
  numeric, code point bound-checked ≤ 0x10FFFF, falls back to raw match (never throw →
  never 500; bug AE). Component `@input` author text is entity-DECODED once so the
  child re-escapes exactly once (`inputText`; bug AC).
- **Bindings** (`applyBinding`, render.ts:651-692): `[innerHTML]` raw/trusted;
  `[attr.x]` dropped when null; `[class.x]`/`[class]`/`ngClass` (string/array/object);
  `[style.prop(.unit)]`/`[style]`/`ngStyle`; boolean attrs
  (`disabled checked selected readonly required hidden multiple open`) render bare when
  truthy; other props render as attribute when `!= null && !== false`.
- **Events**: dropped at SSR. In CLIENT mode (`opts.handlers` present) they become
  `data-sprig-<base>` markers with handler indices; the name splits on `.` into
  base + modifiers.
- **Control flow**: `@if` alias binds on a cloned scope; `@for` sets loop locals +
  aliases, `@empty` clause; `@switch` case-local clones; `@let` mutates the current
  scope; `@defer` renders its MAIN block eagerly in a cloned scope — on the server
  and in client re-renders alike (same interpreter, render.ts:183-186); its
  triggers/`prefetch` are never read and `@placeholder/@loading/@error` never render
  (`blockOf` picks only the first `block` child; hydrate.ts has no defer machinery —
  the source comment "client @defer triggers come with hydration" is aspirational).
  **Every view boundary clones the scope preserving the prototype**
  (`cloneScope` via `Object.getOwnPropertyDescriptors`) — `@let` never leaks
  (let-scope-leak.test.ts) and class methods survive (control-flow-proto-scope).
- **Async pre-pass** (`resolveIslands`, render.ts:447-507): awaits class-island
  `onServerInit`/`resolve` in parallel across independent subtrees (siblings
  concurrent, child after parent) into a `resolved` map keyed by instance path;
  `@let` evolves in document order (bug AG); projected islands handled (bug AF).
  (`render-async.ts` is a standalone spike — sequential/parallel/streaming strategies —
  not production.)
- **Static cache** (render.ts:376-440): memoizes SSR HTML of **pure leaf static
  components**. Module-global map (cap 10,000; clear-on-overflow). Cacheable iff no
  handlers + no projected children + no mocks + no impure descendant. Key =
  per-`ComponentDef` WeakMap token (namespaces across renderers — bug AA) + selector +
  scope + JSON(inputs) with a ` nf:` sentinel for non-finite numbers (bug Z);
  inputs containing functions/undefined are unkeyable → refuse to cache (bug AD).
  Impure = template mentions `router-outlet` OR transitively renders an island OR
  references ANY non-native child tag. `clearStaticCache()` on HMR reparse;
  `staticCacheStats(): {size, hits}` (render.ts:400) is the sibling reader over the
  same map (tests/diagnostics).
- **Island host emission** (`islandHost`, render.ts:19-29):
  `<sprig-island data-sel data-trigger>` + `<script type="application/json"
  class="sprig-props">` JSON bridge (props/snapshot); every `<` in the JSON is
  replaced with the six-character JSON escape sequence backslash-`u003c`
  (render.ts:26, `.replace(/</g, "\\u003c")`) — still valid JSON (`JSON.parse`
  restores `<`), but the bridge text can never contain a literal `</script>` to
  close its own element. Same escape in `__sprig_config` (mod.ts:561).
- **Mocks** (`RenderOpts.mocks`, render.ts:119-121): the isolate preview's
  child-component overrides, keyed by selector — `MockSpec = "stub" | { stub?: boolean;
  props?: Record<string,unknown> }`. Applied at the component call-site
  (render.ts:272-279): the string shorthand `"stub"` and the object form's `stub: true`
  select the identical stub-render behavior — the instance renders as
  `<span class="iso-stub" data-stub="<sel>">` instead of its template, and any `props`
  given alongside `stub: true` are moot (the template never renders, so the merge has no
  observable effect). Only when `stub` is `false`/absent does `{props}` take effect:
  `Object.assign` onto the computed `@inputs` before render. No other effect exists.
  Sourced from the level's `inputs.__mocks` (mod.ts:290-298) and threaded through every
  RenderOpts on BOTH sides — hydrate.ts parses `__mocks` off the props bridge and passes
  it to each client re-render (hydrate.ts:753-754, 818), and client child-island shells
  re-emit it (render.ts:297-299) so late-mounting children keep the overrides. A mocked
  island is excluded from the async pre-pass so stub/forced props apply on the sync
  scope path (render.ts:474-478); any mocks present disqualify the static cache (above).
- **Version stamping**: `?v=` = content hash of `static/` (see §6); `renderDocument`/
  `renderStream` snapshot the version BEFORE the body await (a concurrent dev rebuild
  can't mix versions in one document — bug M); env-threaded `assetsVersion` wins over
  the local hash; degraded state → constant `"dev"`, warns once, never `immutable`.

## 5. mod.ts — registry, page assembly, renderer

`createRenderer(srcDir, base="/ui", opts) → SsrRenderer { renderDocument, renderStream,
selectors, srcDir, reparse, astFor, loadResolve }` (mod.ts:23-50).

- **Discovery**: walk `srcDir` for `template.html`; folder basename = selector; relDir =
  identity. `logic.ts` presence ⇒ island. Class default export → `IslandDef` with sync
  `scope` + async `resolve` (wrapped in `withServerInjector`), `trigger`, `snapshot`,
  `serverOnly`; `{setup}` default → scope wraps setup. "Server-only" = has
  `onServerLoad` and neither `onBrowserLoad` nor `onBrowserInit` (the closed
  browser-hook set — §6) → static, no client chunk. Route hook: `onServerLoad`
  (preferred over `onServerInit` when both exist — §6) receives `RouteCtx`.
- **Two registries**: `global` (basename-keyed; **collision throws**, mod.ts:178,
  479-486) and `pageLocal` (`pages/<page>/components/<name>/` shadows same-named global
  within that page; `registryForPage` overlays). Replaced a silent last-write-wins
  clobber (static-page-local-clobber.test.ts).
- **templates.json**: build-serialized `relDir → SerializedTemplate` map, read ONCE at
  `createRenderer` boot (mod.ts:100) from `$SPRIG_ASSETS_DIR/templates.json` (the dev
  temp cache) else `<cwd>/static/templates.json`; found → prebuilt ASTs, no
  tree-sitter; absent → live parse at boot (lazy tree-sitter import). NB `serveSprig`
  does NOT thread its `assetsDir` into this lookup (it threads only the per-request
  `assetsVersion`), so under the composed monorepo's start task (cwd = git root,
  build output at `ui/static/` — spec 05 §5) the lookup MISSES and prod SSR
  live-parses at boot unless `SPRIG_ASSETS_DIR` is set. Known gap, not a guarantee.
- **Shell** (mod.ts:188-210): preferred — `<srcDir>/../bootstrap/template.html` (the
  entry-folder shell): registered under selector `"shell"`, raw `<head>` lifted
  verbatim (`splitShellHtml`) and only `<body>` parsed as a fragment, with
  `bootstrap/head.html` honored as a head fallback. Absent → the scanned
  `<srcDir>/shell/` component is the shell (what the scaffold emits — spec 05 §3):
  a body-only fragment parsed like any component — NO head split — and the document
  `<head>` is the framework DEFAULT (charset, viewport, `<title>` from route
  `meta.title` else `sprig`, optional `favicon` renderer opt; mod.ts:512-546). Both
  forms get the runtime head bits (perf snippet, `app.css` link, `client.js`
  modulepreload, vendor script) injected into whichever head is in play.
- **Assembly**: `renderLevel` (logic + outlet splice + island hosts) → `renderBody`
  nests chain inner→outer (page → layouts → shell), outlets keyed by inner load for
  soft-nav level diffing. The `chrome` 4th arg of `renderDocument`/`renderStream`
  (bootstrap passes `{ nav: buildNav(...) }` — spec 01 §4 step 9) is consumed here:
  renderBody hands it as the INPUTS of every layout level and the shell, while the
  leaf page keeps its resolved inputs (mod.ts:322-339) — a template-only layout/shell
  reads `nav` straight from scope, a layout's logic.ts via `ctx.input("nav")`; pages
  never see chrome, and no other channel carries it. `applyBasePrefix` rewrites root-relative `href`/`action` onto
  the base — only root-relative values are candidates (protocol-relative/absolute/`#`
  never match the regex), skipping `/api`, `/docs`, `/_assets`, already-based; base
  `""` = no-op (mod.ts:351-363, spec 04 §1). Streaming flushes the
  head at first byte.
- **loadResolve**: auto-import `<srcDir>/<load>/resolve.ts` (stat-first so a
  present-but-throwing module propagates — load-resolve-throw.test.ts).
- **Dev seams**: `reparse` (keyed by relDir; no-op on unchanged bytes; suppresses
  ERROR-AST swaps; clears static cache) and `astFor` (relDir → island-by-selector →
  any-by-selector — **island must win over a same-basename page**,
  ast-island-selector.test.ts).

## 6. Supporting modules

- **scope.ts (CSS view encapsulation)** — Angular-"Emulated" model, no Shadow DOM.
  `scopeId` = FNV-1a → `s`+8hex; `componentScopeId(relDir)` hashes the **folder path**
  (same-basename folders don't cross-apply). `scopeCss` walks blocks: rightmost
  compound gets `[sX]`; `:host` → bare marker; `:host(…)`/`:host-context(…)` parse into
  ancestor guards + host compounds with comma-lists **distributed** (no member leaks
  global — bug T/U); `:global(…)` unwraps unscoped; opaque at-rules
  (`keyframes font-face page property charset import namespace counter-style`) left
  untouched; conditional at-rules (`@media @supports @container @layer …`) and native
  nesting recursed; `[xlink:href]`-style inner colons not treated as pseudos (bug AI).
  Byte-pinned examples: `.a .b` → `.a .b[sX]`; `:host .x` → `[sX] .x[sX]`;
  `:host-context(.a) .x` → `.a [sX] .x[sX]`; `:global(.x) .b` → `.x .b[sX]`.
- **hash.ts** — `shortHash` = SHA-256 over length-framed (name,content) tuples → 16 hex
  chars; `versionOf(dir)` hashes served `.js` + `app.css` sorted (missing/empty →
  null = degraded); `assetsVersioner` memoizes behind a stat probe (name:size:mtime).
  No tree-sitter import (runtime can hash without the compiler).
- **lifecycle.ts** — class-island lifecycle: `onServerInit` (async, pre-render),
  `onBrowserInit`, `onServerDestroy`, `onBrowserDestroy`. ROUTE logic additionally
  names its hooks `onServerLoad`/`onBrowserLoad` — dispatched not in lifecycle.ts but
  at the call sites as `onServerLoad ?? onServerInit` (mod.ts:135,147) and
  `onBrowserLoad ?? onBrowserInit` (hydrate.ts:837): Load is preferred over the
  component-style Init when both exist. These six are the complete hook set; for
  server-only detection exactly `onBrowserLoad`/`onBrowserInit` count as "browser
  hooks" (build.ts:58-61, mod.ts:123-125 — `onBrowserDestroy` does NOT).
  `onServerDestroy` has NO production dispatch point: its only caller is lifecycle.ts's
  own standalone `renderOnServer` spike (construct → await onServerInit → view →
  snapshot → onServerDestroy, lifecycle.ts:74-84, pinned by lifecycle.test.ts) —
  mod.ts/render.ts import only `snapshotOf`, and the real render path discards server
  instances without any destroy call, so the hook is declared but inert in an app
  (wiring or dropping it is an open refactor decision). lifecycle.ts's client-side
  spike siblings `hydrateOnClient` (construct → restore → onBrowserInit,
  lifecycle.ts:90) and `destroyOnClient` (onBrowserDestroy, lifecycle.ts:102) are
  likewise exported with no production caller — hydrate.ts owns the real client
  lifecycle. `snapshotOf` captures
  serializable OWN fields, unwrapping signals; drops NaN/±Infinity, Set/Map, functions/
  symbols/undefined (dropped fields keep client constructor defaults —
  lifecycle-snapshot-lossy.test.ts). `restore` uses `.set()` for signal fields.
  Order contract: construct → restore → onBrowserInit (hydrate-restore-order.test.ts,
  bug N).
- **perf.ts** — hidden INFRA-only page-load telemetry. Enabled iff `INFRA_PERF` +
  `INFRA_PERF_URL`; any env-read failure → off (never crash SSR). Emits an inline head
  script firing two `sendBeacon` POSTs joined by a `navId`; must precede the stylesheet
  link. Soft navs report via `__sprig_config.perf`.
- **island-infer.ts** — a **prototype, NOT wired into the build** (island-infer.ts:1-8).
  Would classify island-ness syntactically (template has `(event)`/`[(…)]` or class
  has browser hooks). Shipping rule remains file presence (`logic.ts`). Adopting or
  deleting it is an open refactor decision.

## 7. Contract checklist for a refactor (each pinned by a named test)

1. Malformed template throws at build; dev HMR may parse-with-errors but never swaps an
   ERROR AST in.
2. Escaping asymmetry (author-raw / runtime-escaped) and single-decode of component
   input author text.
3. Entity decode is single-pass, bounded, non-throwing.
4. `@let`/alias/loop-local scoping is view-local; scope clones preserve prototypes.
5. Expression interpreter: single receiver eval, `this` binding rules, non-throwing
   escapes, astral-safe pipes, Intl-based numeric formatting, LOCAL-midnight date-only
   parsing.
6. Static cache: def-namespaced keys, non-finite sentinels, unkeyable refusal,
   impurity = outlet/island/non-native-child.
7. Serialization: field first-write-wins; JsonNode round-trip; client render
   byte-identical to server.
8. CSS scoping: rightmost-compound only; host/host-context distribution; `:global`
   escape; opaque at-rules; folder-path-derived scope ids stable across build/SSR/
   hydration.
9. Registry: basename collision throws; page-local shadowing; island wins selector
   ambiguity in `astFor`.
10. Version stamping: pre-await snapshot; env wins; degraded → `"dev"` + warn-once.
