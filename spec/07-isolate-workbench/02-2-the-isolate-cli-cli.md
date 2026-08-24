## 2. The isolate CLI (`cli/`)

`main.ts`: cliffy tree, name `isolate` v0.5.0. **First import MUST be
`lib/json-stdout.ts`** — server modules log at import time; in `--json` mode it
reroutes console.log/info/debug → stderr process-wide and exposes `emitJson()` so
stdout is exactly one JSON document.

| Command | Args/flags | Job | stdout / exit |
|---|---|---|---|
| *(global)* | `-r/--root <path>` (default `.`) | project root every command below targets | — |
| `list` *(default subcommand)* | — | scan via the in-process keep client (`lib/keep.ts`) — the only command using it | table to stdout, or discovery problems to stderr |
| `dev` | `[--no-open] [-f/--force]` | run the full [§1](01-1-what-isolate-is-end-to-end.md) flow (discover → provision → materialize → generate → build → serve) | serves at the printed URL ([§1](01-1-what-isolate-is-end-to-end.md) step 6); exit 1 on a fatal discovery problem — `fixture-json`/`case-json`/`component-file`/`component-export` ([§3](03-3-the-server-server-a-rune-generated-keep-backend.md); the last two are vestigial, see `test` step 1 below), NOT a testless unit — unless `-f` ([§1](01-1-what-isolate-is-end-to-end.md) step 1) |
| `test` | `[filter] [-j/--json] [--failures-only] [--base-url <url>]` | resolve matching specs, provision the Playwright runner + build, run them via a subprocess (or against `--base-url`) | `--json` envelope or console text; exit per the table below |
| `update` | — | self-update the STANDALONE `~/.isolate` install only | — |

- `test [filter] [-j/--json] [--failures-only] [--base-url <url>]` — pipeline. **As-built,
  this runs the Playwright runner, not the [DX-IDEAL §3.7](../DX-IDEAL/04-3-per-subsystem-ideal.md)
  TARGET**: the Deno-native cy-deno runner (no npm, no `~/.isolate-runner`, the honest
  `0`/`1`/`2`/`3` exit contract) has not been built. Every step below is what runs today:
  1. **Discover, fail fast on fatal config problems** — `discover(root)` runs first;
     any problem with `kind !== "unsupported"` (`fixture-json`/`case-json`/
     `component-file`/`component-export`) is fatal and short-circuits the whole
     pipeline before any spec is resolved: `Deno.exit(1)`, `--json` printing `{ok:
     false, ran: false, total: 0, testResults: [], problems: <fatal problems>}` — a
     `problems` array, NO `error` field (exit-code table below, row 3); text mode
     prints the formatted problems to stderr instead. Only `unsupported`-kind problems
     (advisory `_mocks` notes) are non-fatal and let the pipeline continue. *(`Problem.kind`
     is a 5-value union, but the as-built folder-component scanner's live `discover()`
     only ever emits `fixture-json`/`case-json`/`unsupported` — `component-file`/
     `component-export` are produced solely by `findComponentFile`, which nothing calls
     ([§3](03-3-the-server-server-a-rune-generated-keep-backend.md)). A builder should NOT read this as license to add a
     `.tsx` export-validation gate; no such check exists in the current discovery path.)*
  2. **Resolve specs** — `filter` matches spec path or `label/case`; resolve the matching
     per-case `<case>/tests/*.spec.ts` files discovery already collected
     ([§5](05-5-the-isolate-case-format.md)). *(The §3.7 target moves the test unit to a
     co-located `<Component>.cy.ts`; today that file sits outside every scanned `tests/`
     dir, so a builder who writes one gets zero discovered tests — the component still
     previews fine, but `test` silently reports "No matching tests." at exit 0, the SAME
     path as an empty project.)*
  3. **Early-return if zero** — if that resolution yields zero files (no filter and the
     project has no specs at all, or a filter that matched none), return immediately
     without ever provisioning the runner (exit-code table below, row 1). *(This is a
     hand-written early return, not a `TestReport` ([§3](03-3-the-server-server-a-rune-generated-keep-backend.md)) — a `--json`
     consumer must treat its omitted `passed`/`failed`/`problems` as
     absent-means-zero/empty, not zeroed.)*
  4. **Provision runner** — otherwise ensure `~/.isolate-runner` is provisioned
     (`cli/lib/runner.ts`'s `ensureRunner()`): `npm i @playwright/test` (version-matched
     to a system `playwright` when found) + `rxjs` + a copy of the `isolate-events`
     helper, all under `~/.isolate-runner/node_modules`. *(`test` does NOT require a
     prior `dev` run and provisions on the spot on a fresh machine — but, unlike the
     §3.7 target, it needs npm/Node.js on `PATH`; a missing npm or an incomplete install
     prints the exact gap + fix command and fails the run, [§8](08-8-known-drift-refactor-targets.md).)*
  5. **Materialize/build** — regardless of `--base-url` (the workbench app is always
     rebuilt so the case routes exist).
  6. **`--base-url` present?** spawn preview : point at URL — when `--base-url` is
     omitted, spawn a preview server (random port 3000-6999, IPv4, health-polled) and
     point the run at it; `--base-url` suppresses that spawn and points at the given URL
     instead.
  7. **Spawn Playwright** — `server/…/runner/mod.ts`'s `runTests()` shells out to
     `${RUNNER_DIR}/.bin/playwright test <safe spec files> --reporter=json [--config
     <path>]` — a real subprocess, not an in-process call — with `ISOLATE_BASE_URL` set
     to the resolved preview URL and a 120s default timeout (`ISOLATE_SPAWN_TIMEOUT_MS`
     overrides it). `runTests` itself throws `"no-match"` if its own path-safety check
     filters out every resolved file, or `"runner-unavailable"` if
     `~/.isolate-runner`'s Playwright binary is missing — both are caught by the step
     below, not surfaced as their own exit code.
  8. **Parse `stdout` → `TestReport`** — `parseReport()` reads Playwright's
     `--reporter=json` output into isolate's `TestReport` ([§3](03-3-the-server-server-a-rune-generated-keep-backend.md)); a spec that fails
     to *load* (unresolvable import, syntax error) surfaces only in Playwright's
     top-level `errors`, which `parseReport` folds into `report.error` instead of
     silently returning a contentless `{ran: false, total: 0}`.
  9. **Exit per table** — `test.ts`'s own rule: exit `0` iff `report.ran && report.failed
     === 0`, else `1`. *(The [DX-IDEAL §3.7](../DX-IDEAL/04-3-per-subsystem-ideal.md) target
     replaces this with cy-deno's honest contract — exit non-zero whenever `!report.ok`,
     with `no-match`/`runner-unavailable` as their OWN exit codes (`2`/`3`) instead of
     collapsing into `1` — closing the "a spec that merely fails to load reports green"
     gap ([DX-IDEAL §3](../DX-IDEAL/04-3-per-subsystem-ideal.md).7). Not yet built: today
     both faults, and a spawn timeout, land in the same catch-all as row 4 below.)*

  | Exit | Condition | JSON shape (`--json`) |
  |---|---|---|
  | `0` | CLI's own spec resolution (above) matches zero files — early return, runner never provisioned | `{ok: true, ran: false, total: 0, testResults: []}`: a hand-written literal, NOT a `TestReport` — omits `passed`/`failed`/`problems` (absent-means-zero/empty) |
  | `0` | all matched specs ran, `report.ran && report.failed === 0` — exit `0` reflects ONLY that condition, not `report.ok` | full `TestReport` ([§3](03-3-the-server-server-a-rune-generated-keep-backend.md)); `ok:true` when nothing else went wrong, but `ok:false` (with `report.error` naming a load failure) is possible on this SAME exit `0` when a spec failed to *load* — Playwright's own `errors` still yields `ran:true, failed:0` (step 8 above), so exit `0` does NOT imply `ok:true` |
  | `1` | discover-fatal: `discover(root)` found ≥1 problem with `kind !== "unsupported"` (step 1 above) — checked before spec resolution ever runs | `{ok: false, ran: false, total: 0, testResults: [], problems: <fatal problems>}` — a `problems` array, NO `error` field |
  | `1` | anything else that reaches a verdict: a test failed, `runTests`' own path-safety filter left zero of the CLI's non-empty selection surviving and it throws `no-match` BEFORE Playwright is ever spawned (step 7 above), the runner binary is missing (`runner-unavailable`), the spawn timed out, or the preview/build stage failed before any test ran | full `TestReport` when Playwright's JSON parsed; else `{ok:false, ran:false, total:0, testResults:[], error:<message>}` naming the fault |

  `--failures-only` keeps counts, drops passing testResults, on any `--json` row above
  that carries a full `TestReport`.

  **Trace** — four runs through the pipeline above (`TestReport`'s shape is
  [§3](03-3-the-server-server-a-rune-generated-keep-backend.md)'s to define):
  - `isolate test` on a project with a malformed fixture/case JSON — step 1's
    discover-fatal check fires before any spec is even resolved → exit `1`; `--json`
    prints `{ok: false, ran: false, total: 0, testResults: [], problems: <fatal
    problems>}`, NOT the exit-`0` empty-project literal below.
  - `isolate test` on a project with no cases at all and no fatal discovery problems
    (or `isolate test typo` on such a project, where `typo` matches no spec path or
    `label/case`) — step 2 resolves zero files, step 3's early return fires before the
    runner is ever provisioned → exit `0`; `--json` prints the hand-written literal
    `{ok: true, ran: false, total: 0, testResults: []}`. This exit-`0` empty case holds
    only when BOTH are true — zero cases resolved AND zero fatal discovery problems;
    a malformed fixture/case JSON exits `1` (bullet above) even though it also
    resolves zero specs.
  - `isolate test Button` where `Button`'s one case has a passing
    `cases/default/tests/default.spec.ts` — steps 4-8 all run → exit `0`; `--json`
    prints the full `TestReport` with `ok:true, ran:true, total:1, passed:1, failed:0`.
  - `isolate test Button` where that same spec's assertion fails — the identical
    pipeline runs, `report.failed` is now `1` → exit `1`; `--json` prints the same
    `TestReport` shape with `ok:false, failed:1` and `testResults[0].error` naming the
    assertion. *(This exit-`1` bucket also catches `runTests`' own pre-spawn `no-match`
    throw — zero of the CLI's non-empty selection surviving its path-safety filter,
    step 7 above, not a Playwright result — and a missing runner: exit table row 4;
    the [DX-IDEAL §3.7](../DX-IDEAL/04-3-per-subsystem-ideal.md) target gives those their
    own `2`/`3` codes instead.)*
- `update` — self-update of the STANDALONE `~/.isolate` install only: fetches the
  latest `mrg-keystone/isolate` release, swaps it into `~/.isolate`, reinstalls the
  `isolate:`-namespaced skills + the global `isolate` bin (cli/lib/install-core.ts).
  It never touches `~/.sprig`'s workbench copy — the one `sprig isolate` runs ([§6](06-6-sprig-isolate-cli-main-ts.md)) —
  which only `sprig install`/`sprig update` refresh (spec 08 [§1](../08-install-skills-annotate/01-1-why-a-local-install-exists-at-all.md)).
- `lib/generate-previews.ts` (the generation contract — all output is generated/
  clobbered every run, but only `manifest.gen.ts` carries a literal "Do not edit"
  header (generate-previews.ts:144); the per-case `template.html`, the copied target
  components, and the `css-variables.json` copy are written unmarked, so the file tree —
  not a per-file marker — is what says "generated", [§7](07-7-generated-vs-authored-boundaries.md)):
  1. Per case: `app/src/pages/_preview/pv-<slug>-<case>/template.html` — target
    rendered as a **sibling** of `<stage-bridge [meta] [caseData]>` (the bridge can't
    host the target as a child on the client). The bridge is the interactive `dev`
    workbench's control seam ([§4](04-4-the-workbench-ui-app.md)) AND, as-built, the headless
    `*.spec.ts` tests' readiness gate: `ensureRunner()` provisions the `isolate-events`
    helper into `~/.isolate-runner` precisely so those specs can `capture()`/
    `waitHydrated()` against the bridge's `__isolateReady`/`__isolateEmit` globals before
    asserting. *(The [DX-IDEAL §3.7](../DX-IDEAL/04-3-per-subsystem-ideal.md) target retires this handshake for
    tests: cy-deno's retry-able `cy.get().should()` waits on the DOM directly, so a
    co-located `*.cy.ts` spec would need neither the globals nor the helper — not yet
    built.)*
  2. Target folder-components copied into `app/src/_preview/targets/<selector>/` plus
    transitive dash-tag deps; `logic.ts` relative imports rewritten to absolute
    `file://` URLs (an import map can't fix relocated relative specifiers).
  3. Selectors are slug-normalized by `sanitize` (generate-previews.ts:14):
    lowercase, non-alphanumeric runs → `-`, edge dashes trimmed — the identity for
    a bare lowercase folder name; NO prefix is added (the file header's `x-<name>`
    comment is stale — generate-previews.ts:6 vs :107). Native-tag safety comes
    from the renderer, not this transform: the `NATIVE` set always renders such
    tags native (spec 02 [§1](../02-template-compiler/02-1-template-syntax-grammar-tree-sitter-angular-template-gramm.md)), so a target named exactly like a native tag (e.g.
    `button`) would render as the bare element, not the component. A `RESERVED`
    set — exactly `router-outlet`, `content`, `ng-content`, `ng-container`,
    `stage-bridge`, no others — is never treated as a project component.
  4. `manifest.gen.ts` — the generated build artifact's own schema (distinct from the
    server's discovery `Manifest` business subject, [§3](03-3-the-server-server-a-rune-generated-keep-backend.md)):
    - `type Manifest = { routes: Route[]; modules: Record<string, { resolve: Resolve }> }`
      — `Route`'s fields are core's own (`{path, load?, children?, guards?, meta?,
      requiredGrant?}`, [§3 routing](../01-core-runtime/03-3-routing-semantics-core-ts-486-644.md)); `modules` is keyed by each route's `load` string
      — the SAME key `bootstrap()` reads at request time
      (`config.modules?.[matched.load]?.resolve`, [§4 bootstrap](../01-core-runtime/04-4-bootstrap-request-pipeline-core-ts-709-850.md) step 7). Each
      module's `resolve: Resolve` ([§1 core surface](../01-core-runtime/01-1-public-api-surface-all-of-mrg-keystone-sprig.md)) closes over the case's `meta`/`baseCase`
      and calls `previewResolve(meta, baseCase, ctx)`.
    - `type Meta` — `controlDefs`/`subControlDefs`/`subTargets` are `ComponentEntry`'s
      own fields (discovery's `discover/mod.ts`), passed through generate-previews.ts
      unchanged into each `Meta` literal; `ControlDef`'s own union
      (`type?: "select"|"range"|"color"|"boolean"|"number"|"text"; options?; min?; max?;
      step?; signal?; value?`) is [§5](05-5-the-isolate-case-format.md)'s to define, not repeated here:

      | field | type | parsed from | note |
      |---|---|---|---|
      | `name` | `string` | `ComponentEntry.label` (folder basename) | — |
      | `selector` | `string` | `sanitize(e.label)` | the renderer-safe tag name (rules 2-3 above) |
      | `kind` | `"static" \| "island"` | `ComponentEntry.kind` | the binding axis, the ready gate: island targets wait for scope attach, statics are ready at SSR (last bullet below). NOT the page-vs-component routing axis (discovery's separate `Target`, [§3](03-3-the-server-server-a-rune-generated-keep-backend.md)), which never appears in `meta` and is baked into the route path (`/components\|pages/<category>/…`) instead |
      | `background?` | `string` | `ComponentEntry.background` | — |
      | `controlDefs` | `Record<string, ControlDef>` | fixture.json's top-level `controls`, parsed 1:1 | — |
      | `subControlDefs` | `Record<subName, Record<prop, ControlDef>>` | fixture.json's `components[name].controls` — or `components[name]` directly, the shorthand where the object itself IS the controls map unless it carries a `controls` key (full vs. shorthand form, [§5](05-5-the-isolate-case-format.md)) | keyed by each sub-component's function name (or, for per-instance controls, an instance label) |
      | `subTargets` | `Record<subName, string>` | the wrapper form's optional `target` CSS selector | populated only when that sub-component's panel should target one specific rendered instance directly rather than every instance via the mock/re-render path |
    - `type BaseCase = { props; signals; innerHtml; mocks }` — sourced from case json's
      bare keys / `_signals` / `_innerHtml` / `_mocks` ([§5](05-5-the-isolate-case-format.md)).
    - `previewResolve(meta: Meta, baseCase: BaseCase, ctx: ResolveCtx): { meta: Meta;
      caseData: Record<string, unknown>; __mocks: Record<string, MockSpec> }` — the SSR
      fixture-injection seam ([§4](04-4-the-workbench-ui-app.md)); `ctx` is core's own `ResolveCtx = {params, url}`
      ([§1 core surface](../01-core-runtime/01-1-public-api-surface-all-of-mrg-keystone-sprig.md)); `caseData` = `{ props: baseCase.props,
      signals: baseCase.signals, innerHtml: baseCase.innerHtml, mocks: baseCase.mocks
      }` — `signals` passes through unedited (island signals are applied live by the
      bridge, never through this seam) and `mocks` stays NESTED under its own key (not
      spread) — plus query-string overrides applied before the return: any param other
      than `_html`/`_m.*` is coerced and merged into `props`, `_html` overrides
      `innerHtml`, and `_m.<sel>.<key>` merges into `mocks[<sel>].props[<key>]`.
    - `app/src/main.ts` best-effort dynamic-imports `manifest.gen.ts` (try/catch so
      `deno check` passes without it).
  5. Only the project's LEGACY `<src>/css-variables.json` is forwarded into the
    workbench (copied to the workbench app's `src/`, a stale copy removed —
    generate-previews.ts:96-99) so stages theme like the real app. The PREFERRED
    token source, `bootstrap/css-tokens.json` (spec 04 [§1](../04-build-pipeline-and-artifacts/01-1-pipeline-buildclient-srcdir-outdir-build-ts-63-298.md) step 5), is NOT forwarded,
    and the `app/` template ships no `bootstrap/` — a project keeping its tokens
    there stages UNTHEMED ([§8](08-8-known-drift-refactor-targets.md) item 6).
  6. Static targets get prop bindings wired to `caseData.props.*` AND, when
    `caseData.innerHtml` is a string, a `[content]="caseData.innerHtml"` binding
    (generate-previews.ts:73-79) — this is what makes the `_html`/`innerHtml`
    case (rule 4's `BaseCase`, [§5](05-5-the-isolate-case-format.md)) actually render; island
    targets get NO input bindings at all, content included (signals applied live
    by the bridge).

  **Worked example** — a `Card/` target (a static component) with one case,
  `primary`:
  ```
  Card/
    template.html
    isolate/
      fixture.json                      # category: "layout", controls: { title: {value: "Untitled"} }
      cases/primary/
        primary.json                    # { title: "Welcome" }
        tests/primary.spec.ts           # Playwright test for this case
  ```
  produces (`Card/` living directly under `src/components/`, so `e.slug` is the
  root-qualified `"components__Card"`, sanitized to `"components-card"` — not just the
  folder name; this is what disambiguates a `components/Card` from a same-named
  `pages/Card`):
  - `app/src/pages/_preview/pv-components-card-primary/template.html` — `<card>` rendered
    as a sibling of `<stage-bridge [meta] [caseData]>` (rule 1).
  - `app/src/_preview/targets/card/` — `Card/`'s folder-component copied verbatim;
    selector `card` (`sanitize("Card")` → `"card"`, no prefix — not a `NATIVE`/
    `RESERVED` collision, rules 2-3).
  - a `manifest.gen.ts` entry (rule 4):
    ```ts
    // routes[]
    { path: "components/layout/primary", load: "./pages/_preview/pv-components-card-primary" }

    // modules["./pages/_preview/pv-components-card-primary"]
    {
      resolve: (ctx) => previewResolve(
        { name: "Card", selector: "card", kind: "static",
          controlDefs: { title: { value: "Untitled" } },
          subControlDefs: {}, subTargets: {} },
        { props: { title: "Welcome" }, signals: {}, innerHtml: null, mocks: {} },
        ctx,
      ),
    }
    ```
  - `kind: "static"` ⇒ `title` is wired to `caseData.props.title` at SSR (rule 6); an
    island `Card` would instead get no input binding, with `baseCase.signals` applied
    live by the bridge.
  - The same project's `<src>/css-variables.json`, if present, is copied into the
    workbench once — project-wide, not per case (rule 5).

