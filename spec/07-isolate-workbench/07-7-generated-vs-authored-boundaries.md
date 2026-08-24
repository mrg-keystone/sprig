## 7. Generated-vs-authored boundaries

**The decision rule**: reproduced byte-for-byte from a `.rune` spec or the fixture scan
⇒ **generated**, never hand-edit; produced once as a stub, then filled in and owned by
a developer ⇒ **scaffolded-once / dev-owned**; hand-written, and the generator never
touches it ⇒ **authored**.

**Scope**: this section classifies OWNERSHIP only — which files a builder may edit.
Generation MECHANICS are §2's (`generate-previews.ts`, the preview/manifest generator)
and §3's (rune's per-module codegen from `<module>.rune`) to detail; a builder who wants
to CHANGE a generated file's content follows the "produced by" column below to the
generator, not the output.

| path/glob | category | produced by | regenerated when | your hand-edit |
| --- | --- | --- | --- | --- |
| `app/src/pages/_preview/**` (incl. `manifest.gen.ts`) | generated | `generate-previews.ts` → [§2](02-2-the-isolate-cli-cli.md) | every `dev`/`test` run — removed + rewritten | LOST on next regen |
| `app/src/_preview/targets/**` | generated | `generate-previews.ts` → [§2](02-2-the-isolate-cli-cli.md) | every `dev`/`test` run — removed + rewritten | LOST on next regen |
| `app/src/css-variables.json` (forwarded copy of the project's LEGACY `<src>/css-variables.json`) | generated / copied | `generate-previews.ts` → [§2](02-2-the-isolate-cli-cli.md) rule 5 | every `dev`/`test` run — stale copy removed, source re-copied | LOST on next regen |
| rune tree: `mod-root.ts`, `bootstrap/modules.ts` | generated | rune codegen → [§3](03-3-the-server-server-a-rune-generated-keep-backend.md) | rune codegen run against `<module>.rune` — removed + rewritten every run (header: "DO NOT EDIT ... regenerated on every sync") | LOST on next regen |
| rune tree: `dto/`, `entrypoints/http/mod.ts`, `domain/coordinators/<name>/mod.ts` | scaffolded-once / dev-owned | rune scaffold ([§3](03-3-the-server-server-a-rune-generated-keep-backend.md)), then hand-filled (header: "Edit the body. Re-running manifest will not overwrite this file.") | rune codegen run against `<module>.rune` — write-if-absent, so an existing file is left alone | SURVIVES |
| `bootstrap/mod.ts`, `bootstrap/config.ts` | scaffolded-once / dev-owned | rune scaffold ([§3](03-3-the-server-server-a-rune-generated-keep-backend.md)), then hand-filled (header: "created once by rune sync, never overwritten") | rune codegen run against `<module>.rune` — write-if-absent, so an existing file is left alone | SURVIVES |
| `domain/business/<name>/mod.ts` | scaffolded-once / dev-owned | rune scaffold ([§3](03-3-the-server-server-a-rune-generated-keep-backend.md)), then hand-filled — the thin pure-logic wrapper | same — write-if-absent | SURVIVES |
| `domain/data/<name>/mod.ts` | scaffolded-once / dev-owned | rune scaffold ([§3](03-3-the-server-server-a-rune-generated-keep-backend.md)), then hand-filled — the fs/os I/O boundary (e.g. `project/mod.ts`'s `scan()`, `runner/mod.ts`'s `provision()`) | same — write-if-absent | SURVIVES |
| `cli/`, `server/src/core/**` (the ported pure cores), the rest of `app/src/` (excluding the forwarded `css-variables.json` copy, row above), `serve.ts`, `serve-dev.ts`, `.rune` specs, `heal-rules.json`, fixture `isolate/` inputs (`fixture.json`, `cases/*.json`) and their per-case `isolate/cases/<case>/tests/*.spec.ts` — Playwright specs, [§5](05-5-the-isolate-case-format.md) | authored | hand-written; the generator never touches it | never | it IS the source |
| `fixtures/sprig-app/src/_isolate/` | dead | old generation artifact | never — nothing reads it; `framework/cli.ts` skips `_isolate` dirs | dead-ignore |

**Recognizing a file's status without this table** — two tells, one per generator:
- **`generate-previews.ts`'s output** ([§2](02-2-the-isolate-cli-cli.md)): only
  `manifest.gen.ts` carries an explicit "Do not edit" header
  (`generate-previews.ts:144`) — the rest of that generator's output (the per-case
  `template.html`, the copied target components, the `css-variables.json` copy) carries
  no marker. For those, the table above is the authority, not a per-file header.
- **rune's generated server tree** ([§3](03-3-the-server-server-a-rune-generated-keep-backend.md)):
  a sibling `<module>.rune` marks the whole tree rune-managed, but directory is NOT the
  clobber-vs-survive discriminator — the per-file header is. A file whose header reads
  "DO NOT EDIT ... regenerated on every sync" is the GENERATED set: only `mod-root.ts`
  and `bootstrap/modules.ts` carry that header (table above — LOST on next regen).
  Every other file in the tree carries a survives-header instead — "Edit the body ...
  will not overwrite this file" (`dto/`, `entrypoints/http/mod.ts`,
  `domain/coordinators/<name>/mod.ts`), "Scaffolded once ... sync preserves this file"
  (`domain/business/<name>/mod.ts`, `domain/data/<name>/mod.ts`), or "created once ...
  never overwritten" (`bootstrap/mod.ts`, `bootstrap/config.ts`) — and SURVIVES a
  re-sync regardless of which subdirectory it lives in.

> **DX-IDEAL §3.7 target, NOT yet built:** co-located `<name>.cy.ts` specs, RED-first
> ([§5](05-5-the-isolate-case-format.md)), replace the authored test unit above and
> retire the `cli/lib/events/` → `isolate-events` handshake it depends on
> ([§1](01-1-what-isolate-is-end-to-end.md) step 2, [§5](05-5-the-isolate-case-format.md)).
> As-built, neither is retired: Playwright is the CURRENT runner
> ([§1](01-1-what-isolate-is-end-to-end.md) step 2), and `runner.ts`'s
> `ensureRunner()` provisions both `@playwright/test` and `cli/lib/events/` — copied to
> `~/.isolate-runner`'s `isolate-events` — on every run.

**Why survival splits the way the table shows**: rune's codegen is write-if-absent for
the SCAFFOLDED-ONCE set (`dto/`, `entrypoints/http/mod.ts`,
`domain/coordinators/<name>/mod.ts`, `bootstrap/mod.ts`/`bootstrap/config.ts`,
`domain/business/<name>/mod.ts`/`domain/data/<name>/mod.ts`) — it writes each of those
only when the target path is absent, so a dev's edit sticks simply by existing before
the next run — and always remove-and-rewrite for the GENERATED set (`mod-root.ts`,
`bootstrap/modules.ts`), regardless of what's already on disk.

**Anatomy of one real module — `server/src/discovery/`** (per-file category, per the
table above):
```
server/src/discovery/
  discovery.rune                              # authored — the source spec
  dto/*.ts                                    # scaffolded-once / dev-owned
  entrypoints/http/mod.ts                     # scaffolded-once / dev-owned — get-discovery, get-manifest
  domain/coordinators/discovery-scan/mod.ts   # scaffolded-once / dev-owned
  domain/coordinators/manifest-build/mod.ts   # scaffolded-once / dev-owned
  domain/business/discovery/mod.ts            # scaffolded-once / dev-owned — class Discovery; collect() is a pure identity passthrough
  domain/business/manifest/mod.ts             # scaffolded-once / dev-owned — Manifest.fromDiscovery projection
  domain/data/project/mod.ts                  # scaffolded-once / dev-owned — scan()'s fs/os I/O boundary
  mod-root.ts                                 # generated
```
`domain/business/discovery/mod.ts`'s `Discovery.collect()` does no scanning itself —
per [§3](03-3-the-server-server-a-rune-generated-keep-backend.md), rune business
classes are mostly identity/passthrough. The real scan logic lives outside this tree,
in `server/src/core/business/discover/mod.ts` — authored, one of the ported pure
cores — and is invoked by the DATA adapter above: `domain/data/project/mod.ts`'s
`scan()` is the fs: boundary that delegates to it.

