## 10. Refactor targets / tensions observed

Observed as-built core-runtime tensions. Most hand off to their DX-IDEAL resolution —
[§3.1](../DX-IDEAL/04-3-per-subsystem-ideal.md) owns items 1, 3, and 4; the analysis and
fork is worked there, not re-derived here — but items 2 and 5 are still open, with no
DX-IDEAL section owning a resolution yet.

1. Legacy `AppConfig` members (`modules`, `render`, `renderStream`) interleave with the
   modern `renderer` — remove or formalize. The precedence mechanics themselves (which
   source wins at each step) are specced in full by spec 01
   [§4](04-4-bootstrap-request-pipeline-core-ts-709-850.md) (step 7's resolve override,
   step 10's render-priority table) and aren't restated here. Owned by
   [DX-IDEAL §3.1](../DX-IDEAL/04-3-per-subsystem-ideal.md) "One render path"
   [CLEAR WIN, migration-gated]: collapse the legacy `config.render`/`renderStream`/
   `modules` precedence into `renderer`, throwing at bootstrap if both a legacy
   callback and a `renderer` are supplied. `modules` has a LIVE consumer — the isolate
   workbench's generated `manifest.gen.ts` is exactly `{ routes, modules: {load:
   {resolve}} }` (spec 07 [§2](../07-isolate-workbench/02-2-the-isolate-cli-cli.md)) —
   and that owning bullet's migration gate is exactly this: the one live `modules`
   consumer migrates in the same change.
2. `status` as mutable injector-root state is a side-channel; consider a return value.
   Open — no DX-IDEAL section owns this resolution; `ResolveCtx` gains a `setStatus`
   convenience (DX-IDEAL §3.1) but that's still a mutation, not the return-value
   redesign this item names.
3. `inject()`'s sync-only global-`current` model is subtle (guards individually wrapped
   as a workaround); an explicit context-passing design would remove a failure class.
   Owned by [DX-IDEAL §3.1](../DX-IDEAL/04-3-per-subsystem-ideal.md) "`inject()` after
   `await` explains itself": the clear-win names the true error, and its [FORK] —
   pass the injector on the ctx (`ResolveCtx.inject`) instead of an ambient global —
   is exactly this context-passing design; the fork (whether to build it) is worked
   there, not here.
4. Auth's `seedTokenFromUrl()` module-init side effect makes importing the auth module
   non-neutral — it rewrites the URL and fires a network call just from being imported;
   neutralize it by moving it behind an explicit `initAuth()` call (DX-IDEAL §3.1).
   `detectDualRuntime()` is NOT the same kind of tension and must STAY unconditional at
   module-init: it is a DI-integrity guardrail that works only by running at every
   copy's import time, and gating it would reintroduce the silent dual-runtime DI
   failure (DX-IDEAL §3.1; spec 01 §7).
5. The `Backend` throwing-factory landmine is intentional but only documented in the
   throw message. Open — no DX-IDEAL section owns this resolution.
