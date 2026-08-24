## The three products in this repo

| product | code | ships via |
|---|---|---|
| the sprig framework | `framework/cli.ts`, `framework/.sprig/**`, `packages/keep/mod.ts`, `tree-sitter-angular-template/` (grammar source) | JSR (`@mrg-keystone/sprig`) + the GitHub `runtime-latest` bundle → `~/.sprig` |
| the isolate workbench | `cli/`, `server/`, `app/`, root `serve.ts`/`serve-dev.ts` | the same GitHub `runtime-latest` bundle as the framework's non-JSR half above (NOT on JSR); **also** ships standalone via its own `mrg-keystone/isolate` → `~/.isolate` bootstrap, independent of `~/.sprig` (spec 08 §1) |
| the agent toolchain | `claude/skills/**`, `claude/agents/**` | copied to `~/.claude/*` by `sprig install`/`update` |

The channel sets the blast radius of a change. JSR (`@mrg-keystone/sprig`) is the
framework's public API surface — breaking it breaks every downstream app author
who imported the package (detail: spec 01 §1, spec 09 §2, spec 10 §3). The
`runtime-latest` bundle is internally coupled — the framework's non-JSR half and
the entire isolate workbench ship inside it as one unit, so a change there can
break both with no version boundary between them. The isolate workbench's
standalone `~/.isolate` channel is a separate blast radius again, never
reconciled with `~/.sprig` (spec 08 §1). The `~/.claude` copy is
redeployed to dev machines on every `sprig install`/`update`, so a change there
reaches every agent session at the next install, not just new clones.

Everything else in the repo is supporting material, not a shipped product; see
the repo map (`04-repo-map.md`) for the full dir→spec inventory.

