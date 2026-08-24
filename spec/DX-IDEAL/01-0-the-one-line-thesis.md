## 0. The one-line thesis

**The ideal sprig is the current architecture with its silence removed — plus a
small, named set of genuine builds the silence framing doesn't cover.**

sprig's bones are already excellent DX: folder-components, selective island
hydration, a byte-identical dev↔prod bundle, view-encapsulated CSS, request-scoped
DI, one `{ fetch }` handler from dev through Deno Deploy, no Vite. The DOMINANT
theme in what follows is silence, not architecture: the single defining flaw —
present in every subsystem — is that **sprig fails silently and invisibly, in dev,
exactly where it should fail loudly and locally.** But a reader scoping work from
this section alone should not under-budget: five items on this list are not
silence fixes, they are genuinely architectural redesigns or net-new capability,
and each is called out at its point of use rather than left implicit here:

- **Reactivity granularity** ([§3](04-3-per-subsystem-ideal.md).3, [§4](05-4-the-biggest-cross-cutting-forks.md)) — sprig already carries a fine-grained
  reactive core (`@preact/signals-core`, spec 01 [§1](02-1-the-organizing-principle-split-the-error-philosophy-by-mod.md)) but discards that granularity
  at render time, re-rendering the WHOLE island subtree to a string and morphing
  it in on every signal write (spec 03 [§5](06-5-build-order-max-dx-leverage-first.md)). Binding a signal write to the specific
  node(s) it feeds is a real compiler/runtime redesign, and the largest single
  investment on the board.
- **`logic.ts` HMR** ([§3](04-3-per-subsystem-ideal.md).5) — the file a developer edits most currently triggers a
  full reload + total state wipe; state-preserving per-island re-import/re-hydrate
  is an authoring-loop gap in the dev loop's own architecture, not a diagnostic
  the framework is merely failing to surface.
- **Typed templates + an editor language service** ([§3](04-3-per-subsystem-ideal.md).2) — a `.d.ts` emission
  binding template expressions to `logic.ts`/`resolve.ts` types, and the LSP built
  on top of it, is new compiler tooling with no existing mechanism to surface
  louder; it doesn't exist today in any form.
- **The `sprig migrate` suite** ([§3](04-3-per-subsystem-ideal.md).10) — ~6 codemods (the render-path
  collapse, the mandatory `StateService` key, the `Backend.get` union,
  `keep`→`compose`, `initAuth()`, and — if taken — the class→functional island
  form) plus an advisory lint flagging `[]`-as-redirect guard returns (the guard
  proceed sentinel is additive/back-compat, not a codemod) and dev-time
  deprecation diagnostics for soon-to-break constructs. sprig has no upgrade-tooling surface today; this
  is codemod tooling built from scratch, not an existing signal the framework
  is merely failing to surface.
- **The browserless testing module** ([§3](04-3-per-subsystem-ideal.md).11) — `@mrg-keystone/sprig/testing`
  (`testInjector`, a mock `Backend`, `runGuard`, `renderComponentToString`) is a
  net-new surface for unit-testing server logic in `deno test`; there is no
  existing capability whose silence it removes.

Most of what remains — including the build-pipeline capability gaps in [§3](04-3-per-subsystem-ideal.md).4 —
is the framework already doing the right thing and failing to say so. But a
few further items are, like the five above, genuine capability builds rather
than silence-surfacing, just smaller in scope: the one-form functional-
lifecycle-parity consolidation ([§5](06-5-build-order-max-dx-leverage-first.md) step 4 — a hard prerequisite for `logic.ts`
HMR), the state-preserving server-code-restart re-hydrate ([§3](04-3-per-subsystem-ideal.md).5), and
incremental dev rebuild ([§3](04-3-per-subsystem-ideal.md).4). Each is scoped and sequenced at its point of
use rather than inventoried here; this section names the five largest builds
on the board, not an exhaustive one. The ideal keeps every good bone, builds
the net-new items named above and at their point of use, and eliminates the
silence everywhere else that remains.

