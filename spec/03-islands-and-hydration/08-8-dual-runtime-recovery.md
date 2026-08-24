## 8. Dual-runtime recovery

The runtime-recovery leg of **invariant 1** — one runtime copy per document
([00-overview §6](../00-overview/06-the-invariants-that-define-the-system-full-versions-in-each-.md)).
Detection/stamping is core.ts's side of the invariant
([01 §7](../01-core-runtime/07-7-dual-runtime-detection-core-ts-273-292.md), `detectDualRuntime()`);
this fragment is the recovery side it links back to.

`maybeRecoverDualRuntime()` (hydrate.ts:389-400) is invoked from every
hydration failure (`hydratePending`, hydrate.ts:378) and every island
chunk-load failure (`loadIsland`, hydrate.ts:491) — i.e. on ANY error on
either path, dual-runtime or not. Build-side twin: `assertSingleRuntime`
(spec 04).

| Condition | Writes `__sprig_dual_reload` | Reloads | Notes |
|---|---|---|---|
| `__sprig_runtime_dual` ([01 §7](../01-core-runtime/07-7-dual-runtime-detection-core-ts-273-292.md)) NOT set — the common case: an ordinary hydration/chunk-load failure with no dual-runtime skew | no | no | pass-through — returns immediately, no write, no log |
| flag set, normal mode, guard absent | yes | yes, once | `console.error` logged, then `location.reload()` |
| flag set, guard already present (this session already spent its one reload) | no | no | silent — no log, no further write |
| flag set, privacy mode (sessionStorage unavailable/throws) | no — the write attempt throws; caught | no | silent — no exception escapes, no log |

Because `maybeRecoverDualRuntime()` fires on every hydration/chunk-load
error and dual-runtime skew is the rare case, the overwhelming majority of
calls land on the first row: **a no-op.**

**Why sessionStorage, not the `globalThis` flag, is the guard:** `detectDualRuntime()`
re-stamps `__sprig_runtime_dual` as a module-init side effect on EVERY load
([01 §7](../01-core-runtime/07-7-dual-runtime-detection-core-ts-273-292.md)) — a
stale/dual bundle keeps loading its second copy, so a naive "reload whenever flagged"
would re-detect the flag and reload forever. The `globalThis` flag itself doesn't
survive the reload, so it can't break that loop. A sessionStorage key written before
the reload and checked after does persist across it — the only thing that makes
recovery strictly one-shot-per-session.

**Why privacy mode never reloads:** in privacy/incognito, sessionStorage may throw or
be unavailable, so the one-shot guarantee can't be enforced there. The policy trades a
visibly-broken-DI page (console error, dead islands — user-recoverable) for avoiding
the far worse infinite reload loop: disable the reload rather than loop unguarded.

**Acceptance criteria (recovery side):**
- `__sprig_runtime_dual` not set → `maybeRecoverDualRuntime()` returns with no
  sessionStorage write, no reload, and no log — the majority-case no-op.
- Flag set, normal mode, guard absent → writes `__sprig_dual_reload`, logs one
  `console.error`, reloads exactly once.
- Flag set, guard already present → returns with no reload and no further write.
- Flag set, privacy mode (sessionStorage throws or is unavailable) → returns with no
  reload and **no exception escapes** the caller.

**Worked trace — a stale/dual bundle across two loads:**

*Load 1* (a redeploy just shipped; the browser still holds an old cached document
referencing the previous build's stable-named asset URLs):
1. core.ts's module-init `detectDualRuntime()`
   ([01 §7](../01-core-runtime/07-7-dual-runtime-detection-core-ts-273-292.md)) finds a
   second copy of the runtime already loaded in this document, stamps
   `globalThis.__sprig_runtime_dual = true`, and logs its `console.error`
   ("two copies of the runtime" / "stale cached bundle").
2. Hydration throws — the second copy broke registry/symbol identity, so DI is dead.
   The catch in `hydratePending` calls `maybeRecoverDualRuntime()`.
3. Flag is set, `sessionStorage["__sprig_dual_reload"]` is absent → row 2 of the table
   above fires: the guard key is written, `console.error` logs the recovery attempt,
   `location.reload()` fires.

*Load 2* — the outcome now depends on WHY the dual state happened:
- **Self-heal (the intended outcome — a transient deploy skew):** the reload fetches a
  fresh document. Its content-addressed asset URLs now resolve to the new build's
  single `?v=` hash ([04 §4](../04-build-pipeline-and-artifacts/04-4-versioning-caching-contract.md)),
  so only ONE copy of the runtime loads. `detectDualRuntime()` returns `false` — no
  stamp, no console error. Hydration succeeds, DI works, and `maybeRecoverDualRuntime()`
  is never even called (nothing failed to trigger it).
- **Persistent dual (the bounded fallback — a genuinely broken build that keeps
  shipping two copies):** the reload still loads two runtime copies.
  `detectDualRuntime()` re-stamps the flag and re-logs. Hydration throws again →
  `maybeRecoverDualRuntime()` runs: flag set, but `sessionStorage["__sprig_dual_reload"]`
  now IS present (it survived the reload) → row 3 fires: no reload. The page renders
  broken-DI, bounded to the ONE reload already spent — it does not loop.

This is what makes sessionStorage, not the `globalThis` flag, the guard, made concrete:
`globalThis.__sprig_runtime_dual` does not survive the reload — Load 2 starts a fresh
JS context where it's unset until (and unless) detection re-stamps it, so checking IT
after the reload can't distinguish "already reloaded" from "first failure this session."
`sessionStorage["__sprig_dual_reload"]`, written before Load 1's reload, is still
present when Load 2 checks it (same origin, same tab session) — that persistence is
what lets recovery tell the two cases apart and stay one-shot.

**What "recovered" looks like:** the guard key is `sessionStorage["__sprig_dual_reload"]`
(hydrate.ts:393-394), and it permits exactly one reload per session. The reload's
purpose (hydrate.ts:383-388) is to let a fresh document resolve to one consistent
build, so the INTENDED and primary outcome is the self-heal traced above: the reloaded
page hydrates clean, no console error, DI works, no second reload attempted. Only a
build that is genuinely broken — not merely deploy-skewed — hits the bounded fallback:
that reloaded page still renders with the detection console error
([01 §7](../01-core-runtime/07-7-dual-runtime-detection-core-ts-273-292.md)) and broken
DI, and does NOT reload again, because the guard caps the one reload it already spent.
Privacy mode: zero reloads, same broken-DI render as the persistent-fallback case.

**Test coverage:** `dual-runtime.test.ts` ([01 §7](../01-core-runtime/07-7-dual-runtime-detection-core-ts-273-292.md))
today pins only the detection side (`detectDualRuntime()`) — the reload/no-reload
behavior described above is not yet exercised by a hydrate-side case. That case
belongs in the same file: a `maybeRecoverDualRuntime()` test asserting the
sessionStorage guard makes the reload one-shot, and a second case asserting privacy
mode (sessionStorage throwing/unavailable) falls back to zero reloads with no
exception escaping. Until that case lands, treat this fragment as the recovery
contract `dual-runtime.test.ts` is missing, not as an open question — the behavior
itself is decided; only its pin is outstanding.

