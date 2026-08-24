## Repo map

Each `→ spec NN` arrow points to the spec that *documents* that path — owning-spec is not the same as containing-directory (`compiler/` alone splits across specs 02, 03, 04, and 05 §6, file by file). A path with no arrow means no spec owns it, as with `docs/guide.md`. `*.test.ts` files are the one exception written out in prose rather than arrows: each is owned by the same spec that owns the module it pins (e.g. `hydrate-restore-order.test.ts` → spec 03 §4; the keep test files → spec 06) — see each subsystem's contract-checklist section for the full pinning list.

```
framework/
  cli.ts                 # the `sprig` CLI (init/dev/build/serve/isolate/install/…)  → spec 05
  .sprig/                # (hidden dir!) the framework runtime
    core.ts              # signals, DI, routing, bootstrap().fetch — THE public API  → spec 01
    auth.ts              # httpOnly-cookie auth client                               → spec 01 §6
    spec-root.ts         # the git-root spec/ walk                                   → spec 01 §8 (shared walk contract: spec 09 §2)
    install.ts skills.ts annotate.ts annotate-client.js  # framework-scoped installer → spec 08
    compiler/
      parse.ts node.ts expr.ts render.ts serialize.ts scope.ts mod.ts
      hash.ts lifecycle.ts perf.ts island-infer.ts                                   → spec 02
      island.ts hydrate.ts                                                           → spec 03
      build.ts                                                                       → spec 04
      dev.ts hmr.ts                                                                  → spec 05 §6
      grammar.bin        # tree-sitter wasm bytes (renamed — JSR rewrites .wasm)     → spec 02 §1
      *.test.ts          # ~60 unit tests pinning behavior                          → owned by the spec that owns the module each test pins (below)
packages/keep/mod.ts     # serveSprig/sprigUi — the one-origin composition root      → spec 06
tree-sitter-angular-template/  # grammar source → grammar.bin                        → spec 02 §1
cli/ server/ app/        # the isolate workbench                                     → spec 07
serve.ts serve-dev.ts    # repo-root entry points; compose cli/+server/+app/         → serve.ts: spec 06 §3, §9; serve-dev.ts: spec 07
install.ts               # repo-root installer (distinct from framework/.sprig/install.ts) → spec 08
scripts/sync-*.ts        # sync scripts                                              → spec 08
claude/                  # skills + agents deployed on install                       → spec 08 §2
docs/guide.md            # the user-facing framework guide (framework only)
fixtures/                # sprig-app, guarded-app, auth, bullshit-app (audit eval),
                         # eval-app (breakdown golden), eval/ (gates) — no spec owns
                         # this dir; the isolate CASE format inside them is spec 07 §5
rnd/proto/               # two-seam prototype-host R&D; cf. the sprig:prototype skill copy (spec 08 §2), "waist" concept → spec 09 §3
coms.md coordinate.md contract.md   # live rune⇄sprig cross-repo coordination docs (waist/specRoot/seam) → spec 09 §5
optimize.md isolate-feedback.md feedback/   # refactor drivers                       → spec 10
```

## Reverse index (spec → paths it owns)

Built from the arrows above — use this when working a spec and asking "which files are in scope?"

- **spec 01** (core-runtime): `core.ts`; `auth.ts` (§6); `spec-root.ts` (§8)
- **spec 02** (template-compiler): `compiler/{parse,node,expr,render,serialize,scope,mod,hash,lifecycle,perf,island-infer}.ts`; `compiler/grammar.bin` (§1); `tree-sitter-angular-template/` (§1)
- **spec 03** (islands-and-hydration): `compiler/island.ts`, `compiler/hydrate.ts` — despite living under `compiler/`, these belong to spec 03, not spec 02
- **spec 04** (build-pipeline-and-artifacts): `compiler/build.ts`
- **spec 05** (cli-dev-hmr): `cli.ts`; `compiler/dev.ts`, `compiler/hmr.ts` (§6)
- **spec 06** (keep-serving-composition): `packages/keep/mod.ts`; `serve.ts` — the `serveSprig` composition it invokes (§3) and its `export default serveSprig({...})` derivation (§9)
- **spec 07** (isolate-workbench): `cli/`, `server/`, `app/`; `serve-dev.ts` (`serve.ts`'s prod composition is spec 06's, not spec 07's — [§1](../07-isolate-workbench/01-1-what-isolate-is-end-to-end.md)); `fixtures/` — CASE format only (§5), not the directory itself
- **spec 08** (install-skills-annotate): `.sprig/install.ts`, `.sprig/skills.ts`, `.sprig/annotate.ts`, `.sprig/annotate-client.js`; repo-root `install.ts`; `scripts/sync-*.ts`; `claude/` (§2); `rnd/proto/` (cf. §2)
- **spec 09** (ecosystem-contracts): `coms.md`, `coordinate.md`, `contract.md` (§5); `rnd/proto/` waist concept (§3)
- **spec 10** (known-issues-and-refactor-drivers): `optimize.md`, `isolate-feedback.md`, `feedback/`

No spec owns: `docs/guide.md`; `fixtures/` itself (beyond the CASE format carve-out above).

