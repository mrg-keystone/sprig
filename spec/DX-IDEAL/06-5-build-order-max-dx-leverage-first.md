## 5. Build order (max DX leverage first)

1. **The universal diagnostics layer + dev error overlay** ([§2](03-2-the-universal-dx-layer-cross-cutting-build-this-once.md)) — one build that turns
   ~25 silent-failure modes spanning specs 01–09 ([§2](03-2-the-universal-dx-layer-cross-cutting-build-this-once.md).4's inventory) into located dev
   diagnostics. Highest leverage on the board; every other item lands better on
   top of it. Cross-repo pin/contract drift ([§2](03-2-the-universal-dx-layer-cross-cutting-build-this-once.md).4, spec 09) is named here as a
   diagnostic MODE this layer's contract covers, but the drift-DETECTION work
   itself is step 11's ([§3](04-3-per-subsystem-ideal.md).9).
2. **The island lifecycle state machine + observability + `released`** ([§3](04-3-per-subsystem-ideal.md).3) — the
   single subsystem with the most, and worst, silent failures; also closes the
   unfixed stale-child hole.
3. **One render path, collapsed** ([§3](04-3-per-subsystem-ideal.md).1) — collapse `config.render`/`renderStream`/
   `modules` onto `renderer`, migrating the one live `modules` consumer in the
   same change; a breaking change ([§3](04-3-per-subsystem-ideal.md).10) — ship its `sprig migrate` codemod
   (rewrite legacy call sites onto `renderer`) and the matching dev-time
   deprecation diagnostic in this step. Sequenced before step 5 because the
   collapse touches the same `mod.ts` assembly surface the HMR work in step 5
   builds on — landing it before step 5 means state-preserving HMR is built
   against the settled `renderer` path rather than one still due to change out
   from under it. Independent of step 2's island lifecycle work, which doesn't
   touch this surface, so their relative order carries no dependency either way.
4. **The one-form island consolidation** ([§3](04-3-per-subsystem-ideal.md).3, if the fork is taken) — extend the
   functional `{setup}` form to full lifecycle parity (non-`load` trigger,
   snapshot, resolve) and ship the class→functional `sprig migrate` codemod
   ([§3](04-3-per-subsystem-ideal.md).10), flagging any hook with no functional equivalent for manual review.
   This MUST land before step 5: today's snapshot/`restoreState` path is
   CLASS-ONLY (spec 03 [§1](02-1-the-organizing-principle-split-the-error-philosophy-by-mod.md) — the functional form has no snapshot/resolve), so
   state-preserving `logic.ts` HMR can only preserve signal state across a
   functional-form re-import once this consolidation gives that form snapshot
   parity. Class-form islands keep today's full-reload HMR fallback until
   migrated.
5. **State-preserving `logic.ts` HMR + the loop's error overlay** ([§3](04-3-per-subsystem-ideal.md).5) — the
   most-felt daily surface; makes the headline feature true. Depends on step 4's
   functional-form snapshot parity for the blessed authoring form.
6. **Fail-loud security/config defaults** (grants, auth opt-in, the auth-import
   side effect gated behind `initAuth()`, the mandatory `StateService` key, the
   guard proceed sentinel, the `Backend.get` discriminated union, compose-time
   path/session validation) — cheap, and each removes a silent prod-affecting
   footgun. Three of these are breaking app-facing changes ([§3](04-3-per-subsystem-ideal.md).10): ship
   each one's `sprig migrate` codemod — the mandatory `StateService` key, the
   `Backend.get` union (`r.data!`/bare `if (r.ok)` rewrite), and `initAuth()`
   wrapping the auth import — in the SAME step as the change it covers, plus the
   matching dev-time deprecation diagnostics, so no un-migrated app upgrades into a
   silent break. The other four — grants failing closed, auth opt-in (INTERIM;
   built-in auth is slated for removal once the `Frontend` contract lands, [§3](04-3-per-subsystem-ideal.md).6 /
   06 §4), compose-time path/session validation, and the guard proceed sentinel —
   need no codemod: grants/auth/compose each add a new failure only at wiring/compose
   time on a config that was already invalid, and the guard proceed sentinel is
   additive/back-compat (existing value-comparison guards keep working; a `sprig
   migrate` advisory lint flags `[]`-as-redirect returns for manual review).
7. **`@mrg-keystone/sprig/testing`** ([§3](04-3-per-subsystem-ideal.md).11) — unblocks fast, deterministic,
   browserless tests of `resolve.ts`/guards/services/pipes; cheap relative to
   its payoff, and needed by the same agent-fleet validators the diagnostics
   layer above already serves.
8. **No-stale-artifacts + honest build/CLI verbs + `sprig doctor`** ([§3](04-3-per-subsystem-ideal.md).4/§3.5/§3.8) —
   install/build reliability; disproportionately rage-inducing when absent.
9. **Template type-checking** ([§3](04-3-per-subsystem-ideal.md).2) — the highest ceiling of the compiler-only
   work; sequence after the diagnostics floor is in.
10. **Node-level fine-grained reactivity** ([§3](04-3-per-subsystem-ideal.md).3) — the single largest runtime
   investment on the board; sequenced last of the runtime work because it's a
   real compiler/interpreter redesign (expression→node dependency edges, not a
   diagnostic or a config default) that lands better once the diagnostics
   floor and typed templates already shape the compiler surface it touches.
11. **Cross-seam drift-by-hash** ([§3](04-3-per-subsystem-ideal.md).9) **+ the naming rename** ([§3](04-3-per-subsystem-ideal.md).6) — makes the
   diamond and the composition surface honest. The `keep` → `compose` rename is breaking:
   ship its `sprig migrate` codemod (rewriting `@mrg-keystone/sprig/keep` imports
   to `/compose`, [§3](04-3-per-subsystem-ideal.md).10) in this same step, alongside the deprecated `/keep`
   re-export and its dev-time warning, per [§3](04-3-per-subsystem-ideal.md).6's coordinated timeline.

Every one of [§3](04-3-per-subsystem-ideal.md).10's ~6 breaking changes is now placed above: the render-path
collapse (step 3), the class→functional consolidation (step 4), the mandatory
`StateService` key/`Backend.get` union/`initAuth()` (step 6), and the
`keep`→`compose` rename (step 11). (The guard proceed sentinel is additive/back-compat —
an advisory `[]`-return lint in step 6, not a breaking codemod.)

