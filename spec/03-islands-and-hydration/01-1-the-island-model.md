## 1. The island model

**Rule (enforced identically in two places that must agree):** a component folder with a
`template.html` AND a sibling `logic.ts` is an island — mod.ts:108-162 (SSR) and
build.ts:106-158 (build). `island-infer.ts` (syntactic inference) is a prototype, NOT
wired in; adopting or deleting it is an open decision — the exact fork DX-IDEAL analyzes
at [§3.3](../DX-IDEAL/04-3-per-subsystem-ideal.md) ("a wired-but-unwired template is
loud, not silently static"; recommendation: dev-lint only, never the shipping
classification rule).

`IslandDef` (render.ts:41-58):
- `scope(inputs, reqCtx?)` — sync scope builder (fallback path).
- `trigger` — `"load" | "visible" | "idle" | "interaction"`.
- `snapshot?` — a boolean GATE (`!serverOnly`), not a payload: it tells the renderer
  whether to capture this island's state at render time. The actual payload —
  `snapshotOf(scope)`'s output ([§2](02-2-the-ssr-client-props-contract.md)), the class's
  post-`onServerInit` scope state — can't live on the def (the scope isn't resolved until
  render); whichever renderer resolves this island computes it per-render and serializes it
  into the props bridge as `__snapshot` — `renderLevel` (mod.ts:301) for a chain-level island
  (the matched page/layout/shell itself), `renderComponent` (render.ts:307-321) for a CHILD
  island encountered while a parent re-renders. Absent (gate `false`) for `serverOnly`.
- `serverOnly?` — route logic with `onServerLoad` and NEITHER `onBrowserLoad` NOR
  `onBrowserInit` — a closed two-hook set (mod.ts:124-125, mirrored by build.ts's
  `isServerOnlyRouteLogic`): runs at SSR for data, renders static, NO hydration
  boundary, no client chunk.
- `resolve?(inputs, reqCtx?)` — async: instantiate + await `onServerInit`; used by the
  parallel pre-pass.

| trigger | fires when |
|---|---|
| `load` (default) | immediately, when the generated loader calls `bootstrapIslands`'s DOM scan — guarded on `document.readyState` (waits for `DOMContentLoaded` only if still `"loading"`, else runs now; not an unconditional listener) — eager |
| `visible` | IntersectionObserver enters the viewport |
| `idle` | `requestIdleCallback` (200ms `setTimeout` fallback) |
| `interaction` | one-shot `pointerover`/`focusin` |

Arming mechanism: [§3](03-3-client-boot-trigger-arming.md). `"load"`'s eager-by-default
is a footgun — an island ships on the critical path the moment it's untriggered, unless
its `logic.ts` opts into a lazier trigger (DX-IDEAL
[§3.3](../DX-IDEAL/04-3-per-subsystem-ideal.md): surfacing "why is this eager?" in the
inspector is the recommended mitigation).

Every normal island (declares a browser hook) compiles to exactly one lazy chunk,
`isl.<sel>.js` (`<sel>` = selector = folder basename); `serverOnly` compiles to zero
chunks — no client-side artifact at all. This 1:1 island↔chunk identity holds for both
construction forms below; the chunk-loading mechanics live in
[§3](03-3-client-boot-trigger-arming.md).

Construction from `logic.ts` (mod.ts:111-161) forks on the exported shape:

| form | trigger source | snapshot | resolve | scope builder | server hooks |
|---|---|---|---|---|---|
| class default export | static class field; **defaults to `"load"` when absent** | gate `true` when `!serverOnly` — the resolving renderer (`renderLevel` for a chain-level island, `renderComponent` for a child) then calls `snapshotOf(scope)` per-render and serializes its output into the props bridge as `__snapshot` | present — async: instantiate + await `onServerInit` (the parallel pre-pass) | derived from the class construction | `constructor` + `onServerInit`, run inside the fresh server injector |
| `{setup}` object | `d.trigger` property on the object (not a static class field) — CAN be declared; **same `"load"` default when absent** (matches `defineComponent`'s bare-fn form, spec 01 §1) | none | none | `scope(inputs, reqCtx?)` wraps `setup` directly (the sync fallback path) | `setup()` only — no `onServerInit` dispatch |

Every `IslandDef` has a concrete trigger by construction either way; `data-trigger` is
never emitted as `"undefined"`. The `{setup}` row's empty snapshot/resolve/server-hooks
cells — plus a fourth gap, client-side DI, that doesn't show up as a table column (below)
— ARE the capability cliff DX-IDEAL flags at
[§3.3](../DX-IDEAL/04-3-per-subsystem-ideal.md) ("one great form, not two at parity").

**Worked example:** `components/counter/template.html` + `components/counter/logic.ts`:

```ts
export default class Counter {
  static trigger = "interaction" as const;
  onServerInit() { /* … */ }
  onBrowserLoad() { /* … */ }
}
```

Construction yields `IslandDef { trigger: "interaction", snapshot: true (the gate —
!serverOnly), resolve: present, scope: derived from the class }`; selector = folder
basename = `counter`. `counter` lives under `components/`, so it's a CHILD island — mounted
inside some parent's template rather than being a matched chain level itself. At render,
`renderComponent` (render.ts:307-309) reads the `true` gate and calls `snapshotOf(scope)`,
serializing the result into the props bridge as `__snapshot` (render.ts:321). A chain-level
island (a leaf page, layout router, or the shell) goes through `renderLevel` (mod.ts:301)
instead, which computes and serializes the snapshot the same way for its own level. The
build emits exactly one client chunk, `isl.counter.js`.
Had `Counter` instead declared only `onServerLoad` (neither `onBrowserLoad` nor
`onBrowserInit`, `serverOnly: true`), the same folder SSRs the same markup but compiles
to zero chunks — no `isl.counter.js`, no hydration boundary.

**Worked example — `{setup}` form (the capability cliff):** `components/clock/template.html`
+ `components/clock/logic.ts`:

```ts
export default {
  trigger: "idle",
  setup(ctx) {
    const now = ctx.input("now", Date.now());
    return { now };
  },
};
```

Construction yields `IslandDef { trigger: "idle", snapshot: undefined, resolve: undefined,
scope: (inputs) => withServerInjector(() => setup(makeServerCtx(inputs))) }`; selector =
folder basename = `clock`. `clock` DID declare its own trigger (`d.trigger`, same mechanism
as the class form's static field) — the cliff isn't trigger. SSR renders through the sync
`scope` builder (there's no `resolve` for this form, so no async pre-pass) and wraps the
result as a hydration boundary exactly like the class form: the build emits `isl.clock.js`,
same 1:1 chunk identity. But `comp.island?.snapshot` is `undefined` for this form, so nothing
is captured — the props bridge carries `inputs` only, no `__snapshot`. On the client,
`hydrateIsland` finds no `inputs.__snapshot` to restore and calls `entry.setup(clientCtx(inputs))`
straight from the parsed props: `clock` re-derives its state fresh in the browser instead of
resuming server-computed state, and there is no `onServerInit`-equivalent hook to dispatch on
either side.

A fourth gap, client-side DI, splits this same `setup` call across the two sides: SSR's
`scope` builder above wraps it in `withServerInjector(...)` (mod.ts:158), so `inject()`
resolves during the server render. The generated client chunk has no equivalent wrap — it
imports `logic.setup` raw (build.ts:207), and `hydrateIsland` calls
`entry.setup(clientCtx(inputs))` with no injector wrap around it (hydrate.ts:757). So a
`{setup}` island that calls `inject()` on a `both`-scoped service works at SSR and throws at
hydration. The class form doesn't have this asymmetry: `makeClassSetup` wraps the
construction in `runInInjector(clientRoot(), ...)` on the client too (hydrate.ts:24-27 — the
client column of the injector-wiring table below), so `inject()` resolves on both sides.

That gap — snapshot, resolve, server-hooks, AND client-side DI, not trigger — is the
capability cliff.

**Acceptance criteria** — behavior this section defines, checkable against the
compiler's own source:

- SSR (mod.ts:108-162) and the build (build.ts:53-61, 145-148) classify island-ness
  IDENTICALLY: the same "folder has `template.html` + sibling `logic.ts`" gate, and
  the same `serverOnly = onServerLoad && !onBrowserLoad && !onBrowserInit` predicate —
  the build's `isServerOnlyRouteLogic` regex mirrors the renderer's prototype check, so
  a folder is never an island on one path and static on the other.
- 1:1 island↔chunk identity: every island that isn't `serverOnly` compiles to exactly
  one `isl.<sel>.js` — never zero, never more than one.
- `serverOnly` ⇒ zero chunks: the build ships no client entry at all for it.
- Every host carries a concrete `data-trigger`: `IslandDef.trigger` always resolves to
  a string (the declared value or the `"load"` default), so `islandHost` never stamps
  `data-trigger="undefined"`.

> **[DECIDE]** Name the pinning test that locks these four invariants down — no existing
> suite asserts SSR/build classification parity or the chunk-count identity end-to-end.
> Recommended default: `island-classification.test.ts` — one focused suite is cheaper to
> maintain than scattering the assertion across mod.ts's and build.ts's existing tests.

**Injector wiring** (island.ts / hydrate.ts): server and client build parallel-shaped
`ComponentCtx`s, from different roots, feeding the construction forms above:

| | Server (SSR) | Client (hydrate) |
|---|---|---|
| construction fn | `withServerInjector(fn)` — wraps `setup`/`constructor`/`onServerInit` | `makeClassSetup(Cls)` — constructs the class |
| injector root | `new Injector("server","root").child("component")` — FRESH, never the request injector | `clientRoot()` — the browser document singleton |
| ctx builder | `makeServerCtx(inputs, emit?)` | `clientCtx(inputs)` |
| input / model | signals seeded from `inputs` | signals seeded from the parsed props bridge |
| output | live emit wrapper — calls `emit?.(name, value)` | **no-op stub** — cross-island outputs are future work (hydrate.ts:1020-1022) |

Without the wrap, every `inject()` in an island throws → HTTP 500. The server root being
FRESH — never the request injector — is what enforces invariant 2, **DI never crosses
the wire**; the full rationale (request-root bindings invisible, `inject(Backend)`
throwing the unbound-factory error, the three-context comparison) lives at
[00-overview §6](../00-overview/06-the-invariants-that-define-the-system-full-versions-in-each-.md)
and [spec 01 §2](../01-core-runtime/02-2-injector-semantics-core-ts-190-256.md) — not
restated here.

