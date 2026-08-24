# 05 — The sprig CLI, dev loop, and HMR

> Subject: `framework/cli.ts` (~2,200 lines — the `sprig` CLI); `dev.ts` is the
> dev server and `hmr.ts` is the client-side HMR runtime (both under
> `framework/.sprig/compiler/`).
>
> The architectural spine: `cli.ts` is ONE `switch`-on-`Deno.args` dispatcher
> fronting ~10 commands, all sharing a self-location layer —
> `installRoot()`, stable-port hashing (`appPort`/`freePort`), and
> git-anchoring (`gitRepoRoot`/`repoKey`) — full contract in
> [§1](01-1-entry-and-self-location.md). Two commands are specced in depth as
> architecture: `sprig dev`, a supervisor→child→server three-layer HMR loop
> ([§4](04-4-sprig-dev-the-three-layer-architecture.md)/
> [§6](06-6-dev-server-hmr-dev-ts-hmr-ts.md)), and `sprig build`, rune
> composition emission ([§5](05-5-sprig-build-rune-composition-emission.md)).
> `sprig init`'s scaffold shape also gets its own contract fragment
> ([§3](03-3-sprig-init-the-scaffold-contract.md) — routed by the OWNS note
> below). The rest — `clean`, `check`, `isolate`, `serve`, `stop`,
> `install`/`update`, `-v`/`--version` — are thin index rows in
> [§2](02-2-command-surface.md).
>
> This subsystem OWNS: the `sprig init` scaffold shape
> ([§3](03-3-sprig-init-the-scaffold-contract.md)) — a cross-repo contract
> co-owned with 09
> [§2](../09-ecosystem-contracts/02-2-sprig-s-spec-obligations.md)/
> [§4](../09-ecosystem-contracts/04-4-locked-invariants-sprig-s-half.md), which
> rune's `rune init` overlays; the dev supervisor + registry + server-side HMR
> wire ([§4](04-4-sprig-dev-the-three-layer-architecture.md)/
> [§6](06-6-dev-server-hmr-dev-ts-hmr-ts.md)); and the rune composition
> emission ([§5](05-5-sprig-build-rune-composition-emission.md)). It
> DELEGATES: per-event HMR client behavior to
> [03 §9](../03-islands-and-hydration/09-9-hmr-hooks-in-the-client-runtime.md),
> the `static/` artifact set to spec 04, isolate-workbench launch to spec 07,
> and install/update to spec 08.
>
> 05 owns no system invariant in full, but must preserve two it participates
> in: invariant 4 — byte-identity dev↔prod, HMR gated only by the runtime
> `cfg.hmr` flag (`hmr-config-gate.test.ts`; owned by spec 04) — and invariant
> 7 — the `sprig init` scaffold is sprig's half of the cross-repo contract
> (owned by spec 09).
>
> Pinned by `dev-hmr-reldir.test.ts`, `hmr-config-gate.test.ts`.

