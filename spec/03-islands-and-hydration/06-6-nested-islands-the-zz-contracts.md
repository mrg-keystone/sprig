## 6. Nested islands (the zz-* contracts)

"zz-*" names the `zz-nested-island-*` regression-test family
([§10](10-10-contract-checklist-for-a-refactor.md) items 5, 6, 7, 8, 9) that pins the
six contracts below (`resolve`, `shell`, `pin`, `rescan`, `host-filter`,
`instance-path-key`); it is not itself one of them. This fragment is the mechanism
behind invariant 6's `pin + shell + rescan` clause
([00-overview §6](../00-overview/06-the-invariants-that-define-the-system-full-versions-in-each-.md)) —
the complement to [§4](04-4-hydration-order-pinned-by-hydrate-restore-order-test-ts.md)'s
hydration-order clause of that same invariant. It rides [§5](05-5-reactive-update-model.md)'s
pin primitive (the keyed pre-pass that matches an island host by `data-sel` and leaves
it untouched) and its `host-filter` pre-pass (the general morph pre-filter that strips
props-bridge/blank-text nodes ahead of positional alignment for ANY island's morph,
nested or not — [§5](05-5-reactive-update-model.md)'s morph mechanics); nesting relies
on both, but neither is nested-only. Everything below beyond `host-filter` is what's
unique to a parent island whose re-rendered body itself contains child island hosts.

| contract | what it guarantees | site/mechanism | regression reintroduced if broken |
| --- | --- | --- | --- |
| `resolve` | a child is resolved for (page, selector) via a 4-rung precedence: page-local static → global static → loaded island → **known-but-unloaded island** (via `islandSelectorScopes`, the [§3](03-3-client-boot-trigger-arming.md) boot registry — it supplies the stub's SCOPE marker only; the not-yet-loaded island's `data-trigger` comes from `islandTrigger(sel)`, which reads the LIVE host's `data-trigger` if one is already mounted, fallback `"load"` otherwise — never from the registry — so this rung carries the correct `data-trigger` only when a live host already exists at that position; a genuinely-new child with no live host yet gets the `"load"` fallback, not its authored trigger) | `componentsForPage` | bug AJ — an island fell through to an inert bare custom element when the unloaded-island rung was missing, and morph then destroyed the live hydrated child host |
| `shell` | client-mode re-render of a parent emits each child island as an EMPTY-body shell (parent-computed inputs as props), never the child's expanded markup | island shell emission on client re-render ([§5](05-5-reactive-update-model.md) step 3) | a genuinely-new child never gets the props it needs to hydrate from |
| `pin` | the host at a matched `data-sel` position is left entirely untouched by the parent's morph — child effect/state/DOM survive the parent's re-render | [§5](05-5-reactive-update-model.md)'s morph table, keyed pre-pass on `data-sel` | bug AJ — touching a live child host destroys the hydrated child |
| `rescan` | any child-island shell a render just introduced is armed without waiting for a full page load, so a genuinely-new child late-mounts and hydrates from its shell's props | `rescanIslands`, run after every island effect render ([§3](03-3-client-boot-trigger-arming.md), [§5](05-5-reactive-update-model.md) step 5) | a new child stays an inert, unarmed shell forever |
| `host-filter` | props-bridge `<script>` nodes and blank text nodes are stripped at host level before the morph's positional alignment runs | host-level filter ahead of the positional pass | bug B3 — index skew misaligns sibling nodes |
| `instance-path-key` | the SSR `resolved` map for async child resolution is keyed by **instance path** (`rkey = path + "/" + node.startIndex`), not bare AST node | SSR resolve pre-pass | bug AB — two wrapper instances around one island leak each other's scope/snapshot |

The `resolve` row's regression (an island falling through to an inert bare custom
element) and the `pin` row's regression (touching a live child host destroys it) are
cause and effect, one bug: with the unloaded-island rung missing, a child island
composed inside a parent's template resolved to `undefined`, fell through to NATIVE
rendering as a bare `<child>` element, and morph then matched that position by
`sameNode`/positional sync instead of pinning it by `data-sel`, destroying the live
hydrated child host. [§10](10-10-contract-checklist-for-a-refactor.md) item 7 numbers
the whole sequence bug AJ; the `pin` row's mention of AJ above names its destructive
symptom, the `resolve` row's names its root cause, and both point at the same bug.

**Worked example — a live nested child pinned through a parent re-render.** A
`dashboard` island holds a live `chart` child island; the user has zoomed the chart to
`zoom: 2.5` (a `chart`-local signal, never passed down as a `dashboard` input). The user
edits an unrelated `dashboard` control, writing `dashboard`'s `range` signal.

1. `dashboard`'s effect re-runs ([§5](05-5-reactive-update-model.md) step 2) and
   `renderNodes` renders the WHOLE `dashboard` subtree to a fresh HTML string
   ([§5](05-5-reactive-update-model.md) step 3). At the `chart` position that string
   contains an island **shell**: `<sprig-island data-sel="chart" data-trigger="load">`
   wrapping just the props-bridge script — an EMPTY body, not `chart`'s expanded markup
   (the `shell` contract).
2. `patchInnerHtml` morphs the string in ([§5](05-5-reactive-update-model.md) step 4).
   Its keyed pre-pass reaches the `chart` position, matches the live
   `<sprig-island data-sel="chart">` host already in the DOM, and — per the `pin`
   contract — leaves it entirely untouched: no attribute sync, no recursion into its
   children. `chart`'s own effect, its `zoom` signal (still `2.5`), and its hydrated DOM
   are never touched by `dashboard`'s re-render.
3. `rescanIslands` runs ([§5](05-5-reactive-update-model.md) step 5): the `chart` host is
   already `data-sprig-hydrated`, so the `rescan` contract finds nothing new to arm.

Contrast a genuinely NEW child appearing — the user flips a `dashboard` control from a
single-chart to a dual-chart layout, adding a second `<chart>` at a keyed position that
had no host before:

1. Same steps 1-2 above, but the keyed pre-pass finds NO existing host at the new
   position — nothing to pin — so the shell is inserted fresh, empty body, its own
   `{...inputs}` in the props bridge, per the `resolve`/`shell` contracts.
2. `rescanIslands` finds this new, unarmed shell and arms it per its `data-trigger`;
   once its trigger fires its chunk loads and it hydrates from the shell's props
   exactly as [§4](04-4-hydration-order-pinned-by-hydrate-restore-order-test-ts.md)'s
   five-step sequence describes for any first hydration — a late-mount, not a pin.

**Known limitation — data-driven removal leaks a stale child DOM node.** The `pin`
contract's keyed pre-pass matches a child island purely by `data-sel` PRESENCE at a
keyed position in the parent's freshly rendered string; a child ABSENT from that string
(`@if (show()) { <chart/> }` flipping to `false`) is indistinguishable, to the pre-pass,
from "matched host, leave it pinned" — there is no separate signal for "this position
used to hold a host and no longer does." So morph pins live child hosts
unconditionally, and a data-driven REMOVAL of a nested island leaves the stale child
mounted in the DOM: its effect keeps running, its state stays live, nothing tears it
down. This is inherent to the `pin` contract as specified here, not an implementation
bug in it. [DX-IDEAL §3.3](../DX-IDEAL/04-3-per-subsystem-ideal.md) designs this out
with a `released` transition whose discriminator is exactly the absence-at-the-keyed-
position signal this pre-pass doesn't currently look for.

**What proves the pin held:** after a parent re-render, the child host is the SAME DOM
node (identity preserved, never replaced) at its `data-sel` position, its effect
subscription is still the one wired at first hydration
([§4](04-4-hydration-order-pinned-by-hydrate-restore-order-test-ts.md) step 4), and its
local signal state is unchanged — none of which shows up in the shell string step 1 of
the worked example above produced, since that shell is discarded by the pin, never
applied.

This observable is pinned by `zz-nested-island-pin.test.ts` (the `pin` member of the
`zz-nested-island-*` family), asserting DOM node identity + live effect subscription +
unchanged child signal state across a parent re-render — the same DOM-observable pattern
[§4](04-4-hydration-order-pinned-by-hydrate-restore-order-test-ts.md)'s
`hydrate-restore-order.test.ts` uses for hydration order.

