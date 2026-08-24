## 5. Reactive update model

**Why this model exists (and its cost):** signals are wrapped `@preact/signals-core`
(spec 01 [§1](../01-core-runtime/01-1-public-api-surface-all-of-mrg-keystone-sprig.md))
— a primitive with fine READ granularity: an effect tracks exactly which signals the
code it ran actually touched. One `effect()` per island (hydrate.ts:815-827) uses that
tracking to know WHEN to re-render, but not WHAT to re-render — its response to any
tracked write is monolithic: the **whole island subtree** re-renders to an HTML string
and morphs back in, never just the node(s) the changed signal feeds. So
signals-core's fine read-granularity collapses to zero write-response granularity at
the island boundary — one coarse effect, not the per-node effects fine-grained
reactivity implies. This is the baseline cost DX-IDEAL [§3.3](../DX-IDEAL/04-3-per-subsystem-ideal.md)
/[§4](../DX-IDEAL/05-4-the-biggest-cross-cutting-forks.md) item 2 (node-level reactivity)
replaces.

**The update flow**, one tracked signal write to the next paint — five steps, always in
this order:
1. **Signal write** — `.value =`/`.set()`/`.update()` on a signal the effect read,
   typically from inside a delegated handler (`evalStatement`, below).
2. **Island effect re-runs** (hydrate.ts:815-827) — the SAME effect wired at first
   hydration ([§4](04-4-hydration-order-pinned-by-hydrate-restore-order-test-ts.md) step
   4) fires again, synchronously.
3. **`renderNodes(nodes, …)` over the JSON AST** (hydrate.ts:818) → a fresh HTML string
   for the island's ENTIRE body — the same interpreter code as SSR (spec 02
   [§4](../02-template-compiler/05-4-render-ts-ssr-semantics.md)).
4. **Morph the string into the live DOM** (`patchInnerHtml`, hydrate.ts:819) — reuse,
   update, or replace existing nodes in place instead of `el.innerHTML = html`, so
   focus/caret/selection/scroll of unchanged elements survive (mechanics below).
5. **`rescanIslands` + delegation re-wire** (hydrate.ts:826, 821) — `rescanIslands` arms
   any child-island shell this render just introduced
   ([§3](03-3-client-boot-trigger-arming.md)); the delegation wiring (`wire()`) attaches
   a listener for any NEW event base the render introduced (below).

**Acceptance criteria** — what a correct implementation of this section must satisfy:
- **Morph reuse:** a focused, unchanged element keeps its DOM identity — and therefore
  focus — across a text-only re-render (the golden path below is this case: the
  `<button>` node is never removed or recreated).
- **Delegation:** two `(click)` handlers registered on the same event base both fire on
  one click (addEventListener semantics — bug A, below); `keyup.control.enter` fires
  only on a ctrl+enter keyup, never on a bare enter or a bare ctrl.
- **Failure boundary (AS-BUILT — not a target guarantee):** today, a throw partway
  through a morph (step 4) leaves the DOM half-morphed (nodes before the failure point
  synced, nodes after it stale) and the error surfaces uncaught in the triggering
  handler (see Failure policy, below) — this is the current behavior a regression test
  pins. The `[DECIDE]` at the end of Failure policy proposes wrapping the re-render,
  which would replace the half-morphed-DOM/uncaught-error half of this with a caught,
  island-located diagnostic and a defined DOM disposition. One sub-claim survives either
  way, current and target alike: the island's effect subscription stays live (no
  teardown).

**Golden path:** a counter island renders `<button (click)="count.set(count()+1)">Count:
{{ count() }}</button>`. The user clicks the button. The delegated listener resolves the
`click` handler and runs `count.set(count()+1)` — **step 1**. The island's effect fires
— **step 2** — and `renderNodes` re-renders the whole `<button>` subtree (there is no
narrower unit) to the string `<button data-sprig-click="0">Count: 1</button>` — **step
3**. `morphChildren` walks the button's single child: both sides are a text node, so
`sameNode` matches and it's reused, not replaced; `morphNode` syncs its `nodeValue` from
`"Count: 0"` to `"Count: 1"` — **step 4**. The `<button>` element itself is never
removed or recreated, so if the user tabbed to it before clicking, focus is preserved.
`rescanIslands`/`wire()` run and find nothing new to arm or attach — **step 5**.

**Morph mechanics** (step 4 in detail) — position-keyed node reuse, no vdom. A
host-level pre-filter strips the island root's props-bridge
`<script class="sprig-props">` node ([§2](02-2-the-ssr-client-props-contract.md)) and
blank text nodes from both sides BEFORE positional alignment runs (the `host-filter`
contract, [§6](06-6-nested-islands-the-zz-contracts.md)) — the golden path below relies
on this to treat the rendered `<button>` as the root's sole aligned child. After that
strip, every remaining node kind is handled one of two ways: synced in place, or
**pinned** (left entirely untouched — no attr sync, no recursion, no replace). The
pinning contract is what [§6](06-6-nested-islands-the-zz-contracts.md) and
[§7](07-7-soft-navigation-hydrate-ts-500-727.md) depend on surviving a re-render:

| Node kind | Match key | Morph treatment | Pinned / opaque |
|---|---|---|---|
| Native element | position (`sameNode`: same tag) | `morphNode` — attribute add/update/remove, recurse into children | No — fully synced |
| Island host (`<sprig-island data-sel>`) | `data-sel` key ([§2](02-2-the-ssr-client-props-contract.md)), matched by a KEYED pre-pass before the positional pass | left entirely untouched | **Pinned** — owns its own effect/state; touching it destroys the hydrated child (bug AJ) |
| `<sprig-outlet>` | tag identity (`isOutlet`: the first unconsumed `<sprig-outlet>` pairs with the live one), matched by the same KEYED pre-pass — NOT `data-level`; that per-position `load` identifier (spec 04 [§3](../04-build-pipeline-and-artifacts/03-3-what-ssr-must-inject-for-hydration-the-html-contract.md) item 3) is consulted only by [§7](07-7-soft-navigation-hydrate-ts-500-727.md)'s soft-nav outlet-chain diffing, a separate walk from this morph pre-pass | left entirely untouched; `morphNode` also treats a matched-but-reached outlet as opaque, belt-and-suspenders | **Pinned/opaque** — its content is the child page soft-nav owns |
| Text / comment | position (`sameNode`: same `nodeType`) | `nodeValue` sync only | No — synced in place |

No keyed list reconciliation beyond position + pinning. Focus/caret/selection/scroll of
unchanged elements — including elements below a pinned host/outlet, which are never
reached — are preserved.

**Event delegation:** one delegated listener per distinct event base on the island root,
(re)wired each render. Dispatch — one event, five steps, always in this order:
1. **Target resolution** — `ev.target.closest("[data-sprig-<base>]")` finds the nearest
   ancestor carrying that event base's marker attribute.
2. **Handler-index lookup** — the marker's value is a space-joined handler-index list;
   `resolveHandlers` returns EVERY matching handler for that marker
   (addEventListener semantics — bug A: two `(click)` handlers on one base both fire, not
   just the last).
3. **Chord-modifier filter** — each matched handler is filtered against its declared
   chord modifiers (`keyup.control.enter`; the KEY_ALIAS/MOD_FLAG tables), so a handler
   only survives when the event's key/modifier combination matches.
4. **Submit guard** — a surviving submit handler calls `preventDefault()` before running.
5. **Execution** — `evalStatement(handler, scope, ev)` runs.

**Failure policy (AS-BUILT) — a mid-update throw:** none of the five steps above run inside a
try/catch. First hydration is per-instance isolated (`hydratePending` wraps the initial
`hydrateIsland` call, hydrate.ts:374-380 — one island's hydration failure can't abort its
siblings), but that isolation covers only the FIRST run of the effect; a LATER re-render
— steps 2-5, triggered by a signal write after the island is already live — is not
re-wrapped anywhere. A throw from `renderNodes` (step 3) leaves the DOM at its last-good
state, since nothing has been morphed yet. A throw from `morphChildren`/`morphNode` (step
4) leaves it **half-morphed**: the position-keyed loop (hydrate.ts:972-993) mutates
children one at a time with no rollback, so nodes before the failure point are already
synced and nodes after it are stale. Either way the island is not torn down — its effect
subscription (`dispose`, hydrate.ts:815) stays live, so the next unrelated signal write
re-runs the same effect again, whole subtree and all. The error itself propagates
uncaught out of whichever signal write triggered the re-run — for the common case, a
delegated handler's `evalStatement` call above (hydrate.ts:803-811, itself no
try/catch) — so it surfaces as an unhandled exception in that click/input/etc. handler,
not a caught, located diagnostic.

DX-IDEAL [§3.3](../DX-IDEAL/04-3-per-subsystem-ideal.md)'s six-state lifecycle machine
(`registered|armed|loaded|hydrated|failed|released`) only dispositions a throw at a FIRST-
hydration catch site (`loaded → failed`); it says nothing about a throw on an
already-hydrated island's re-render, so this gap is genuinely open, not just undocumented.

> **[DECIDE] (TARGET — would replace the AS-BUILT failure policy above.)** Should a live
> island's re-render (steps 2-5) be wrapped so a post-hydration throw becomes a located,
> island-scoped diagnostic with a defined DOM disposition (e.g. discard the half-morphed
> frame, leave the last-good DOM, keep the effect subscribed for the next write), or stay
> uncaught as it does today? Recommended default: wrap it — an
> unhandled exception surfacing in whichever unrelated handler happened to trigger the
> re-run is exactly the "silent failure with no location" class this document's failure
> policy elsewhere calls out, and the fix is a try/catch around the existing five steps,
> not new mechanism.

