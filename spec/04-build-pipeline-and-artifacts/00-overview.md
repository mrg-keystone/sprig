# 04 — Build pipeline and the static artifact contract

> Subject: `framework/.sprig/compiler/build.ts` (~37KB) and the `static/` output set.
> `buildClient(srcDir, outDir)` is ONE 8-step path — the same steps run whether
> `SPRIG_DEV` is set or not, so there is no dev/prod branch — emitting a CLOSED,
> enumerable set of `static/` artifacts
> ([§1](01-1-pipeline-buildclient-srcdir-outdir-build-ts-63-298.md),
> [§2](02-2-the-artifact-set-static.md)). There is NO manifest file: SSR recomputes
> the content hash on demand ([§1](01-1-pipeline-buildclient-srcdir-outdir-build-ts-63-298.md).8).
>
> This subsystem owns invariant 4 in full: **byte-identity** — there is no dev/prod
> variant, guaranteed by three mechanisms working together (a single build path, the
> template AST always baked, dev freshness carried entirely by runtime flags/env) —
> full contract in [§1](01-1-pipeline-buildclient-srcdir-outdir-build-ts-63-298.md).
> It also owns invariant 5 in full: **content-addressed caching** — `?v=` is a pure
> function of the served bytes, so far-future `immutable` is sound only because a
> byte change always moves the URL — full statement in
> [§4](04-4-versioning-caching-contract.md). And it owns the build-time +
> config-time defense legs of invariant 1 (one runtime copy per document):
> `assertSingleRuntime`'s single-core gate and the forced import map, both in
> [§1](01-1-pipeline-buildclient-srcdir-outdir-build-ts-63-298.md) — invariant 1's
> detection leg is [01 §7](../01-core-runtime/07-7-dual-runtime-detection-core-ts-273-292.md),
> its runtime-recovery leg is
> [03 §8](../03-islands-and-hydration/08-8-dual-runtime-recovery.md).
>
> Subsystem boundary: 04 COMPUTES and STAMPS the version hash
> ([§4](04-4-versioning-caching-contract.md)) — serve-side enforcement of
> `immutable`/`no-cache` on that hash is
> [06 §5](../06-keep-serving-composition/05-5-asset-serving-serveasset-hardening-contract.md).
> The emitted artifacts are consumed by the client/SSR runtime specced in 02/03.
> `build-info.json` lands in `static/` too, but this pipeline does NOT emit it — it's
> written by a separate deploy/stamp step
> ([§1](01-1-pipeline-buildclient-srcdir-outdir-build-ts-63-298.md)'s closing note,
> [§2](02-2-the-artifact-set-static.md)'s catalog).
>
> Pinned by `build-single-core.test.ts`, `base-href-prefix.test.ts`, and the artifact
> consumers in `mod.ts`/`hydrate.ts`/`packages/keep`.

