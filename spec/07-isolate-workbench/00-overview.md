# 07 — The isolate workbench (cli/ + server/ + app/)

> Subject: the second project in this repo — a Storybook-style component testing
> workbench for sprig apps. `cli/` = the isolate CLI, `server/` = a rune-generated keep
> backend (discovery + testing modules), `app/` = the workbench UI (itself a sprig
> app). The repo root's `serve-dev.ts` composes all three for dev (below); the repo
> dogfoods its own framework.
>
> **Two governing design choices.**
>
> (a) **One origin, dogfooded.** The workbench is itself a sprig app: `cli/`'s
> generator, `server/`'s rune-generated keep backend, and `app/`'s UI are composed at a
> SINGLE origin — the same one-origin discipline 06 states framework-wide
> ([§3](../06-keep-serving-composition/03-3-the-servesprig-composition-current-as-built.md)) —
> `serveSprig({ keep: api, app, base: "", assetsDir: outDir })`
> ([§1](01-1-what-isolate-is-end-to-end.md) step 6). `base: ""` puts generated previews at
> `/components/…`/`/pages/…` on that same origin, so the stage iframe embedding a
> preview is same-origin to the workbench shell: no CORS, just `postMessage`
> ([§4](04-4-the-workbench-ui-app.md)).
>
> (b) **A test discipline still mid-swap.** Every previewable unit is meant to carry a
> co-located spec, run against the served origin. CURRENTLY the runner is
> **Playwright** — spawned as a subprocess out of a per-user npm install at
> `~/.isolate-runner`, running each case's `*.spec.ts` (the `ensureRunner` fragility
> spec 10 [§1](../10-known-issues-and-refactor-drivers/01-1-hydration-architecture-pain-from-isolate-feedback-md-2026-.md).6
> documents belongs to this runner); a previewable unit with zero specs is not, today,
> a discovery problem of any kind — nothing blocks `dev`/`test` on a missing test.
> [DX-IDEAL §3](../DX-IDEAL/04-3-per-subsystem-ideal.md).7 names the **TARGET, NOT YET
> BUILT**: a Deno-native, in-process `@mrg-keystone/cy-deno` runner (co-located
> `*.cy.ts`, no subprocess, no npm tree) plus a FATAL `missing-test` discovery problem —
> the UI analogue of rune's fault-coverage lint ("every piece of code has a test") —
> joining the fatal kinds discovery already enforces
> ([§3](03-3-the-server-server-a-rune-generated-keep-backend.md)).
>
> **OWNS / DELEGATES.** 07 owns the workbench's own three parts (`cli/`, `server/`,
> `app/`) and `serve-dev.ts`'s dev composition of them — `serve.ts`'s PROD composition
> is out of scope for this spec ([§1](01-1-what-isolate-is-end-to-end.md)). Everything
> else here is a seam this spec cites, not defines: the `serveSprig` compose/dispatch
> seam is 06's
> ([§3](../06-keep-serving-composition/03-3-the-servesprig-composition-current-as-built.md));
> the supervised-port algorithm `sprig isolate` rides is 05's
> ([§1](../05-cli-dev-hmr/01-1-entry-and-self-location.md)); the core `Route`/`Resolve`/
> `ResolveCtx` types the generated manifest is built from are 01's
> ([§1](../01-core-runtime/01-1-public-api-surface-all-of-mrg-keystone-sprig.md)); the
> in-process build the workbench runs (`buildClient`) is 04's
> ([§1](../04-build-pipeline-and-artifacts/01-1-pipeline-buildclient-srcdir-outdir-build-ts-63-298.md));
> the `NATIVE`/`RESERVED` tag-safety rule preview selectors rely on is 02's
> ([§1](../02-template-compiler/02-1-template-syntax-grammar-tree-sitter-angular-template-gramm.md));
> install/update of the workbench copy itself is 08's
> ([§1](../08-install-skills-annotate/01-1-why-a-local-install-exists-at-all.md)). The one
> invariant 07 participates in without owning: the honest-exit "receipt IS the state"
> contract ([§2](02-2-the-isolate-cli-cli.md)'s exit-code table) is a leg of invariant 8
> (spec 10 [§2](../10-known-issues-and-refactor-drivers/02-2-agent-fleet-economics-from-optimize-md-feedback.md),
> DX-IDEAL [§3](../DX-IDEAL/04-3-per-subsystem-ideal.md).7).

Section index — the eight fragments, one line each:

| § | the one thing it owns |
|---|---|
| [§1](01-1-what-isolate-is-end-to-end.md) | What isolate is end to end — the three-part shape + the `dev`/`test` step sequence |
| [§2](02-2-the-isolate-cli-cli.md) | The isolate CLI (`cli/`) — command surface, `test`'s exit-code contract, preview generation |
| [§3](03-3-the-server-server-a-rune-generated-keep-backend.md) | The server (`server/`) — the rune-generated keep backend, discovery + testing, the fault taxonomy |
| [§4](04-4-the-workbench-ui-app.md) | The workbench UI (`app/`) — the shell + the postMessage stage-bridge protocol |
| [§5](05-5-the-isolate-case-format.md) | The isolate CASE format — fixture/case JSON, preview eligibility |
| [§6](06-6-sprig-isolate-cli-main-ts.md) | `sprig isolate` ↔ `cli/main.ts` — the framework CLI's thin supervisor wrapper |
| [§7](07-7-generated-vs-authored-boundaries.md) | Generated vs. authored boundaries — which files a builder may edit |
| [§8](08-8-known-drift-refactor-targets.md) | Known drift / refactor targets — **the canonical isolate drift registry** (special status below) |

**§8 is append-only and canonical.** Every sibling section that cites a drift cites it
BY NUMBER (e.g. [§5](05-5-the-isolate-case-format.md) item 3) rather than restating it;
a new drift is appended as the next number, never inserted or renumbered, and a
resolved drift is marked **MET**/**RESOLVED** in place, never deleted.

