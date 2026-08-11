# 03 — Islands and the client runtime (hydrate.ts)

> Subject: `framework/.sprig/compiler/hydrate.ts` (~54KB, the client runtime),
> `island.ts`, `island-infer.ts`, and the SSR-side island emission in
> `render.ts`/`mod.ts`. Pinned by the `zz-nested-island-*`, `hydrate-*`,
> `event-delegation`, `soft-nav-*`, and `island-*-scope` tests.

## 1. The island model

**Rule (enforced identically in two places that must agree):** a component folder with a
`template.html` AND a sibling `logic.ts` is an island — mod.ts:108-162 (SSR) and
build.ts:106-158 (build). `island-infer.ts` (syntactic inference) is a prototype, NOT
wired in; adopting or deleting it is an open decision.

`IslandDef` (render.ts:41-58):
- `scope(inputs, reqCtx?)` — sync scope builder (fallback path).
- `trigger` — `"load" | "visible" | "idle" | "interaction"`.
- `snapshot?` — class components serialize post-`onServerInit` state into the props
  bridge.
- `serverOnly?` — route logic with `onServerLoad` and no browser hooks: runs at SSR for
  data, renders static, NO hydration boundary, no client chunk.
- `resolve?(inputs, reqCtx?)` — async: instantiate + await `onServerInit`; used by the
  parallel pre-pass.

Construction from `logic.ts` (mod.ts:111-161): class default export → full IslandDef
(trigger = static class field, **defaulting to `"load"` when the field is absent**;
snapshot = !serverOnly); `{setup}` object → scope wraps setup, **trigger likewise
defaults to `"load"`** (no static field to read at all — same default as
`defineComponent`'s bare-fn form, spec 01 §1) — no snapshot/resolve. Every `IslandDef`
therefore has a concrete trigger by construction; `data-trigger` is never emitted as
`"undefined"`.

**Injector wiring** (island.ts): `withServerInjector(fn)` runs setup/constructor/
onServerInit inside `new Injector("server","root").child("component")` (without it every
`inject()` in an island throws → HTTP 500). That root is FRESH — not the request
injector — so request-root bindings are invisible: `inject(Backend)` in an island
server hook throws the unbound-factory error; request data reaches islands as inputs,
and only a page's `resolve.ts`/guards run in the request route injector (spec 01
§2/§4). `makeServerCtx(inputs)` provides
`input`/`model` (signals seeded from inputs) and `output` (emit wrapper). Client twin:
`makeClassSetup(Cls)` constructs inside `clientRoot()`; `clientCtx(inputs)` seeds signals
from parsed props — **client `output()` is a no-op stub ("cross-island outputs: future
work", hydrate.ts:1020-1022)**.

## 2. The SSR → client props contract

SSR emits (islandHost, render.ts:19-29):

```html
<sprig-island {scopeAttr} data-sel="<sel>" data-trigger="<trigger>">
  <script type="application/json" class="sprig-props">{...inputs, __mocks, __snapshot}</script>
  ...server-rendered inner HTML...
</sprig-island>
```

`{scopeAttr}` is the island's own view-encapsulation marker: a bare, valueless
attribute whose name is the component's scope-id token (`scope.ts`'s
`componentScopeId(relDir)`, e.g. `s3f2a91c4` — FNV-1a of the component's folder
path; falls back to `scopeId(selector)` when a def carries no folder path,
render.ts:260). It is the SAME marker every native element inside the island's
own template carries, and the same token the build rewrites the island's
`styles.css` key compounds to require (`[s3f2a91c4]`) — so the host element
itself falls under its own component's scoped CSS. It plays no matching role
downstream in hydration (unlike `data-sel`/`data-trigger`, §5/§7); it is pure
CSS-scoping plumbing.

In the props JSON every `<` is the JSON escape sequence backslash-`u003c` (spec 02 §4
— `JSON.parse` restores `<`; the text can never close the `<script>` element). Client
parses the bridge BEFORE marking hydrated (parse failure leaves the host retry-able,
hydrate.ts:747-755). `__snapshot` is applied via
`restore()` after `setup()` but before first render. `__mocks` is the preview
child-component override map (stub / force-props — full render semantics in spec 02
§4): parsed off the bridge (hydrate.ts:753-754) and threaded into every client
re-render of this island.

## 3. Client boot + trigger arming

Generated `client.js` (build.ts:166-197): read `#__sprig_config` JSON → optional
`enableHmr()` call (§9; this is the boot-sequence invocation, run before hydration
begins) → `registerIslandSelectors(selector→descriptor)` populates the
`islandSelectorScopes` boot registry with one entry per island — each entry holds at
least the island's `trigger` (this is neither `IslandDef.scope`, the server-only sync
builder from §1, nor the runtime `el.__sprigScope` stashed per-instance in §4/§9, which
doesn't exist until an instance hydrates) — so every island's selector AND trigger are
known before its chunk loads: the late-mount fix, since a late-mounted shell (§6) is
stamped with the correct `data-trigger` from this registry and armed by
`rescanIslands` without waiting for the chunk → register baked static component
templates → `bootstrapIslands(cfg)` + `setupSoftNav(cfg)` on DOMContentLoaded.

`bootstrapIslands` scans `document.querySelectorAll("sprig-island")` once and arms each
via `scheduleLoad` (hydrate.ts:435-477):
- `visible` → IntersectionObserver; `idle` → requestIdleCallback (200ms setTimeout
  fallback); `interaction` → one-shot pointerover+focusin; `load` → immediately.
- Armed non-load triggers register cancellers so outlet swaps can cancel them.
- `rescanIslands(el)` runs after every island effect render, arming hosts that appeared
  post-bootstrap; idempotent (skips `data-sprig-armed`/`data-sprig-hydrated`).

Chunk load: `import("<base>/_assets/isl.<sel>.js?v=<v>")`; each chunk self-registers via
`registerIsland(sel, entry)` → `hydratePending(sel)` hydrates every
`sprig-island[data-sel]:not([data-sprig-hydrated])`, each instance isolated in try/catch.
The exported module-level `loading` set (`export const loading = new Set<string>()`,
hydrate.ts:201) tracks selectors whose chunk `import()` is in flight — a de-dupe guard
against concurrent triggers, and an exported introspection surface.

The island triggers above are the client runtime's ONLY lazy-load machinery — there is
no `@defer` handling anywhere in hydrate.ts: a template `@defer` block renders its main
block eagerly via the shared interpreter, its triggers/clauses inert (spec 02 §1/§4).

## 4. Hydration order (pinned by hydrate-restore-order.test.ts)

Per island instance: (1) `scope = entry.setup(clientCtx(inputs))` → (2) apply
`__snapshot` via `restore()` → (3) **synchronous `restoreState()`** (persisted
StateService values visible on FIRST paint — the constructor's queueMicrotask restore
would land after paint; bug N) → (4) first `effect` render → (5)
`onBrowserLoad ?? onBrowserInit`. Teardown folds `onBrowserDestroy` in; bookkeeping
(`mounted`, `armed`, `islandMounts`) is pruned by `teardownInside(root)` before outlet
swaps. Scope is stashed on the node as `el.__sprigScope`; `onIslandMounted(cb)` replays
mounts for external tooling (the isolate preview harness).

## 5. Reactive update model

One `effect()` per island (hydrate.ts:815-827): any signal write re-renders the **whole
island subtree** to an HTML string via the shared interpreter (`renderNodes` over the
JSON AST — same code as SSR), then morphs it in:
- `morphChildren` — position-keyed node reuse (no vdom): reuse when tag matches, else
  replace; **island hosts and `<sprig-outlet>`s are "pinned"** in a pre-pass and left
  entirely untouched — island hosts matched by their `data-sel` key (§2), outlets
  matched by their `data-level` key (the same per-position `load` identifier — spec 04
  §3 item 3 — that §7's soft-nav walk uses to pair outlet chains).
- `morphNode` — in-place attribute add/update/remove, text/comment `nodeValue` sync,
  child recursion; outlets opaque.
- Focus/caret/selection/scroll of unchanged elements preserved. No keyed list
  reconciliation beyond position + pinning.

**Event delegation:** one delegated listener per distinct event base on the island root,
(re)wired each render. Dispatch: `ev.target.closest("[data-sprig-<base>]")` → marker is
a space-joined handler-index list → `resolveHandlers` returns EVERY matching handler
(addEventListener semantics — bug A) filtered by chord modifiers
(`keyup.control.enter`; KEY_ALIAS/MOD_FLAG tables); submit handlers preventDefault.
`evalStatement(handler, scope, ev)` executes.

## 6. Nested islands (the zz-* contracts)

Core invariant: **a parent island's re-render must never destroy a live hydrated child
island.**
- `componentsForPage` resolves children by (page, selector): page-local static → global
  static → loaded island → **known-but-unloaded island** via `islandSelectorScopes`
  (the §3 boot registry; its `trigger` entry is what lets the shell below carry the
  correct `data-trigger`) (bug AJ fix — islands used to fall through to inert bare
  custom elements).
- Client-mode re-render emits an island **shell** (empty body, parent-computed inputs as
  props) — the morph pins it to the live host; a genuinely-new data-driven child
  hydrates from those props (late-mount, via `rescanIslands`).
- Props-bridge and blank-text nodes are filtered at host level before positional
  alignment (index-skew bug B3).
- Known limitation (unchanged): morph PINS live child hosts, so data-driven REMOVAL of a
  nested island leaves the stale child in the DOM.

Multi-instance async resolution: the SSR `resolved` map is keyed by **instance path**
(`rkey = path + "/" + node.startIndex`), not bare AST node — two wrappers around one
island don't leak each other's scope/snapshot (bug AB).

## 7. Soft navigation (hydrate.ts:500-727)

Requires the Navigation API (`globalThis.navigation`); otherwise normal browser nav.
`pagehide → persistState()` always registered.

- **Skip (let the browser handle)** when: not interceptable / hash-only / download /
  form POST / reload / URL parse failure / cross-origin / out-of-base /
  **reserved prefix** (`cfg.reserved` — `/api`, `/docs`, `/_assets`, the same
  reserved-path skip list `applyBasePrefix` uses server-side, spec 04 §1/§3 item 4 —
  boundary-respecting: `/apixyz` is not under `/api`; absent — emitted only when base
  is non-root — treat as an empty list, no client-side skips) / same-path query-only.
- **Commit test:** response must be `ok && !redirected && text/html`
  (`softNavResponseOk`, hydrate.ts:563-567). EVERY failed leg — non-ok (a 404/500
  SSR error page is text/html but `!ok`), redirected, or non-HTML content-type —
  and a fetch/transport failure all take the SAME path:
  `location.assign(original destination)`, the full-nav fallback so
  URL/history/lifecycle stay correct (hydrate.ts:596-608; an empty outlet chain on
  either side falls back identically, hydrate.ts:621-624; never swap-anyway, never
  silent no-op). There is NO client-side guard wiring — a guard's 302 is followed
  transparently by fetch and lands on the `r.redirected` leg.
- **Swap:** DOMParser the fetched page; walk current + fetched `<sprig-outlet>` chains
  outermost→inner, positionally paired in chain order (spec 01 §3's `MatchedLevel[]`
  chain, outer→inner). Each `<sprig-outlet data-level>`'s value IS the matched level's
  `load` string (`MatchedLevel.load`, spec 04 §3 item 3) — a per-position content
  identifier, not an integer depth index. Comparing each position's `data-level` value
  directly tells the walk both when the two chains diverge in LENGTH (one page has a
  layout the other doesn't) AND when two same-depth outlets are showing different
  `load`s (e.g. same layout, different leaf page). It does NOT catch a same-`load`
  content change driven purely by a route `:param` (`load` never encodes params) — so
  the innermost/leaf position is always treated as differing regardless of `load`
  equality (it must always refresh, since a `:param`-only navigation changes page
  content without changing `load`); every position outer of the leaf swaps only when
  its own `data-level` value changes, preserving their state.

  Swap at the shallowest differing position (per the rule above).
  `teardown(cur)` → innerHTML replace → `bootstrap(cur)` (re-arm islands) → scroll
  (traverse lets the browser restore; else fragment; else top). Wrapped in
  `startViewTransition` when available.
- **State:** islands OUTSIDE the swapped outlet stay mounted (state preserved); at/below
  the swap point everything is torn down and re-hydrated. `persistState()` runs before
  navigating away.
- Perf beacons: nav-start + committed-swap POSTs when `cfg.perf` present.

## 8. Dual-runtime recovery

`maybeRecoverDualRuntime()` (hydrate.ts:389-400): if core.ts flagged
`__sprig_runtime_dual`, reload ONCE per session (sessionStorage guard; privacy mode →
never reload). Invoked from hydration failure and chunk-load failure. Build-side twin:
`assertSingleRuntime` (spec 04).

## 9. HMR hooks in the client runtime

`enableHmr()` (the optional boot-sequence call from §3) runs before hydration;
hydrated instances register into `live` with a
`swap(template)` that replaces nodes/source and bumps a tracked `tick` signal →
re-render with the **same scope** (state preserved). `hotTemplate(sel, ast)` updates the
registry (future mounts) + swaps every live instance, pruning detached ones. The dormant
receiver in `registerIsland` refreshes baked ASTs from `<base>/_sprig/ast/<sel>` only
when HMR is enabled; fetch failure falls back to the baked AST. `liveCount(): number`
(hydrate.ts:308) is an exported diagnostic returning `live.length` — the count of
currently-live instances, exposed so tooling can assert the registry stays bounded to the
currently-mounted set (never growing across soft-navs).

## 10. Contract checklist for a refactor

1. Single-runtime-copy invariant (build gate + one-shot session-guarded reload).
2. Hydration order: setup → snapshot → sync restoreState → render → browser hook.
3. Delegation reaches every same-base handler; chord modifiers.
4. Nested-island preserve/shell/late-mount/props-bridge-skew semantics; instance-path
   resolution keys.
5. Soft-nav skip table; reserved prefixes boundary-respecting; ANY failed commit
   test (guard redirects included) → full-nav fallback; outlet-level diffing;
   outside-outlet state preservation.
6. `cfg.base === ""` is a legitimate value (root mount / isolate workbench) — never
   treat `""` as unset.
7. Snapshot transfer surface is JSON-serializable own fields + signal values only
   (drops Set/Map/non-finite/functions silently).
8. Known gap to design out: client `output()` unimplemented; data-driven nested-island
   removal leaves a pinned stale host; whole-subtree re-render+morph is the update
   granularity.
