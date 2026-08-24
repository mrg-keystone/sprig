## 6. Supporting modules

These five modules split along one load-bearing line: `scope.ts` and `lifecycle.ts`
are ISOMORPHIC — they run unchanged on the client via hydrate.ts — while `hash.ts`,
`perf.ts`, and `island-infer.ts` are server-only orchestration, so an isomorphic
module must never import a server-only API.

- **scope.ts (CSS view encapsulation)** — Angular-"Emulated" model, no Shadow DOM.
  `scopeId` = FNV-1a → `s`+8hex; `componentScopeId(relDir)` hashes the **folder path**
  (same-basename folders don't cross-apply). `scopeCss` walks blocks and rewrites each
  selector per its form:

  | Selector form | Transformation | Example (input → output) |
  |---|---|---|
  | Plain compound/descendant selector | rightmost compound gets `[sX]` appended | `.a .b` → `.a .b[sX]` |
  | `:host` | replaced with a bare `[sX]` marker | `:host .x` → `[sX] .x[sX]` |
  | `:host(…)` / `:host-context(…)` | parsed into ancestor guards + host compounds; comma-lists inside are **distributed** across each guard (no member leaks global — bug T/U) | `:host-context(.a) .x` → `.a [sX] .x[sX]` |
  | `:global(…)` | unwraps, contents left unscoped | `:global(.x) .b` → `.x .b[sX]` |
  | Opaque at-rules (`@keyframes @font-face @page @property @charset @import @namespace @counter-style`) | body left untouched | — |
  | Conditional at-rules (`@media @supports @container @layer …`) and native CSS nesting | recursed into — inner selectors get the same rewrite rules | — |

  `[xlink:href]`-style inner colons are not treated as pseudos (bug AI).
  The matching bare `sX` marker is stamped in render.ts, not here: `RenderOpts.scopeAttr`
  carries the CURRENT component's scope id, and `renderElement` appends it bare to every
  NATIVE element that component emits ([§4](05-4-render-ts-ssr-semantics.md)); a rendered
  child component swaps in its OWN `scope`/`scopeId(selector)` as `scopeAttr` for its own
  subtree, so nesting never mixes markers, and an island's `<sprig-island>` host carries
  its own child scope the same way (`islandHost`'s `scopeAttr` arg). No other emission
  site adds this attribute.
- **hash.ts** — `shortHash` = SHA-256 over length-framed (name,content) tuples → 16 hex
  chars; `versionOf(dir)` hashes served `.js` + `app.css` sorted (missing/empty →
  null = degraded); `assetsVersioner` memoizes behind a stat probe (name:size:mtime).
  No tree-sitter import (runtime can hash without the compiler).
- **lifecycle.ts** — class-island lifecycle. Six hooks total: four component-level
  (`onServerInit`, `onBrowserInit`, `onServerDestroy`, `onBrowserDestroy`) plus two
  ROUTE-level hooks layered on top of the component pair (`onServerLoad`,
  `onBrowserLoad`) — Load is preferred over Init when both exist, dispatched not in
  lifecycle.ts itself but at the call sites shown below.

  | Hook / spike | Kind | Production dispatch site | Counts as "browser hook" for server-only detection? | Status |
  |---|---|---|---|---|
  | `onServerInit` | component-Init | `onServerLoad ?? onServerInit` (mod.ts:135,147) | No | Live (fallback) |
  | `onServerLoad` | route-Load | `onServerLoad ?? onServerInit` (mod.ts:135,147) | No | Live (preferred) |
  | `onBrowserInit` | component-Init | `onBrowserLoad ?? onBrowserInit` (hydrate.ts:837) | Yes (build.ts:58-61, mod.ts:123-125) | Live (fallback) |
  | `onBrowserLoad` | route-Load | `onBrowserLoad ?? onBrowserInit` (hydrate.ts:837) | Yes (build.ts:58-61, mod.ts:123-125) | Live (preferred) |
  | `onServerDestroy` | component-Destroy | none — mod.ts/render.ts import only `snapshotOf`; the real render path discards server instances without a destroy call | No | Inert in an app — spike-only |
  | `onBrowserDestroy` | component-Destroy | `hydrate.ts:846` — `life.onBrowserDestroy?.()` inside the `mounted` dispose closure (registered hydrate.ts:841-849), invoked by `teardownInside` (hydrate.ts:260-277) on island detach and by every soft-nav outlet swap (`deps.teardown(cur)` at hydrate.ts:644, wired to `teardownInside` at hydrate.ts:696) — symmetric to `onBrowserInit` | No (excluded by build.ts:58-61) | **Live** — "the cleanup channel whose absence bit us before" (hydrate.ts:831-833) |
  | `renderOnServer` (spike) | orchestrator | not called by mod.ts/render.ts | — | Spike-only: construct → await `onServerInit` → view → snapshot → `onServerDestroy` (lifecycle.ts:74-84, pinned by lifecycle.test.ts) |
  | `hydrateOnClient` (spike) | orchestrator | not called by hydrate.ts | — | Spike-only: construct → restore → `onBrowserInit` (lifecycle.ts:90) |
  | `destroyOnClient` (spike) | orchestrator | not called by hydrate.ts (production calls `onBrowserDestroy` directly at hydrate.ts:846, not through this orchestrator) | — | Spike-only: `onBrowserDestroy` (lifecycle.ts:102) |

  `onServerDestroy` and the three spike orchestrators above are unshipped API surface;
  `onBrowserDestroy` is live production API and is not part of that question — see Open
  decisions below.

  `snapshotOf` captures serializable OWN fields, unwrapping signals; drops NaN/
  ±Infinity, Set/Map, functions/symbols/undefined (dropped fields keep client
  constructor defaults — lifecycle-snapshot-lossy.test.ts). `restore` uses `.set()`
  for signal fields. Order contract: construct → restore → `onBrowserInit`
  (hydrate-restore-order.test.ts, bug N).
- **perf.ts** — hidden INFRA-only page-load telemetry. Enabled iff `INFRA_PERF` +
  `INFRA_PERF_URL`; any env-read failure → off (never crash SSR). Emits an inline head
  script firing two `sendBeacon` POSTs joined by a `navId`; must precede the stylesheet
  link. Soft navs report via `__sprig_config.perf`.
- **island-infer.ts** — a **prototype, NOT wired into the build** (island-infer.ts:1-8).
  Would classify island-ness syntactically: template has `(event)`/`[(…)]`, or class
  defines a hook in island-infer's OWN `BROWSER_HOOKS` set (island-infer.ts:22) —
  `onBrowserInit`/`onBrowserDestroy`. This set is NOT the same membership as the
  server-only-detection "browser hook" set defined above (`onBrowserLoad`/
  `onBrowserInit`): island-infer includes `onBrowserDestroy` and excludes
  `onBrowserLoad`, so its classifier must not be built from the server-only-detection
  set. Shipping rule remains file presence (`logic.ts`). Adopting or deleting it — see
  Open decisions below.

### Open decisions

> **[DECIDE]** Wire `onServerDestroy` (inert — no production dispatch site; the render
> path discards server instances with no cleanup call) and the spike orchestrators
> `renderOnServer`/`hydrateOnClient`/`destroyOnClient` (none called by mod.ts/hydrate.ts)
> into production, or drop them as unshipped API surface. This does NOT include
> `onBrowserDestroy`, which is already live production API (hydrate.ts:846) and stays
> regardless of this decision. Recommended default: drop the inert four — no caller
> needs them, and keeping unreferenced hooks/orchestrators as public API invites
> confusion about what actually runs.

> **[DECIDE]** Adopt `island-infer.ts`'s syntactic island classifier in place of
> file-presence detection, or delete the prototype. Recommended default: keep
> file-presence detection — it is simple and is already the shipping contract;
> syntactic inference would need to be proven airtight (no false "static" verdicts)
> before it can safely replace an explicit developer signal.

