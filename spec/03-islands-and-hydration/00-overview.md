# 03 — Islands and the client runtime (hydrate.ts)

> Subject: `framework/.sprig/compiler/hydrate.ts` (~54KB, the client runtime),
> `island.ts`, `island-infer.ts`, and the SSR-side island emission in
> `render.ts`/`mod.ts`. `hydrate.ts` is the sole browser-shipped module of this
> subsystem — and it re-renders islands through the SAME isomorphic interpreter
> spec 02 uses for SSR, not a second rendering path: [§5](05-5-reactive-update-model.md)'s
> reactive update model is that same server render loop, re-run per-island on the
> client.
>
> This subsystem owns invariant 6 in full: its ORDER clause — hydration order
> setup → snapshot → sync restoreState → paint → browser hook — is stated in
> full at [§4](04-4-hydration-order-pinned-by-hydrate-restore-order-test-ts.md);
> its PRESERVE clause — a parent island's re-render never destroys a live child
> (pin + shell + rescan) — at [§6](06-6-nested-islands-the-zz-contracts.md). It
> also owns the runtime-recovery leg of invariant 1 — the client's one-shot
> recovery reload ([§8](08-8-dual-runtime-recovery.md)) — whose detection leg is
> [01 §7](../01-core-runtime/07-7-dual-runtime-detection-core-ts-273-292.md) and
> whose build-time + config-time defense legs are spec 04.
>
> Pinned by the `zz-nested-island-*`, `hydrate-*`, `event-delegation`,
> `soft-nav-*`, and `island-*-scope` tests — full roster in
> [§10](10-10-contract-checklist-for-a-refactor.md).

