# sprig refactor spec

A deep description of the CURRENT system (`main/` @ `0.20.36-beta.1`, July 2026),
written as the ground truth for a refactor. Each spec follows the same shape: current
architecture (with `file:line` anchors into `main/`), the behavioral contracts pinned
by tests (the "must survive a refactor" list), data formats, and known
tensions/refactor targets.

| # | file | covers |
|---|---|---|
| 00 | [00-overview.md](00-overview.md) | thesis, the three products, repo map, glossary, system-defining invariants |
| 01 | [01-core-runtime.md](01-core-runtime.md) | `core.ts`: signals, DI/Injector, routing + guards + grants, `bootstrap()` SSR pipeline, StateService, auth.ts, dual-runtime detection |
| 02 | [02-template-compiler.md](02-template-compiler.md) | grammar (+ `grammar.bin` trick), AST + wire format, expression/pipe interpreter, SSR render semantics, static cache, registry/page assembly, CSS view encapsulation |
| 03 | [03-islands-and-hydration.md](03-islands-and-hydration.md) | island model + triggers, props bridge, hydrate.ts boot/morph/delegation, nested-island contracts, soft navigation, HMR client hooks |
| 04 | [04-build-pipeline-and-artifacts.md](04-build-pipeline-and-artifacts.md) | `buildClient` pipeline (deno bundle, code split, Tailwind/daisyUI, tokens), the `static/` artifact set, the HTML injection contract, versioning |
| 05 | [05-cli-dev-hmr.md](05-cli-dev-hmr.md) | the `sprig` CLI (all commands, init scaffold contract, rune composition emission), the supervised dev loop, SSE HMR semantics |
| 06 | [06-keep-serving-composition.md](06-keep-serving-composition.md) | serving & composition: the CURRENT, as-built `serveSprig`/`sprigUi`/`KeepApi`/auth-gateway composition (root-`/ui` base, the `/api`+`/docs`+`/auth` dispatch table, request-scoped `Backend` token); asset hardening (traversal/decode/caching), vendored libs, head injection, JSON routing, derivation; §1 records the directly-servable `Frontend` handler as the refactor TARGET this composition would collapse into, not yet built |
| 07 | [07-isolate-workbench.md](07-isolate-workbench.md) | the isolate CLI, the rune-generated discovery/testing server, the workbench UI + stage bridge, the isolate case format, generated-vs-authored boundaries |
| 08 | [08-install-skills-annotate.md](08-install-skills-annotate.md) | `~/.sprig` runtime install, Claude skills/agents deployment + guardrail sync, the annotate feedback overlay, this repo's own composed app |
| 09 | [09-ecosystem-contracts.md](09-ecosystem-contracts.md) | sprig's external obligations, as simple rules: the `Frontend` composition seam (→06 §1), the `spec/` obligations (write discipline, manifest classes, hash-stamped contract inputs, the golden-vector `.git` walk, idempotent `init`), the queries+commands waist (sprig's half), locked invariants; retired cross-framework record as marked history |
| 10 | [10-known-issues-and-refactor-drivers.md](10-known-issues-and-refactor-drivers.md) | hydration-architecture lessons, agent-fleet economics, release discipline, structural tensions a refactor should resolve |
| — | [DX-IDEAL.md](DX-IDEAL.md) | the best-DX north star and build order: per-subsystem ideals (`[CLEAR WIN]`/`[FORK]`) that 00–10 cite by section (e.g. 07-isolate-workbench.md §3 cites DX-IDEAL §3.7; 10-known-issues-and-refactor-drivers.md §1.4 cites DX-IDEAL §3.5) |

Reading order for a newcomer: 00 → 01 → 02 → 03 → 04 (the framework core), then
05/06 (tooling + serving), then 07/08 (the workbench + distribution), then 09/10
(external obligations + why refactor), then DX-IDEAL (the refactor target the
numbered specs point at throughout).

Provenance: produced from a full read of the design docs (`docs/guide.md`, `coms.md`,
`coordinate.md`, `contract.md`, `optimize.md`, `isolate-feedback.md`,
`feedback/plan.md`) plus five parallel deep source sweeps (core runtime, compiler,
hydration/build/dev, CLI/keep/install, isolate workbench), each claim cited to
`file:line` in its subsystem report.
