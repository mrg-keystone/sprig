## 10. Contract checklist for a refactor (pinning status per item)

This is the PINNING-TEST ROSTER for invariant 6, not its full-version home:
invariant 6's ORDER clause is stated in full at
[§4](04-4-hydration-order-pinned-by-hydrate-restore-order-test-ts.md) and its
PRESERVE (pin + shell + rescan) clause at
[§6](06-6-nested-islands-the-zz-contracts.md) — rows 2 and 5 below point at
each in turn.

Pinning tier key (owned by
[00-overview §7](../00-overview/07-how-to-verify-claims-in-these-specs.md)):
(a) = pinned by a dedicated named test, present and runnable today; (b) =
source-anchor only (hydrate.ts) — no dedicated test yet; (c) = bug-ID
provenance, untested — falls back to its (b) family/anchor.

| # | contract (what to preserve) | pinning tier | pinned by | full contract § |
|---|---|---|---|---|
| 1 | Single-runtime-copy invariant: build gate blocks shipping a dual bundle; one-shot session-guarded client reload recovers when it still occurs. | (b) | this file's leg is recovery (`maybeRecoverDualRuntime()`, hydrate.ts:389-400) — file-targeted at `dual-runtime.test.ts`, not yet a present case, per §8; detection (`detectDualRuntime()`) is tier (a), pinned by `dual-runtime.test.ts`, owned by [01 §7](../01-core-runtime/07-7-dual-runtime-detection-core-ts-273-292.md); the build gate (`assertSingleRuntime`) is the Single-core gate owned by [spec 04 §1](../04-build-pipeline-and-artifacts/01-1-pipeline-buildclient-srcdir-outdir-build-ts-63-298.md) (step 4; build.ts:244-251/551-607), pinned by `build-single-core.test.ts` — not pinned by `dual-runtime.test.ts` | [§8](08-8-dual-runtime-recovery.md) |
| 2 | Hydration order: setup → snapshot → sync restoreState → paint → browser hook — invariant 6's ORDER clause. | (a) | `hydrate-restore-order.test.ts` (file, present) | [§4](04-4-hydration-order-pinned-by-hydrate-restore-order-test-ts.md) ([00-overview §6](../00-overview/06-the-invariants-that-define-the-system-full-versions-in-each-.md) summarizes it) |
| 3 | Delegation reaches every same-base handler. | (b) | `event-delegation` test family — not yet landed | [§5](05-5-reactive-update-model.md) |
| 4 | Chord modifiers filter delegated dispatch: e.g. `keyup.control.enter` fires only on ctrl+enter, per the KEY_ALIAS/MOD_FLAG tables. | (b) | `event-delegation` test family — not yet landed | [§5](05-5-reactive-update-model.md) |
| 5 | Preserve: a parent island's re-render never destroys a live hydrated child island — invariant 6's PRESERVE clause. | (b) | `zz-nested-island-*` test family — not yet landed | [§6](06-6-nested-islands-the-zz-contracts.md) |
| 6 | Shell/late-mount: an unloaded child renders as an empty-body island shell on the parent's re-render; a genuinely-new data-driven child late-mounts from those props via `rescanIslands`. | (b) | `zz-nested-island-*` test family — not yet landed | [§6](06-6-nested-islands-the-zz-contracts.md) |
| 7 | Resolve precedence: a child is resolved for (page, selector) via the 4-rung order page-local static → global static → loaded island → known-but-unloaded island. | (c) | bug AJ (an island fell through to an inert bare custom element when the unloaded-island rung was missing); falls back to `zz-nested-island-*` test family — not yet landed | [§6](06-6-nested-islands-the-zz-contracts.md) |
| 8 | Props-bridge-skew: props-bridge and blank-text nodes are filtered at host level before positional alignment, so they can't desync the positional match. | (c) | bug B3; falls back to `zz-nested-island-*` test family — not yet landed | [§6](06-6-nested-islands-the-zz-contracts.md) |
| 9 | Instance-path resolution keys: multi-instance async resolution is keyed by instance path (`path + "/" + node.startIndex`), not bare AST node, so two wrappers around one island don't leak each other's scope/snapshot. | (c) | bug AB; falls back to `zz-nested-island-*` test family — not yet landed | [§6](06-6-nested-islands-the-zz-contracts.md) |
| 10 | Soft-nav skip table: not interceptable / hash-only / download / form POST / reload / URL parse failure / cross-origin / out-of-base / reserved prefix / same-path query-only — the browser handles all of these, soft-nav handles none. | (b) | `soft-nav-*` test family — not yet landed | [§7](07-7-soft-navigation-hydrate-ts-500-727.md) |
| 11 | Reserved prefixes are boundary-respecting: `/apixyz` is not under the reserved prefix `/api`. | (b) | `soft-nav-*` test family — not yet landed | [§7](07-7-soft-navigation-hydrate-ts-500-727.md) |
| 12 | ANY failed commit test (non-ok, redirected, non-HTML content-type, a transport failure, or an empty outlet chain — guard redirects included) → full-nav fallback. | (b) | `soft-nav-*` test family — not yet landed | [§7](07-7-soft-navigation-hydrate-ts-500-727.md) |
| 13 | Outlet-level diffing: current/fetched `<sprig-outlet>` chains are walked outermost→inner, positionally paired, and swapped only at the shallowest differing position. | (b) | `soft-nav-*` test family — not yet landed | [§7](07-7-soft-navigation-hydrate-ts-500-727.md) |
| 14 | Outside-outlet state preservation: islands outside the swapped outlet stay mounted, state intact. | (b) | `soft-nav-*` test family — not yet landed | [§7](07-7-soft-navigation-hydrate-ts-500-727.md) |
| 15 | `cfg.base === ""` is a legitimate value (root mount / isolate workbench) — never treat `""` as unset. | (b) | `island-*-scope` test family — not yet landed | [§3](03-3-client-boot-trigger-arming.md) |
| 16 | Snapshot transfer surface is JSON-serializable own fields + signal values only (drops Set/Map/non-finite/functions silently). | (b) | `hydrate-*` test family — not yet landed | [§2](02-2-the-ssr-client-props-contract.md) |

> **1 of 16 items pin to a runnable suite today**: row 2 in full
> (`hydrate-restore-order.test.ts`, present). `hydrate.ts` itself is the
> shipped client runtime (~54KB; §1–§9 pin lines inside it) — the gap isn't
> the runtime, it's that no client-side test file for the five families
> (`zz-nested-island-*`, `event-delegation`, `soft-nav-*`, `island-*-scope`,
> `hydrate-*`) has landed yet, and row 1's recovery case
> (`maybeRecoverDualRuntime()`) hasn't been added to `dual-runtime.test.ts`
> either — that file today pins only detection (`detectDualRuntime()`, owned
> by 01 §7); the build gate (`assertSingleRuntime`) is the Single-core gate
> owned by spec 04 §1 (step 4), with its own coverage tracked via
> `build-single-core.test.ts`, not pinned by `dual-runtime.test.ts`.
> Compiler/client suites — including
> the existing `hydrate-restore-order.test.ts` and these five families once
> they land — live in `framework/.sprig/compiler/` alongside `hydrate.ts`;
> `framework/.sprig/` itself holds only the server-core suites
> (`dual-runtime.test.ts`, `guards.test.ts`, `routing-chain.test.ts`,
> `state.test.ts`, `restore-once-guard.test.ts`). Promote a row to (a) the
> day its suite lands.

### Known gaps — do NOT pin

The inverse of the checklist above: these are bugs/limitations to design out, not
contracts to preserve. Writing a pinning test for any of these freezes the bug as
permanent behavior — none of them belongs in the list above, ever.

- Client `output()` unimplemented: cross-island client outputs are a no-op stub
  ([§1](01-1-the-island-model.md)).
- Data-driven nested-island removal leaves a pinned stale host: the morph pins
  live child hosts even when the parent stops rendering them
  ([§6](06-6-nested-islands-the-zz-contracts.md)).
- Whole-subtree re-render+morph is the update granularity: a signal write
  re-renders the whole island subtree, never just the node(s) it feeds
  ([§5](05-5-reactive-update-model.md)).
