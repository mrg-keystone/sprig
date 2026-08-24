## 9. Behavioral contracts pinned by tests (must survive a refactor)

| test file | pinning status | contracts pinned | full contract § |
|---|---|---|---|
| `guards.test.ts` | present | guard proceed/redirect, ordering (first-redirect-wins), injector sharing between a guard and resolve, and 405-before-guards — grants NOT covered | [§3](03-3-routing-semantics-core-ts-486-644.md) (matching/guards), [§4](04-4-bootstrap-request-pipeline-core-ts-709-850.md) (405-before-guards, throwing-guard → 500) |
| `routing-chain.test.ts` | present | layout chain assembly, grant chain assembly (`requiredGrant` → `grants[]`), and nav derivation | [§3](03-3-routing-semantics-core-ts-486-644.md) (layout/matching), [§4](04-4-bootstrap-request-pipeline-core-ts-709-850.md) (session threading) |
| `state.test.ts` + `restore-once-guard.test.ts` | present | the "Acceptance criteria" block only — restore-once guard, pollution guard, static-key requirement | [§5](05-5-stateservice-persisted-client-state-core-ts-103-187.md) |
| `dual-runtime.test.ts` | present | the "Acceptance criteria" block — server no-op, first-load stamp, dual-load stamp + flag, per-load `console.error`, idempotent re-stamp | [§7](07-7-dual-runtime-detection-core-ts-273-292.md) |
| `injector.test.ts` *(to add)* | **UNPINNED** | the three `#instantiate` acceptance criteria — invariant 2, "DI never crosses the wire" (the one core-runtime item on DX-IDEAL §6's must-not-change protect list) | [§2](02-2-injector-semantics-core-ts-190-256.md) |

**Coverage holes** (aggregated):
- **Invariant 2 (DI never crosses the wire) is UNPINNED** until `injector.test.ts` lands —
  a NEW file, not a gap in an existing one: no existing suite covers the scope-boundary
  throw or the presence-based cache (`guards.test.ts` only covers injector *sharing*
  between a guard and resolve, not the scope-boundary throw or the cache).
- **`LIVE_STATES` membership after `reset()`** ([§5](05-5-stateservice-persisted-client-state-core-ts-103-187.md))
  is an unpinned correctness detail — neither `state.test.ts` nor `restore-once-guard.test.ts`
  asserts it; a refactor must preserve the behavior §5 describes with no test to catch a
  regression.
- **Grant enforcement (`verifyGrant` proceed/deny/throw) is UNPINNED by any suite**
  ([§3](03-3-routing-semantics-core-ts-486-644.md)) — `routing-chain.test.ts` pins grant
  *chain assembly* (`requiredGrant` → `grants[]`), but no suite asserts `verifyGrant` is
  invoked or that it proceeds/denies/throws correctly. This is the highest-consequence hole
  in this table: an absent `verifyGrant` silently drops enforcement for routes that declared
  a `requiredGrant`, and no test would catch a regression that reintroduced or widened that
  gap.
- All other rows above are confirmed present.

See [§10](10-10-refactor-targets-tensions-observed.md) for the inverse list: the `status`
side-channel, the sync-only `inject()` model, `seedTokenFromUrl`'s module-init side
effect, and the `Backend` throwing-factory landmine are tensions to design OUT of the
system — they must NOT get a pinning test.

