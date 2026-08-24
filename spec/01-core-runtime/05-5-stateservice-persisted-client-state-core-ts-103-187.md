## 5. StateService — persisted client state (core.ts:103-187)

- Subclass with serializable fields; mark `@Injectable({providedIn:"root", scope:"both"})`.
- Storage: `localStorage["sprig:state:" + (static key ?? constructor.name)]`. A **static
  `key` is required in practice** — the production minifier mangles class names
  (state.test.ts:82-96).
- Client-only: every browser instance registers into module-global `LIVE_STATES`;
  server-side persist/restore/tracking are no-ops (gated on `typeof localStorage`).

### Method behavior

Instance methods live on each `StateService` object. Two module-level free functions
— `persistState()` and `restoreState()` — sit alongside the class and iterate every
registered instance; these are what `hydrate.ts` and nav call, never the instance
methods directly.

| method | scope | when invoked | effect | guard / side-condition |
| --- | --- | --- | --- | --- |
| constructor | instance | every browser instantiation (client-only) | registers the instance into module-global `LIVE_STATES`; queues `queueMicrotask(() => this.restore())` so field initializers run first | this queued restore and the synchronous-bootstrap restore below race through the same `#restored` gate — whichever reaches it first runs the overlay, the other becomes a no-op |
| `restore()` | instance | called by the module-level `restoreState()` (once per live instance) synchronously on client bootstrap before first paint (state.test.ts:98-120); also fires via the constructor's queued microtask, and again whenever `restoreState()` runs on every later island hydration that touches this instance (including deferred triggers) | overlays persisted `localStorage["sprig:state:" + key]` onto the instance's current data fields — skipping `__proto__` and any key whose current value is a function (state.test.ts:126-151); corrupt JSON leaves current state unchanged | **Restore-once guard:** `#restored` is set BEFORE the read, so the first call to reach it — synchronous-bootstrap or constructor-queued, whichever wins the race — locks out every later call, even one against empty localStorage. Without this, a late-hydrating island would re-overlay stale localStorage onto the shared root singleton, reverting live mutations (restore-once-guard.test.ts:1-11) |
| `persist()` | instance | called by the module-level `persistState()` (once per live instance) on each navigation + pagehide | serializes the instance's CURRENT in-memory data fields to `localStorage["sprig:state:" + key]` | none — always writes whatever is currently in memory, live mutations included |
| `reset()` | instance | called explicitly by caller code to restore defaults | constructs a fresh probe instance via `new (this.constructor)()` to obtain default field values, deletes the fresh probe from `LIVE_STATES`, deletes all of the entry's own keys, applies the probe's defaults onto the entry via `Object.assign`, clears `#restored`, then removes the saved copy with `localStorage.removeItem(this.storageKey())` | **the only method that reopens the restore-once guard, and the only one that clears the saved copy.** The fresh probe's own constructor (row above) already added it to `LIVE_STATES` and queued a restore of its own; `reset()` immediately deletes it so no orphan probe sharing this instance's `storageKey` stays registered — an orphan left in `LIVE_STATES` would, on the next `persistState()`, write its (default) fields to `sprig:state:<key>` and overwrite the real instance's saved state. The `removeItem` is the second half of reset's contract — "return to defaults AND clear the saved copy" — and matters precisely because `#restored` is cleared in the same call: without it, the next restore would re-overlay the stale saved blob and silently revert the reset. Neither state.test.ts nor restore-once-guard.test.ts pins `LIVE_STATES` membership after `reset()` — this is an unguarded correctness detail a refactor must preserve |
| `persistState()` | module-level | client calls on each navigation + pagehide | `for (const s of LIVE_STATES) s.persist()` — persists every live instance | none — delegates entirely to each instance's `persist()` |
| `restoreState()` | module-level | called synchronously on client bootstrap before first paint, and again on every later island hydration (including deferred triggers) | `for (const s of LIVE_STATES) s.restore()` — restores every live instance | none at this level — the per-instance restore-once guard (`restore()` row above) is what makes repeated calls safe |

**Worked example — restore-once across two islands sharing one root singleton:** a
`CounterState extends StateService` instance is root-singleton scoped; two islands on
the same page both inject it. `localStorage["sprig:state:CounterState"]` holds
`{count: 5}` from a prior session.

1. Island A hydrates first. Its hydration calls the module-level `restoreState()`,
   which loops `LIVE_STATES` and calls this instance's `restore()`. That call reaches
   the guard: `#restored` is `false`, so it is set to `true` immediately — BEFORE the
   localStorage read — then the read proceeds and overlays `count: 5` onto the
   instance. (Setting the flag before the read, not after, is what makes the guard
   atomic against a second call arriving before the first read completes.)
2. The user interacts, mutating `count` to `7` via a signal write.
3. Island B — a deferred-trigger island lower on the page, sharing the same
   root-singleton `CounterState` object — hydrates, and its hydration also calls the
   module-level `restoreState()`, which again calls this instance's `restore()`.
   `#restored` is already `true`, so this call is a no-op: `count` stays `7`, not
   reverted to the stale `5` still sitting in localStorage.
4. The user navigates away. The module-level `persistState()` fires on navigation,
   looping `LIVE_STATES` and calling this instance's `persist()`, which serializes the
   CURRENT in-memory state — `{count: 7}` — to `localStorage["sprig:state:CounterState"]`,
   overwriting the stale `5`.

This is the trace [03 §4](../03-islands-and-hydration/04-4-hydration-order-pinned-by-hydrate-restore-order-test-ts.md)'s
hydration-order example stops short of — that trace covers only the FIRST hydration to
touch a StateService instance; this is the second (or Nth) hydration against an
already-restored instance.

**Acceptance criteria (pinned by state.test.ts + restore-once-guard.test.ts):**

- A restore after a live mutation to the shared root-singleton does not revert the
  mutation — restore-once guard, restore-once-guard.test.ts.
- A persisted blob carrying `__proto__` or a function-valued key never overwrites those
  on the instance — pollution guard, state.test.ts:126-151.
- Corrupt JSON leaves current state unchanged — pollution guard, state.test.ts.
- A minified build restores/persists to the same key as source (a static `key` survives
  minification; `constructor.name` does not) — static-key requirement,
  state.test.ts:82-96.

