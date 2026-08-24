## 3. Client boot + trigger arming

Generated `client.js` (build.ts:166-197) boots in five ordered steps:

1. Read the `#__sprig_config` JSON.
2. `if (cfg.hmr) startHmr(cfg.base)` ([§9](09-9-hmr-hooks-in-the-client-runtime.md)) —
   opens the dev SSE client and flips the `hmrEnabled` flag (`enableHmr()`, called INSIDE
   `startHmr`); run before hydration begins so islands register as live instances.
3. `registerIslandSelectors(selector→scope)` populates the `islandSelectorScopes` boot
   registry with one entry per island the build produced — each entry holds the
   island's `scope` marker (`componentScopeId(relDir)`, build.ts:158/181), not a
   trigger. This is the late-mount fix: it lets a parent island's client re-render
   resolve a CHILD island whose chunk hasn't loaded yet — one absent from the SSR HTML —
   to a proper `<sprig-island>` shell (stamped with this registry's scope attribute)
   instead of a bare, inert custom element. The shell's `data-trigger` comes from
   `islandTrigger(sel)` instead, reading the LIVE host's `data-trigger` if one is already
   mounted (fallback `"load"`) — never from this registry — so a late-mounted shell
   ([§6](06-6-nested-islands-the-zz-contracts.md)) still carries a trigger and is armed by
   `rescanIslands` without waiting for the chunk.
4. Register baked static component templates.
5. `bootstrapIslands(cfg)` + `setupSoftNav(cfg)` — run immediately if the document has
   already finished parsing (`document.readyState !== "loading"`), else deferred to
   `DOMContentLoaded`.

> **Registry scope ≠ runtime scope.** The `scope` stashed on `islandSelectorScopes` at
> step 3 is a view-encapsulation marker, not `IslandDef.scope`, the server-only sync scope
> builder from [§1](01-1-the-island-model.md), nor the runtime `el.__sprigScope` stashed
> per-instance in [§4](04-4-hydration-order-pinned-by-hydrate-restore-order-test-ts.md)/[§9](09-9-hmr-hooks-in-the-client-runtime.md) —
> the latter doesn't exist until an instance hydrates. Three distinct things share the
> word "scope" loosely elsewhere; this registry's entry is the only one that exists
> pre-hydration. The `trigger` for a not-yet-loaded island is never read from this
> registry — it comes from the live host's `data-trigger` attribute via `islandTrigger(sel)`.

`cfg` enters at step 5's two calls — `bootstrapIslands(cfg)` and `setupSoftNav(cfg)` — the
only places in the boot sequence that read it. `cfg.hmr` gates step 2 instead, upstream of
both; `bootstrapIslands`/`setupSoftNav` never read `cfg.hmr`. The full field-by-field
consumer mapping (`base`, `v`, `reserved`, `page`, `perf`, `hmr`) is spec 04
[§3](../04-build-pipeline-and-artifacts/03-3-what-ssr-must-inject-for-hydration-the-html-contract.md)
item 4's to own; not restated here.

`bootstrapIslands` scans `document.querySelectorAll("sprig-island")` once and arms each
via `scheduleLoad` (hydrate.ts:435-477). This is the authoritative arming table — [§1](01-1-the-island-model.md)'s
trigger table points here for mechanism:

| trigger | arming primitive | fallback | one-shot vs continuous | canceller registered? |
|---|---|---|---|---|
| `load` (default) | immediate — fires in the same `bootstrapIslands` pass that arms it | — | N/A — resolves immediately, never sits "armed" waiting | no — nothing pending to cancel |
| `visible` | `IntersectionObserver` | — | continuous (observer watches until it enters view) | yes |
| `idle` | `requestIdleCallback` | 200ms `setTimeout` | one-shot (single scheduled callback) | yes |
| `interaction` | `pointerover`+`focusin` listeners | — | one-shot (listener removed after first fire) | yes |

Cancellers registered for the three armed non-`load` triggers let an outlet swap cancel
a trigger that hasn't fired yet before its host leaves the DOM. `rescanIslands(el)` runs
after every island effect render, arming hosts that appeared post-bootstrap; idempotent
(skips `data-sprig-armed`/`data-sprig-hydrated`).

Chunk load: `import("<base>/_assets/isl.<sel>.js?v=<v>")`; each chunk self-registers via
`registerIsland(sel, entry)` → `hydratePending(sel)` hydrates every
`sprig-island[data-sel="<sel>"]:not([data-sprig-hydrated])`, each instance isolated in try/catch.
The exported module-level `loading` set (`export const loading = new Set<string>()`,
hydrate.ts:201) tracks selectors whose chunk `import()` is in flight — a de-dupe guard
against concurrent triggers, and an exported introspection surface.

A chunk `import()` that REJECTS (a stale chunk 404s after a redeploy, a network drop, a
module-eval throw) is caught: the selector is unconditionally deleted from `loading`, so
the "nothing stale in `loading`" invariant below holds even on failure. This catch —
like `hydratePending`'s per-instance catch above — also calls `maybeRecoverDualRuntime()`
([§8](08-8-dual-runtime-recovery.md)). If the dual-runtime deploy-skew state is flagged,
that call self-heals the failure automatically: the page reloads once per session, no
manual step involved. Outside that state — an ordinary stale-chunk 404 or network drop,
with no dual-runtime skew — the host has no failure recovery: `data-sprig-armed` was
already set before the import began, so `scheduleLoad`'s armed-skip guard permanently
excludes the host from `rescanIslands`, and the trigger primitive that fired it is already
spent (the observer disconnected, the idle callback/timeout consumed, the interaction
listener removed) — there is no path back to a retry short of a manual page reload.

> **[DECIDE]** For that ordinary, non-dual-runtime chunk-load reject — where
> `maybeRecoverDualRuntime()` finds no dual-runtime state flagged and so doesn't
> self-heal — should the import be retried (and on what policy), or does the host stay
> permanently unarmed until a manual page reload? Recommended default: leave it
> permanently unarmed and logged via `console.error` — an automatic retry risks hammering
> a chunk that's genuinely 404 (a stale deploy), and a manual hard reload is the natural
> fix, the same fallback recourse privacy mode leaves dual-runtime recovery itself
> ([§8](08-8-dual-runtime-recovery.md)) with when it can't self-heal.

**Worked example** — a `gallery` island, `trigger: "visible"`:

1. Page load: `bootstrapIslands` scans the host and arms it via `scheduleLoad` —
   attaches an `IntersectionObserver` and registers a canceller, stamps
   `data-sprig-armed="1"`. Chunk not loaded.
2. User scrolls the host into view: the observer fires.
3. `scheduleLoad` calls `import("<base>/_assets/isl.gallery.js?v=<v>")`; `"gallery"` is
   added to `loading` for the duration of the import.
4. The loaded chunk self-registers via `registerIsland("gallery", entry)`.
5. `hydratePending("gallery")` hydrates every un-hydrated `gallery` host (hydration
   order: [§4](04-4-hydration-order-pinned-by-hydrate-restore-order-test-ts.md)) and
   stamps `data-sprig-hydrated="1"`.
6. `"gallery"` is removed from `loading`.

**Post-boot, three things hold:**
- Every `load` host whose props bridge parsed carries `data-sprig-hydrated="1"` — whether
  or not `setup()`/render/browser hooks that ran after the stamp threw.
- Every armed non-`load` host carries `data-sprig-armed="1"` and lacks
  `data-sprig-hydrated` until its trigger fires.
- `loading` holds exactly the selectors with an `import()` currently in flight — nothing
  more, nothing stale.

> **Decided:** the `data-sprig-hydrated="1"` stamp is written right after the props
> bridge parses — BEFORE `entry.setup()`, `restore()`, the first render, or
> `onBrowserInit()` run — so it means "hydration attempted past props-parse," not
> "hydration completed." A props `JSON.parse` failure (above the stamp) leaves the host
> unstamped and retry-able — indistinguishable from not-yet-hydrated, so a later
> `hydratePending(sel)` call for the same selector picks it up again. A throw in
> `setup()`, `restore()`, the render effect, or a browser hook — each caught by
> `hydratePending`'s per-instance try/catch — leaves the
> host STAMPED but broken: `rescanIslands`'s `data-sprig-hydrated` skip check treats it as
> done and never retries it. The first post-boot invariant above states this precisely:
> the stamp tracks "past props-parse," and a stamped-but-broken host is a silent failure
> mode tooling reading the attribute should account for.

> **Decided:** a boot/arming pinning test is added, named `boot-arming-order.test.ts`,
> following the same `<what-it-pins>-order.test.ts` pattern [§4](04-4-hydration-order-pinned-by-hydrate-restore-order-test-ts.md)'s
> `hydrate-restore-order.test.ts` uses — asserting the three post-boot invariants above
> at the DOM, the way that test asserts hydration order at the DOM. No such test exists
> yet; writing it keeps this doc family's "pinned by \<file\>" heading convention
> consistent once it lands.

The island triggers above are the client runtime's ONLY lazy-load machinery — there is
no `@defer` handling anywhere in hydrate.ts: a template `@defer` block renders its main
block eagerly via the shared interpreter, its triggers/clauses inert (spec 02
[§1](../02-template-compiler/02-1-template-syntax-grammar-tree-sitter-angular-template-gramm.md)/[§4](../02-template-compiler/05-4-render-ts-ssr-semantics.md)).

