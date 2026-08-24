# 01 — Core runtime: signals, DI, routing, bootstrap SSR, state, auth

> Subject: `framework/.sprig/core.ts` (~43KB — THE public API of `@mrg-keystone/sprig`;
> `deno.json` maps both the import alias and the JSR `"."` export to it), plus `auth.ts`
> (re-exported through core) and `spec-root.ts`. Version at time of writing:
> `0.20.36-beta.1`. Decorators: `experimentalDecorators` + `emitDecoratorMetadata` are ON;
> the lib set includes both `deno.ns` and `dom` — core.ts compiles against BOTH runtimes
> and reaches browser APIs via `globalThis` casts only.
>
> This subsystem owns invariant 2 in full, plus the detection leg of invariant 1. **DI
> never crosses the wire** — `inject()` is synchronous-only, enforced by the injector's
> scope-guard throw — is invariant 2, full contract in
> [§2](02-2-injector-semantics-core-ts-190-256.md). The detection leg of **one runtime
> copy per document** — `detectDualRuntime()`'s module-init stamp — is invariant 1, full
> contract in [§7](07-7-dual-runtime-detection-core-ts-273-292.md). Invariant 1's other
> two legs live elsewhere: the runtime-recovery leg (the client's one-shot recovery
> reload) is spec 03 §8, and the build-time + config-time defenses
> (`assertSingleRuntime`, forced import map / workspace hoisting) are spec 04.
>
> Pinned by `guards.test.ts`, `routing-chain.test.ts`, `state.test.ts` +
> `restore-once-guard.test.ts`, `dual-runtime.test.ts`, and the to-add `injector.test.ts`
> — full list in
> [§9](09-9-behavioral-contracts-pinned-by-tests-must-survive-a-refact.md).

