## The invariants that define the system (full versions in each spec)

1. **One runtime copy per document.** DI/registry identity breaks with two — defended
   at build (`assertSingleRuntime`), config (forced import map, workspace hoisting),
   and runtime (one-shot recovery reload). (specs 01 [§7](../01-core-runtime/07-7-dual-runtime-detection-core-ts-273-292.md), 04, 03 §8)
2. **DI never crosses the wire.** `Backend` is server-scoped; islands get data as
   serialized inputs or fetch `/api/*`. `inject()` is synchronous-only — crossing it
   would leak server-only bindings (DB clients, secrets) toward the client instead of
   dispatching to an unbound factory; enforced by the injector's scope-guard throw
   (pinned by `injector.test.ts`, not yet landed). (spec 01 [§2](../01-core-runtime/02-2-injector-semantics-core-ts-190-256.md))
3. **Escape/entity discipline** in render: author text trusted, runtime values
   escaped, entity decode single-pass and non-throwing — unescaped runtime values
   would let user-controlled data inject markup/script (XSS). (spec 02 [§4](../02-template-compiler/05-4-render-ts-ssr-semantics.md))
4. **The dev bundle IS the prod bundle** — byte-identical; dev behavior comes from
   data flags (`cfg.hmr`) and env (`SPRIG_DEV`, `SPRIG_ASSETS_DIR`) — a dev-only
   variant would let build-only bugs (minification, code-splitting divergence) ship
   undetected until production. (spec 04 [§1](../04-build-pipeline-and-artifacts/01-1-pipeline-buildclient-srcdir-outdir-build-ts-63-298.md), spec 05 [§4](../05-cli-dev-hmr/04-4-sprig-dev-the-three-layer-architecture.md))
5. **Content-addressed caching**: `?v=` = hash of served assets; `immutable` only for
   content-addressed requests — enforced by `versioning-hash-parity.test.ts` (asserts
   `shortHash(outDir).hash === assetsVersioner(outDir)`). (specs 04 [§4](../04-build-pipeline-and-artifacts/04-4-versioning-caching-contract.md), 06 [§5](../06-keep-serving-composition/05-5-asset-serving-serveasset-hardening-contract.md))
6. **Parent re-renders never destroy live child islands** (pin + shell + rescan) —
   destroying one would wipe its live signal state and hydration wiring, forcing a
   jarring re-hydration flash; hydration order setup → snapshot → sync restoreState →
   paint → browser hook — enforced by `hydrate-restore-order.test.ts`.
   (spec 03 [§4](../03-islands-and-hydration/04-4-hydration-order-pinned-by-hydrate-restore-order-test-ts.md))
7. **The scaffold surface and the `spec/` obligations are framework-local, self-
   contained rules** — sprig states them without naming whatever composes onto it (a
   ROLE, not a named framework); the composing counterpart sees only the
   self-describing artifact (`spec/manifest.json`) and the stable scaffold layout —
   the root-resolution sub-obligation is enforced by the golden vectors at
   `spec/tests/spec-root-vectors.json` (CI-gated). Coordination-doc detail (which docs
   are live, who owns them): spec 09 §5.
   (spec 09 [§4](../09-ecosystem-contracts/04-4-locked-invariants-sprig-s-half.md), [§5](../09-ecosystem-contracts/05-5-history-the-retired-cross-framework-record-legacy.md))
8. **Agent-fleet economics are a design constraint**: docs move with the API in the
   same commit; agent defs carry synced guardrails; JSON stdout is exactly one
   document — enforced by the import-time console guard (`cli/lib/json-stdout.ts`).
   (specs 08, 10 [§2](../10-known-issues-and-refactor-drivers/02-2-agent-fleet-economics-from-optimize-md-feedback.md))

