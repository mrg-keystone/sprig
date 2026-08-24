## 4. Hydration order (pinned by hydrate-restore-order.test.ts)

Per island instance, five ordered steps:

| # | action | why it sits HERE | what breaks if moved |
| --- | --- | --- | --- |
| 1 | `scope = entry.setup(clientCtx(inputs))` | creates the signals every later step writes into or reads from — nothing else can run first | moved after 2/3 → `restore()`/`restoreState()` have no signal to write into |
| 2 | apply `__snapshot` via `restore()` | overlays the server's post-`onServerInit` values onto the just-created signals, before persisted state and before paint | swapped with step 3 → persisted state would lose precedence to the snapshot on colliding keys (see precedence below); moved after step 4 → flash of unseeded defaults before the snapshot value appears |
| 3 | **synchronous `restoreState()`** | must complete before first paint (step 4) so persisted StateService values are visible on the FIRST paint — the constructor's default `queueMicrotask` restore would land AFTER paint instead (mechanics: [01 §5](../01-core-runtime/05-5-stateservice-persisted-client-state-core-ts-103-187.md)) | left async (constructor's default `queueMicrotask` timing) → first paint shows the unrestored value, then a second, visually distinct re-render corrects it — the flash this step's synchronicity exists to kill |
| 4 | first `effect` render (paint) | the earliest point both channels (snapshot + persisted state) have been fully applied — painting any earlier risks showing an intermediate value | moved before 2/3 → paints the raw `setup()`-default state, defeating the point of ordering 2/3 ahead of it |
| 5 | `onBrowserLoad ?? onBrowserInit` | the "DOM is live" hook — its contract assumes a painted, hydrated DOM | moved before step 4 → hook code (measuring layout, focusing a restored value) observes pre-paint/default DOM |

This fragment is the full statement of **invariant 6's hydration-ORDER clause**;
invariant 6's other clause — preserve, a parent island's re-render must never destroy
a live hydrated child — is owned by [§6](06-6-nested-islands-the-zz-contracts.md).
StateService's own `restoreState()`/overlay mechanics are specified in
[01 §5](../01-core-runtime/05-5-stateservice-persisted-client-state-core-ts-103-187.md),
not repeated here. This order is on DX-IDEAL's do-not-reorder protect list
([§3.3](../DX-IDEAL/04-3-per-subsystem-ideal.md),
[§6](../DX-IDEAL/07-6-what-must-not-change-the-good-dx-to-protect.md)) — the ideal
only adds structure around it, never reorders it.

**Precedence when both channels carry the same key, on the FIRST hydration to touch a
given StateService:** steps 2 and 3 both seed the island's scope signals, in order —
step 3 runs second and, per its overlay semantics
([01 §5](../01-core-runtime/05-5-stateservice-persisted-client-state-core-ts-103-187.md)),
writes over whatever step 2 set for any key the persisted `localStorage` blob actually
has. So the persisted StateService value wins over the server `__snapshot` value on a
collision; a key the persisted blob has no entry for is left exactly as step 2 set it.
On a second or deferred island sharing that same root-singleton StateService, [01
§5](../01-core-runtime/05-5-stateservice-persisted-client-state-core-ts-103-187.md)'s
restore-once `#restored` guard has already locked out the overlay, so step 3 is a
no-op there and this precedence rule doesn't apply.

Teardown mirrors this: `onBrowserDestroy` folds in, and bookkeeping (`mounted`, `armed`,
`islandMounts`) is pruned by `teardownInside(root)` **before** outlet swaps. The
ordering matters because `teardownInside`'s `dispose()` step (effect teardown plus
`onBrowserDestroy`) must run its cleanup while the outgoing nodes are still
live/connected — an outlet swap detaches them first, and once detached the dispose
channel can no longer run cleanup against them. Scope is stashed on the node as
`el.__sprigScope`; `onIslandMounted(cb)` replays mounts for external tooling (the
isolate preview harness).

**What the pinning test checks:** `hydrate-restore-order.test.ts` asserts the
observable at the DOM, not the call order directly — after an island with a
StateService-backed field hydrates, the FIRST painted output already shows the
persisted value, never a first paint of the field-initializer default followed by a
corrective re-render. A regression to the constructor's default `queueMicrotask`
timing (step 3 landing after step 4 instead of before it) is exactly what this test
catches. `hydrate.ts:747-755` parses the props bridge (cited at
[03 §2](02-2-the-ssr-client-props-contract.md)) — step 2's own `restore()`/`__snapshot`-apply
anchor is line 760, pinned in the sequence below.

The full five-step sequence is pinned at `hydrate.ts:757-837`, inside `hydrateIsland`:
step 1 (`entry.setup(clientCtx(inputs))`) opens the range at line 757; step 2
(`restore()` applying `inputs.__snapshot`) is line 760; step 3 (`restoreState()`) is
line 766; step 4 (the `effect(() => {…})` whose first synchronous run is the paint)
spans lines 815-827; step 5 (`(life.onBrowserLoad ?? life.onBrowserInit)?.call(life)`)
closes the range at line 837.

**Trace** — a `counter` island whose `count` field is both `IslandDef.snapshot`'d and
backed by an injected `CounterState extends StateService`. Server default is
`count: 0` (`__snapshot: {count: 0}`); the browser's `localStorage` holds `{count: 5}`
from a prior session:

1. `setup()` creates the `count` signal, seeded 0 from inputs/defaults.
2. `restore({count: 0})` applies the snapshot — `count` reads 0.
3. Synchronous `restoreState()` overlays the persisted `{count: 5}` onto the same
   field — `count` now reads 5 (step 3 wins on the collision, per the precedence rule
   above).
4. First `effect` render paints `count=5` — no flash of 0.
5. `onBrowserLoad ?? onBrowserInit` runs against a DOM that already reads 5.

Had `restoreState()` instead run through the queueMicrotask timing this step
overrides (i.e. landing after step 4), first paint would show `count=0` — the
snapshot value — with the correction to 5 arriving one microtask later as a second,
visually distinct re-render: the flash-of-0 bug `hydrate-restore-order.test.ts` exists
to catch.

**Acceptance criteria** — behavior this section defines, checkable against the
compiler's own source:

- First paint of a StateService-backed field shows the persisted value directly —
  never a first paint of the field-initializer/snapshot default followed by a
  corrective re-render (hydrate-restore-order.test.ts).
- On the FIRST hydration to touch a given StateService, a key both channels carry
  resolves to the persisted value (step 3 overlays step 2 on collision); a key the
  persisted blob lacks retains exactly the value step 2 (the snapshot) set.
- On a second or deferred island sharing that same StateService, step 3 is a no-op —
  the restore-once guard has already locked out the overlay, so the collision
  precedence above doesn't reapply (mechanics + pinning test: [01 §5](../01-core-runtime/05-5-stateservice-persisted-client-state-core-ts-103-187.md)'s
  restore-once-guard.test.ts).
- Teardown prunes `mounted`, `armed`, and `islandMounts` bookkeeping BEFORE the
  outlet swap that detaches the DOM nodes those keys point at — never after, so that
  `dispose()` (effect teardown plus `onBrowserDestroy`) still runs its cleanup while
  those nodes are live/connected.
- `onBrowserLoad ?? onBrowserInit` always runs against an already-painted, hydrated
  DOM — never a pre-paint or default-state DOM.

