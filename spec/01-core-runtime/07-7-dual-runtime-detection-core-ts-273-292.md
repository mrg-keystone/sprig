## 7. Dual-runtime detection (core.ts:273-292)

Two copies of the runtime in one document silently break all DI (registry/symbol
identity). `detectDualRuntime()` runs as a module-init side effect, one call per load:

| Condition | Stamps | Returns | Logs |
|---|---|---|---|
| Server (no `document`) | none | `false` | no |
| Browser, first copy | `globalThis.__sprig_runtime` | `false` | no |
| Browser, second copy | `globalThis.__sprig_runtime_dual` | `true` | `console.error`, once per load (message names "two copies" / "stale cached bundle") — no dedup guard, so every load where a second copy is detected re-emits the `console.error` |

This module owns detection and stamping only. The reload / one-shot-per-session /
privacy-mode semantics that consume the `__sprig_runtime_dual` flag are owned by
`../03-islands-and-hydration/08-8-dual-runtime-recovery.md` (spec 03 §8,
`maybeRecoverDualRuntime()`) — see that fragment for the recovery mechanism. Pinned by
dual-runtime.test.ts.

**Acceptance criteria (detection side, `dual-runtime.test.ts`):**
- Server-side call returns `false` and leaves both `__sprig_runtime` and
  `__sprig_runtime_dual` unset.
- First browser-context load sets `__sprig_runtime` only and returns `false`.
- A later load in the same document sets `__sprig_runtime_dual` and returns `true`.
- `console.error` fires once per load whenever a second copy is detected — not once per
  session; repeated loads with a second copy present each re-emit it.
- Re-stamping on repeated inits is idempotent (re-running detection with the flags
  already set does not throw or corrupt the stamped values).

