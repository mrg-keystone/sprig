# sprig spec

**Start here:** [Overview](README/00-overview.md) — what sprig is, the
per-subsystem coverage table, the newcomer reading order, and provenance.

The rest of this file is a sitemap: every spec file, decomposed into one
section per concept.

## 00-overview.md

- [Overview](00-overview/00-overview.md)
- [One paragraph](00-overview/01-one-paragraph.md)
- [The three products in this repo](00-overview/02-the-three-products-in-this-repo.md)
- [The mental model (request path)](00-overview/03-the-mental-model-request-path.md)
- [Repo map](00-overview/04-repo-map.md)
- [Core concepts (glossary)](00-overview/05-core-concepts-glossary.md)
- [The invariants that define the system (full versions in each spec)](00-overview/06-the-invariants-that-define-the-system-full-versions-in-each-.md)
- [How to verify claims in these specs](00-overview/07-how-to-verify-claims-in-these-specs.md)

## 01-core-runtime.md

- [Overview](01-core-runtime/00-overview.md)
- [1. Public API surface (all of `@mrg-keystone/sprig`)](01-core-runtime/01-1-public-api-surface-all-of-mrg-keystone-sprig.md)
- [2. Injector semantics (core.ts:190-256)](01-core-runtime/02-2-injector-semantics-core-ts-190-256.md)
- [3. Routing semantics (core.ts:486-644)](01-core-runtime/03-3-routing-semantics-core-ts-486-644.md)
- [4. bootstrap() request pipeline (core.ts:709-850)](01-core-runtime/04-4-bootstrap-request-pipeline-core-ts-709-850.md)
- [5. StateService — persisted client state (core.ts:103-187)](01-core-runtime/05-5-stateservice-persisted-client-state-core-ts-103-187.md)
- [6. auth.ts — httpOnly cookie auth (framework/.sprig/auth.ts)](01-core-runtime/06-6-auth-ts-httponly-cookie-auth-framework-sprig-auth-ts.md)
- [7. Dual-runtime detection (core.ts:273-292)](01-core-runtime/07-7-dual-runtime-detection-core-ts-273-292.md)
- [8. spec-root.ts](01-core-runtime/08-8-spec-root-ts.md)
- [9. Behavioral contracts pinned by tests (must survive a refactor)](01-core-runtime/09-9-behavioral-contracts-pinned-by-tests-must-survive-a-refact.md)
- [10. Refactor targets / tensions observed](01-core-runtime/10-10-refactor-targets-tensions-observed.md)

## 02-template-compiler.md

- [Overview](02-template-compiler/00-overview.md)
- [0. The framing design fact](02-template-compiler/01-0-the-framing-design-fact.md)
- [1. Template syntax (grammar: `tree-sitter-angular-template/grammar.js`)](02-template-compiler/02-1-template-syntax-grammar-tree-sitter-angular-template-gramm.md)
- [2. AST + wire format](02-template-compiler/03-2-ast-wire-format.md)
- [3. expr.ts — the expression interpreter](02-template-compiler/04-3-expr-ts-the-expression-interpreter.md)
- [4. render.ts — SSR semantics](02-template-compiler/05-4-render-ts-ssr-semantics.md)
- [5. mod.ts — registry, page assembly, renderer](02-template-compiler/06-5-mod-ts-registry-page-assembly-renderer.md)
- [6. Supporting modules](02-template-compiler/07-6-supporting-modules.md)
- [7. Contract checklist for a refactor (each pinned by a named test)](02-template-compiler/08-7-contract-checklist-for-a-refactor-each-pinned-by-a-named-t.md)

## 03-islands-and-hydration.md

- [Overview](03-islands-and-hydration/00-overview.md)
- [1. The island model](03-islands-and-hydration/01-1-the-island-model.md)
- [2. The SSR → client props contract](03-islands-and-hydration/02-2-the-ssr-client-props-contract.md)
- [3. Client boot + trigger arming](03-islands-and-hydration/03-3-client-boot-trigger-arming.md)
- [4. Hydration order (pinned by hydrate-restore-order.test.ts)](03-islands-and-hydration/04-4-hydration-order-pinned-by-hydrate-restore-order-test-ts.md)
- [5. Reactive update model](03-islands-and-hydration/05-5-reactive-update-model.md)
- [6. Nested islands (the zz-* contracts)](03-islands-and-hydration/06-6-nested-islands-the-zz-contracts.md)
- [7. Soft navigation (hydrate.ts:500-727)](03-islands-and-hydration/07-7-soft-navigation-hydrate-ts-500-727.md)
- [8. Dual-runtime recovery](03-islands-and-hydration/08-8-dual-runtime-recovery.md)
- [9. HMR hooks in the client runtime](03-islands-and-hydration/09-9-hmr-hooks-in-the-client-runtime.md)
- [10. Contract checklist for a refactor](03-islands-and-hydration/10-10-contract-checklist-for-a-refactor.md)

## 04-build-pipeline-and-artifacts.md

- [Overview](04-build-pipeline-and-artifacts/00-overview.md)
- [1. Pipeline (`buildClient(srcDir, outDir)`, build.ts:63-298)](04-build-pipeline-and-artifacts/01-1-pipeline-buildclient-srcdir-outdir-build-ts-63-298.md)
- [2. The artifact set (`static/`)](04-build-pipeline-and-artifacts/02-2-the-artifact-set-static.md)
- [3. What SSR must inject for hydration (the HTML contract)](04-build-pipeline-and-artifacts/03-3-what-ssr-must-inject-for-hydration-the-html-contract.md)
- [4. Versioning / caching contract](04-build-pipeline-and-artifacts/04-4-versioning-caching-contract.md)
- [5. Refactor notes](04-build-pipeline-and-artifacts/05-5-refactor-notes.md)

## 05-cli-dev-hmr.md

- [Overview](05-cli-dev-hmr/00-overview.md)
- [1. Entry and self-location](05-cli-dev-hmr/01-1-entry-and-self-location.md)
- [2. Command surface](05-cli-dev-hmr/02-2-command-surface.md)
- [3. `sprig init` — the scaffold contract](05-cli-dev-hmr/03-3-sprig-init-the-scaffold-contract.md)
- [4. `sprig dev` — the three-layer architecture](05-cli-dev-hmr/04-4-sprig-dev-the-three-layer-architecture.md)
- [5. `sprig build` — rune composition emission](05-cli-dev-hmr/05-5-sprig-build-rune-composition-emission.md)
- [6. Dev server + HMR (`dev.ts`, `hmr.ts`)](05-cli-dev-hmr/06-6-dev-server-hmr-dev-ts-hmr-ts.md)
- [7. Refactor notes](05-cli-dev-hmr/07-7-refactor-notes.md)

## 06-keep-serving-composition.md

- [Overview](06-keep-serving-composition/00-overview.md)
- [1. The Frontend contract — sprig's simple rules (TARGET, not yet built)](06-keep-serving-composition/01-1-the-frontend-contract-sprig-s-simple-rules-target-not-yet-.md)
- [2. The `KeepApi` seam + session types (current, as built)](06-keep-serving-composition/02-2-the-keepapi-seam-session-types-current-as-built.md)
- [3. The `serveSprig` composition (current, as built)](06-keep-serving-composition/03-3-the-servesprig-composition-current-as-built.md)
- [4. The `/auth` gateway + `/api` body gateway (current, as built)](06-keep-serving-composition/04-4-the-auth-gateway-api-body-gateway-current-as-built.md)
- [5. Asset serving (`serveAsset`) — hardening contract](06-keep-serving-composition/05-5-asset-serving-serveasset-hardening-contract.md)
- [6. Vendored browser libs](06-keep-serving-composition/06-6-vendored-browser-libs.md)
- [7. Head-meta provenance + logging](06-keep-serving-composition/07-7-head-meta-provenance-logging.md)
- [8. JSON folder routing](06-keep-serving-composition/08-8-json-folder-routing.md)
- [9. Zero-composition derivation](06-keep-serving-composition/09-9-zero-composition-derivation.md)
- [10. Refactor notes](06-keep-serving-composition/10-10-refactor-notes.md)

## 07-isolate-workbench.md

- [Overview](07-isolate-workbench/00-overview.md)
- [1. What isolate is, end to end](07-isolate-workbench/01-1-what-isolate-is-end-to-end.md)
- [2. The isolate CLI (`cli/`)](07-isolate-workbench/02-2-the-isolate-cli-cli.md)
- [3. The server (`server/`) — a rune-generated keep backend](07-isolate-workbench/03-3-the-server-server-a-rune-generated-keep-backend.md)
- [4. The workbench UI (`app/`)](07-isolate-workbench/04-4-the-workbench-ui-app.md)
- [5. The isolate case format](07-isolate-workbench/05-5-the-isolate-case-format.md)
- [6. `sprig isolate` ↔ `cli/main.ts`](07-isolate-workbench/06-6-sprig-isolate-cli-main-ts.md)
- [7. Generated-vs-authored boundaries](07-isolate-workbench/07-7-generated-vs-authored-boundaries.md)
- [8. Known drift + refactor targets](07-isolate-workbench/08-8-known-drift-refactor-targets.md)

## 08-install-skills-annotate.md

- [Overview](08-install-skills-annotate/00-overview.md)
- [1. Why a local install exists at all](08-install-skills-annotate/01-1-why-a-local-install-exists-at-all.md)
- [2. Claude asset deployment (`skills.ts`)](08-install-skills-annotate/02-2-claude-asset-deployment-skills-ts.md)
- [3. `scripts/sync-rune.ts`](08-install-skills-annotate/03-3-scripts-sync-rune-ts.md)
- [4. The annotate overlay (`annotate.ts` + `annotate-client.js`)](08-install-skills-annotate/04-4-the-annotate-overlay-annotate-ts-annotate-client-js.md)
- [5. This repo hosts its own composed app](08-install-skills-annotate/05-5-this-repo-hosts-its-own-composed-app.md)
- [6. Refactor notes](08-install-skills-annotate/06-6-refactor-notes.md)

## 09-ecosystem-contracts.md

- [Overview](09-ecosystem-contracts/00-overview.md)
- [1. The composition seam](09-ecosystem-contracts/01-1-the-composition-seam.md)
- [2. sprig's `spec/` obligations](09-ecosystem-contracts/02-2-sprig-s-spec-obligations.md)
- [3. The waist rule — sprig's half](09-ecosystem-contracts/03-3-the-waist-rule-sprig-s-half.md)
- [4. Locked invariants — sprig's half](09-ecosystem-contracts/04-4-locked-invariants-sprig-s-half.md)
- [5. History — the retired cross-framework record (LEGACY)](09-ecosystem-contracts/05-5-history-the-retired-cross-framework-record-legacy.md)

## 10-known-issues-and-refactor-drivers.md

- [Overview](10-known-issues-and-refactor-drivers/00-overview.md)
- [1. Hydration architecture pain (from `isolate-feedback.md`, 2026-07-11)](10-known-issues-and-refactor-drivers/01-1-hydration-architecture-pain-from-isolate-feedback-md-2026-.md)
- [2. Agent-fleet economics (from `optimize.md` + `feedback/`)](10-known-issues-and-refactor-drivers/02-2-agent-fleet-economics-from-optimize-md-feedback.md)
- [3. Docs-move-with-the-API release discipline (from `README.md`)](10-known-issues-and-refactor-drivers/03-3-docs-move-with-the-api-release-discipline-from-readme-md.md)
- [4. Structural tensions a refactor should resolve](10-known-issues-and-refactor-drivers/04-4-structural-tensions-a-refactor-should-resolve.md)

## DX-IDEAL.md

- [Overview](DX-IDEAL/00-overview.md)
- [0. The one-line thesis](DX-IDEAL/01-0-the-one-line-thesis.md)
- [1. The organizing principle: split the error philosophy by mode](DX-IDEAL/02-1-the-organizing-principle-split-the-error-philosophy-by-mod.md)
- [2. The universal DX layer (cross-cutting — build this once)](DX-IDEAL/03-2-the-universal-dx-layer-cross-cutting-build-this-once.md)
- [3. Per-subsystem ideal](DX-IDEAL/04-3-per-subsystem-ideal.md)
- [4. The biggest cross-cutting forks](DX-IDEAL/05-4-the-biggest-cross-cutting-forks.md)
- [5. Build order (max DX leverage first)](DX-IDEAL/06-5-build-order-max-dx-leverage-first.md)
- [6. What must NOT change (the good DX to protect)](DX-IDEAL/07-6-what-must-not-change-the-good-dx-to-protect.md)

---

Generated by `piecemeal`: one standalone file per concept, every byte of spec
content preserved verbatim from the source, only `§` cross-references
rewritten as links. Verify losslessness: `deno run -A verify.ts /Users/raphaelcastro/Documents/programming/tooling/sprig/refactor/spec`.

