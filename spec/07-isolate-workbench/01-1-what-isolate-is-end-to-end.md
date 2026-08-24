## 1. What isolate is, end to end

isolate is a component preview/testing workbench built on sprig: given a sprig app, it
discovers folder-components with `isolate/` fixtures, generates one preview page per
case, and serves the previews at one origin alongside the per-case `*.spec.ts` tests
(nested under `isolate/cases/<case>/tests/`, [§5](05-5-the-isolate-case-format.md))
that gate them. It ships as three parts — `cli/`, `server/`, `app/` — composed by the
root `serve.ts`/`serve-dev.ts` into that one origin.

| part | role | owner |
|---|---|---|
| `cli/` | discovery, generation, dev/test orchestration | [§2](02-2-the-isolate-cli-cli.md) |
| `server/` | rune-generated keep backend, the TDD gate | [§3](03-3-the-server-server-a-rune-generated-keep-backend.md) |
| `app/` | workbench UI — stage, controls, runner | [§4](04-4-the-workbench-ui-app.md) |
| root `serve.ts` (prod) / `serve-dev.ts` (dev) | compose `cli/`'s output + `server/` + `app/` into one origin | `serve-dev.ts`: step 6 below; `serve.ts`'s prod composition is out of scope for this spec |
| case format | fixtures, cases, per-case `*.spec.ts` tests (nested under `isolate/cases/<case>/tests/`) | [§5](05-5-the-isolate-case-format.md) |
| `sprig isolate` ↔ `cli/main.ts` | the framework CLI's thin supervisor over `dev` | [§6](06-6-sprig-isolate-cli-main-ts.md) |

The composition shape (steps below fill in each arrow):

```
cli/ ── generates ──▶ previews (app/src/pages/_preview/** + manifest.gen.ts)
                                      │
        root composer (serve.ts prod / serve-dev.ts dev) serves
                app/ (UI) + server/ (keep backend) at ONE origin
                                      │
                                   browser
                                      │
     same-origin stage iframe ──▶ /components|pages/<category>/…
```

`deno run -A cli/main.ts dev -r <sprig-app>` (or `sprig isolate <app>`) runs steps 1-6
below ([§2](02-2-the-isolate-cli-cli.md) `dev`: discover → provision → materialize →
generate → build → serve); step 7 is the separate `test` command — it does not require a
prior `dev` run (detail below).

**Two entry paths, same steps 1-6** — they differ only in workbench isolation, port, and
force-bypass reachability:

| | `deno run -A cli/main.ts dev` (direct) | `sprig isolate <app>` (wrapper) |
|---|---|---|
| workbench root (step 3) | unset `SPRIG_WB_ROOT` → the install root itself — `cli/lib/workbench.ts`'s `REPO_DIR`, the one shared workbench; materialize is a no-op copy | `SPRIG_WB_ROOT` = `$TMPDIR/sprig-work/<repoKey>` — a private per-repo-branch copy |
| port (step 6) | `PORT` env, else `8000` | `freePort(Number(PORT ?? 8000))` — a forward free-port scan starting at 8000 (or the caller's own `PORT` as seed), set as the spawned child's explicit `PORT` (mechanics: 05-cli [§1](../05-cli-dev-hmr/01-1-entry-and-self-location.md)) |
| `--config` | not pinned — invoked directly, the caller's own environment resolves it | pinned to `<installRoot>/deno.json` |
| `-f/--force` reachable? | yes — the command's own flag | no — the wrapper's arg list stops short of it; bypass a fatal discovery problem (step 1 above) by running `cli/main.ts dev -f` directly instead |
| owner | this section | [§6](06-6-sprig-isolate-cli-main-ts.md) |

**Steps 1-6** (the shared `dev` flow both entry paths run):

| stage | does | key output | owner § |
|---|---|---|---|
| 1. Discover | Scan for folder-components with `isolate/` fixtures. **CURRENT**: fatal `Problem`s (`fixture-json`/`case-json` — malformed JSON) abort the whole run before anything is generated (exit 1) unless `-f/--force` (non-destructive, unfiltered run); `unsupported` is advisory only; a zero-test unit still previews today. The `Problem.kind` union also carries `component-file`/`component-export`, but they are vestigial: as-built, the folder-component scanner has no `.tsx` export-validation gate (the selector IS the folder basename, no `.tsx` export scanning), so `discover()` never emits either kind. **TARGET** (DX-IDEAL [§3.7](../DX-IDEAL/04-3-per-subsystem-ideal.md), not built): a `missing-test` problem joins the fatal kinds — every previewable unit must carry ≥1 co-located `*.cy.ts`, the UI analogue of rune's fault-coverage lint. | the entry list + problem list; a fatal problem blocks everything after it | [§2](02-2-the-isolate-cli-cli.md), [§3](03-3-the-server-server-a-rune-generated-keep-backend.md) |
| 2. Provision runner | **CURRENT**: `ensureRunner()` npm-installs the Playwright runner into `~/.isolate-runner` (Node/npm required). **TARGET** (DX-IDEAL [§3.7](../DX-IDEAL/04-3-per-subsystem-ideal.md)): swap to the Deno-native `@mrg-keystone/cy-deno@0.2.0` + a webview/chrome driver — no npm, retiring the npm-Playwright provisioning fragility (spec 10 [§1.6](../10-known-issues-and-refactor-drivers/01-1-hydration-architecture-pain-from-isolate-feedback-md-2026-.md)). | a usable test runner | [§2](02-2-the-isolate-cli-cli.md), [§5](05-5-the-isolate-case-format.md) |
| 3. Materialize workbench | Copy the `app/` template into the run's workbench root (cache-keyed by install version stamp; root per entry path — table above); the shared-install case is a no-op copy that rewrites `app/deno.json` in place. | a workbench app dir ready to generate into | [§6](06-6-sprig-isolate-cli-main-ts.md) |
| 4. Generate previews | One page per case + `manifest.gen.ts`. | `app/src/pages/_preview/**` + `manifest.gen.ts` | [§2](02-2-the-isolate-cli-cli.md) |
| 5. Build in-process | `buildClient(<wbApp>/src, <wbRoot>/static)` — no subprocess. | the static build the server serves | — |
| 6. Serve one origin | Port per entry path (table above). `deno serve … serve-dev.ts` with `ISOLATE_PROJECT`, `SPRIG_DEV=1`, `SPRIG_WB_ROOT` on the child's env; `serveSprig({ keep: api, app, base: "", assetsDir: outDir })` — base `""` keeps the stage iframe same-origin at `/components/…`. | prints `http://127.0.0.1:<port>/` (IPv4-explicit) | [§6](06-6-sprig-isolate-cli-main-ts.md) |

**7. Test** (the separate `test` command, [§2](02-2-the-isolate-cli-cli.md)) — does NOT
require a prior `dev` run: it spawns its OWN preview server on a random port
(3000-6999, IPv4, health-polled) unless `--base-url <url>` is given, which points it
at an already-running origin instead. Against whichever origin that is, **CURRENT**: the
spawned Playwright subprocess runs each case's per-case `*.spec.ts` tests
([§5](05-5-the-isolate-case-format.md), nested under `isolate/cases/<case>/tests/`) —
each importing `test`/`expect` from `@playwright/test` and hitting the case's route at
`http://127.0.0.1:<port>/components|pages/<category>/[<folder>/]<case>`
(the route discovery computes, [§3](03-3-the-server-server-a-rune-generated-keep-backend.md));
pass/fail per test, honest exit code ([§2](02-2-the-isolate-cli-cli.md), [§3](03-3-the-server-server-a-rune-generated-keep-backend.md)).
**TARGET** (DX-IDEAL [§3.7](../DX-IDEAL/04-3-per-subsystem-ideal.md), not built): swap to
cy-deno running co-located `*.cy.ts` via
`cy.visit(http://127.0.0.1:<port>/components|pages/<category>/[<folder>/]<case>)`.

**Golden path**: a project has `src/components/Callout/` — `template.html`,
`isolate/fixture.json`, `isolate/cases/default/default.json`,
`isolate/cases/default/tests/default.spec.ts`. Discovery treats each immediate child of
`<root>/src` as a scan root and walks its descendants (never the root itself), so the
component must sit a folder deeper than `src/` — a bare `src/Callout/` would never be
seen ("Nothing to isolate"), but nested under the `components/` scan root it is. (The
name `Callout` is deliberate: its selector is `sanitize("Callout")` = `callout`, which
is not in the renderer's `NATIVE` tag set — a folder named `Button/` would sanitize to
`button` and collide with the native `<button>` element, [§2](02-2-the-isolate-cli-cli.md).)
`sprig isolate ./app` runs discovery (step 1), which finds `Callout/` and its test;
generation (step 4) emits `/components/Callout/default` + `manifest.gen.ts`; the composed
origin serves at `http://127.0.0.1:<port>/` (step 6 — `sprig isolate`'s port is a
`freePort` forward scan from 8000 (or the caller's `PORT`), set as the child's explicit
`PORT`, [§6](06-6-sprig-isolate-cli-main-ts.md); unlike the direct `dev` path, which just
reads `PORT` env, else `8000`, with no scan); `isolate/cases/default/tests/default.spec.ts` (step 7 — the
separate `test` leg) navigates to `/components/Callout/default` and runs green.

