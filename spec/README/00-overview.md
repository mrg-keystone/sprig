# sprig refactor spec

A description of the sprig system (`main/` @ `0.20.36-beta.1`, July 2026), built
for a refactor. The set deliberately mixes two kinds of content, and each spec
marks which is which: **as-built ground truth** — what the code does now, every
claim anchored to a `file:line` in `main/` — and **forward-looking TARGET**
material — proposals not yet built, called out explicitly wherever they appear
(06 §1's `Frontend` contract; most subsystem specs' tensions/refactor-targets
tail; all of DX-IDEAL).

Most subsystem specs (01–08) share a common four-part shape:

1. **Current architecture** — with `file:line` anchors into `main/`.
2. **Behavioral contracts pinned by tests** — the "must survive a refactor" list.
3. **Data formats.**
4. **Known tensions / refactor targets.**

Exceptions: 02 and 03 close with a contract checklist instead of a tensions
tail; 09 is a contract doc (composition seam / spec obligations / waist rule /
locked invariants / history) with no current-architecture or tensions part;
10 is entirely refactor drivers, with no current-architecture part.

Two sections in 00-overview carry the spine those per-spec lists hang off: the
[8 system invariants](../00-overview/06-the-invariants-that-define-the-system-full-versions-in-each-.md)
every refactor must preserve, and
[how to verify claims](../00-overview/07-how-to-verify-claims-in-these-specs.md) —
the evidence discipline behind every `file:line` anchor in the set.

**Entry point**

| # | file | covers |
|---|---|---|
| 00 | [00-overview.md](../00-overview/00-overview.md) | thesis, the three products, repo map, glossary, system-defining invariants |

**Framework core (01–04)**

| # | file | covers |
|---|---|---|
| 01 | [01-core-runtime.md](../01-core-runtime/00-overview.md) | `core.ts`: signals, DI/Injector, routing + guards + grants, `bootstrap()` SSR pipeline, StateService, auth.ts, dual-runtime detection |
| 02 | [02-template-compiler.md](../02-template-compiler/00-overview.md) | grammar (+ `grammar.bin` trick), AST + wire format, expression/pipe interpreter, SSR render semantics, static cache, registry/page assembly, CSS view encapsulation |
| 03 | [03-islands-and-hydration.md](../03-islands-and-hydration/00-overview.md) | island model + triggers, props bridge, hydrate.ts boot/morph/delegation, nested-island contracts, soft navigation, HMR client hooks |
| 04 | [04-build-pipeline-and-artifacts.md](../04-build-pipeline-and-artifacts/00-overview.md) | `buildClient` pipeline (deno bundle, code split, Tailwind/daisyUI, tokens), the `static/` artifact set, the HTML injection contract, versioning |

**Tooling + serving (05–06)**

| # | file | covers |
|---|---|---|
| 05 | [05-cli-dev-hmr.md](../05-cli-dev-hmr/00-overview.md) | the `sprig` CLI (all commands, init scaffold contract, rune composition emission), the supervised dev loop, SSE HMR semantics |
| 06 | [06-keep-serving-composition.md](../06-keep-serving-composition/00-overview.md) | serving & composition: the as-built `serveSprig`/`sprigUi`/`KeepApi`/auth-gateway composition, asset hardening, vendored libs, head injection, JSON routing, derivation; §1 records the not-yet-built `Frontend` handler this composition would collapse into (TARGET) |

**Workbench + distribution (07–08)**

| # | file | covers |
|---|---|---|
| 07 | [07-isolate-workbench.md](../07-isolate-workbench/00-overview.md) | the isolate CLI, the rune-generated discovery/testing server, the workbench UI + stage bridge, the isolate case format, generated-vs-authored boundaries |
| 08 | [08-install-skills-annotate.md](../08-install-skills-annotate/00-overview.md) | `~/.sprig` runtime install, Claude skills/agents deployment + guardrail sync, the annotate feedback overlay, this repo's own composed app |

**Obligations + why-refactor (09–10)**

| # | file | covers |
|---|---|---|
| 09 | [09-ecosystem-contracts.md](../09-ecosystem-contracts/00-overview.md) | sprig's external obligations, as simple rules: the `Frontend` composition seam (→06 §1), the `spec/` write-discipline obligations, the queries+commands waist (sprig's half), locked invariants; retired cross-framework record as marked history |
| 10 | [10-known-issues-and-refactor-drivers.md](../10-known-issues-and-refactor-drivers/00-overview.md) | hydration-architecture lessons, agent-fleet economics, release discipline, structural tensions a refactor should resolve |

**North star**

| # | file | covers |
|---|---|---|
| — | [DX-IDEAL.md](../DX-IDEAL/00-overview.md) | the best-DX north star and build order: per-subsystem ideals (`[CLEAR WIN]`/`[FORK]`) that specs 00–10 cite by section throughout |

Reading order for a newcomer: 00, then the phases above in order — framework
core, tooling + serving, workbench + distribution, obligations + why-refactor —
and DX-IDEAL last, the refactor target the numbered specs point at throughout.

Provenance: produced from a full read of the design docs (`docs/guide.md`, `coms.md`,
`coordinate.md`, `contract.md`, `optimize.md`, `isolate-feedback.md`,
`feedback/plan.md`) plus five parallel deep source sweeps (core runtime, compiler,
hydration/build/dev, CLI/keep/install, isolate workbench), each claim cited to
`file:line` in its subsystem report.
