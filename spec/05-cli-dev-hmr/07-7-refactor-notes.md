## 7. Refactor notes

Observed tensions in the current CLI/dev implementation sort into three handoff
shapes: item 1 has no single DX-IDEAL owner — it's a sequencing prerequisite,
decomposed here rather than delegated; items 2-4 delegate cleanly to a named
DX-IDEAL §3.5 bullet; item 5 hands off to spec 09 §4's locked-invariant record.

**1. cli.ts's decomposition is a prerequisite, not a delegation.** cli.ts is a
2,200-line single file mixing arg parsing, process supervision, config
merging/rewriting, port management, scaffold text, and build orchestration —
the highest-leverage decomposition target in the repo. It's the substrate
beneath every §3.5 behavior item below (honest verbs, the dev-process
registry, no-file-rewrite): none of them land cleanly inside a 2,200-line
monolith. Its resolution here is sequencing — decompose first — not a single
DX-IDEAL pointer.

| # | tension | status | owner |
|---|---|---|---|
| 1 | cli.ts is a 2,200-line monolith (arg parsing, process supervision, config merging/rewriting, port management, scaffold text, build orchestration) that every item below is built on | prerequisite, decided here (sequencing — decompose first) | this document, item 1 above |
| 2 | `withMergedConfig` writes its merged-config artifact to the CLI's own install dir (`<install>/.sprig-app.json`, NOT the user's repo — [§4](04-4-sprig-dev-the-three-layer-architecture.md)); `healLegacyLocalPins` is the piece that DOES rewrite the user's tracked local `deno.json` pins, healing what a killed dev left mangled — both exist because dev re-execs under a merged config | delegated | [DX-IDEAL §3.5](../DX-IDEAL/04-3-per-subsystem-ideal.md) — "Dev never rewrites the user's tracked files" (deletes both) |
| 3 | `sprig serve` (subprocess exec) vs. the generated `deno serve serve.ts` start task are different launch paths with different semantics | delegated | [DX-IDEAL §3.5](../DX-IDEAL/04-3-per-subsystem-ideal.md) — "Honest CLI verbs" |
| 4 | the stable-port hash + squatter reclaim logic and the dev.json registry are ad-hoc process management | delegated | [DX-IDEAL §3.5](../DX-IDEAL/04-3-per-subsystem-ideal.md) — "A real dev-process registry" |
| 5 | version pins live in THREE places (sprig `cliVersion()`/`sprigRange()`/`stamp`, rune `SPRIG_IMPORTS`, `sync-rune.ts` targets) | delegated (locked invariant) | spec 09 [§4](../09-ecosystem-contracts/04-4-locked-invariants-sprig-s-half.md) |
