# 07 — The isolate workbench (cli/ + server/ + app/)

> Subject: the second project in this repo — a Storybook-style component testing
> workbench for sprig apps. `cli/` = the isolate CLI, `server/` = a rune-generated keep
> backend (discovery + testing modules), `app/` = the workbench UI (itself a sprig
> app). The repo root's `serve.ts`/`serve-dev.ts` compose all three; the repo dogfoods
> its own framework.

## 1. What isolate is, end to end

`deno run -A cli/main.ts dev -r <sprig-app>` (or `sprig isolate <app>`):
1. **Discover** — scan the project for folder-components with `isolate/` fixtures.
   Problems split fatal (`fixture-json`, `case-json`, `component-file`,
   `component-export`, `missing-test`) vs advisory (`unsupported`, which never blocks
   anything). A fatal problem aborts the WHOLE `dev` run before anything is generated
   (exit 1) unless `-f/--force` is passed. `--force` does not exclude or repair the
   affected component — discovery's `entries` list is unfiltered either way, so the run
   proceeds with every discovered entry, including the one tied to the fatal problem,
   which previews using whatever fallback the parse/lookup failure left it with (e.g.
   an unparseable `fixture.json` falls back to `{}` — default category, no controls).
   **The TDD gate**: every previewable component and page MUST carry ≥1 co-located
   `*.cy.ts` (§5); a unit with none raises the fatal `missing-test` problem — the UI
   analogue of rune's fault-coverage lint ("every piece of code has a test") — and, like
   the other fatal kinds, aborts `dev`/`test` unless `-f/--force` is passed (§3).
2. **Provision runner** — ensure the Deno-native **`@mrg-keystone/cy-deno@0.2.0`** is
   resolvable (a one-time `deno install`/`deno cache jsr:@mrg-keystone/cy-deno`, or just
   `deno run jsr:@mrg-keystone/cy-deno` on first use) plus a real browser driver: the
   default **webview** (WebKit via Deno FFI — needs `--unstable-ffi`; on Linux
   `libwebkitgtk-6.0-4` + `xvfb-run` for headless), or a **chrome** binary (`CHROME_PATH`,
   for `--video`/deterministic pixels). No npm, no `~/.isolate-runner` node_modules tree,
   no bundled Chromium, no `rxjs`/`isolate-events` package (§2, §5) — this is what retires
   spec 10 §1.6's `ensureRunner` fragility (npm Playwright install leaving `.bin/playwright`
   missing, wiped `~/.isolate-runner`, cold-run crashes).
3. **Materialize workbench** — copy the `app/` template into a per-repo-branch dir
   keyed by `SPRIG_WB_ROOT` (cache-keyed by install version stamp). Unset (the direct
   `deno run -A cli/main.ts dev` path, §6) defaults to the install root itself —
   `cli/lib/workbench.ts`'s `REPO_DIR`, the same directory `cli/`, `server/`, `app/`
   live in — the one shared workbench; there materialize is a no-op copy (it rewrites
   `app/deno.json` in place against the existing template instead of copying it
   anywhere).
4. **Generate previews** — one page per case + `manifest.gen.ts` (see §2).
5. **Build in-process** — `buildClient(<wbApp>/src, <wbRoot>/static)` (no subprocess).
6. **Serve one origin** — `<port>` = `Number(Deno.env.get("PORT") ?? 8000)`: `dev` reads
   its own `PORT` env var (if set) to pick the port, defaulting to 8000 when unset —
   this covers the direct `deno run -A cli/main.ts dev` path; `sprig isolate` (§6)
   always sets `PORT` itself (the supervisor's chosen port) before spawning `dev`, so
   its runs never hit the default. The chosen port is passed to the child as the
   `--port=<port>` flag on `deno serve`, not as an env var. `deno serve … serve-dev.ts`
   with `ISOLATE_PROJECT`, `SPRIG_DEV=1`, `SPRIG_WB_ROOT` set on the child's env;
   prints `http://127.0.0.1:<port>/` (IPv4-explicit on purpose). `serveSprig({ keep:
   api, app, base: "", assetsDir: outDir })` — the stage iframe is same-origin because
   base `""` puts previews at `/components/…`.

## 2. The isolate CLI (`cli/`)

- `main.ts`: cliffy tree, name `isolate` v0.5.0, global `-r/--root` (default `.`),
  default subcommand `list`. **First import MUST be `lib/json-stdout.ts`** — server
  modules log at import time; in `--json` mode it reroutes
  console.log/info/debug → stderr process-wide and exposes `emitJson()` so stdout is
  exactly one JSON document.
- `list` — the only command using the in-process keep client (`lib/keep.ts`);
  table or problems-to-stderr.
- `dev [--no-open] [-f/--force]` — the §1 flow.
- `test [filter] [-j/--json] [--failures-only] [--base-url <url>]` — filter matches
  spec path or `label/case`; resolves the matching co-located `*.cy.ts` specs first (§5).
  If that resolution yields zero files — no filter and the project has no specs at all, or
  a filter that matched none — `test` prints `{ok: true, ran: false, total: 0,
  testResults: []}` (`--json`) or `No matching tests.` and returns immediately: exit 0,
  without ever provisioning the runner or driving cy-deno, so the exit-code contract below
  never applies to this case. This literal is a hand-written early return, not a
  `TestReport` (§3) — it intentionally omits `passed`, `failed`, and `problems` rather
  than zeroing them, so a `--json` consumer must treat those as absent-means-zero/empty on
  this CLI no-match path. Otherwise `test` ensures the Deno-native runner is provisioned
  (§1 step 2 — a `deno`-resolvable `@mrg-keystone/cy-deno@0.2.0` + a webview/chrome
  driver; `test` does NOT require a prior `dev` run and provisions on the spot on a fresh
  machine — no npm, no `~/.isolate-runner`), then materializes/generates/builds regardless
  of `--base-url` (the workbench app is always rebuilt so the case routes exist). When
  `--base-url` is omitted, spawns a preview server (random port 3000-6999, IPv4,
  health-polled) and points the run at it; `--base-url` suppresses that spawn and points at
  the given URL instead. The run itself is **in-process** — `import { run } from
  "jsr:@mrg-keystone/cy-deno/run"; await run({ baseUrl, specDir: <src>, specPattern:
  "**/*.cy.ts", spec: filter, browser, artifactsDir })` (no subprocess, never calls
  `Deno.exit`) — `spec` is `run()`'s programmatic counterpart to the subprocess path's
  `--spec <substring>` flag (§3) and narrows the SAME way: substring-matched against
  spec path/`label/case`; omitted entirely when `filter` is unset, so a bare `test`
  still runs every discovered spec under `specDir`/`specPattern`. The returned `Report`
  is mapped onto isolate's `TestReport` (§3). The exit code follows
  cy-deno's **honest** contract, REPLACING the old "exit 0 iff `ran && failed===0`" rule:
  **exit non-zero whenever `!report.ok`** — `0` all passed, `1` a test failed, `2` no specs
  matched (fault `no-match`), `3` the browser/driver could not launch (fault
  `runner-unavailable`). A spec that merely fails to *load* is now a failed test in the
  report, not a silently-green run — so an agent fleet's "receipt IS the state" contract
  holds (DX-IDEAL §3.7). Every failure path still emits the JSON envelope, now carrying
  `report.llm` (the `artifacts/llm/index.md` bundle) so a fixer/heal loop reads a
  machine-first fault surface, not just a screenshot. `--failures-only` keeps counts, drops
  passing testResults. (The `--json` CLI subprocess — `deno run -A --unstable-ffi
  jsr:@mrg-keystone/cy-deno … --json`, one stdout JSON document, exit codes 0/1/2/3 read
  directly — is the fallback when the in-process `run()` can't be embedded.)
- `update` — self-update of the STANDALONE `~/.isolate` install only: fetches the
  latest `mrg-keystone/isolate` release, swaps it into `~/.isolate`, reinstalls the
  `isolate:`-namespaced skills + the global `isolate` bin (cli/lib/install-core.ts).
  It never touches `~/.sprig`'s workbench copy — the one `sprig isolate` runs (§6) —
  which only `sprig install`/`sprig update` refresh (spec 08 §1).
- `lib/generate-previews.ts` (the generation contract, all output marked
  "Do not edit"):
  - Per case: `app/src/pages/_preview/pv-<slug>-<case>/template.html` — target
    rendered as a **sibling** of `<stage-bridge [meta] [caseData]>` (the bridge can't
    host the target as a child on the client). The bridge remains the interactive `dev`
    workbench's control seam (§4), but headless `*.cy.ts` specs no longer consume it:
    cy-deno's retry-able `cy.get().should()` waits on the DOM directly, so the
    `__isolateReady`/`__isolateEmit` globals and the `isolate-events`
    `capture()`/`waitHydrated()` helpers are retired for tests (§5).
  - Target folder-components copied into `app/src/_preview/targets/<selector>/` plus
    transitive dash-tag deps; `logic.ts` relative imports rewritten to absolute
    `file://` URLs (an import map can't fix relocated relative specifiers).
  - Selectors are slug-normalized by `sanitize` (generate-previews.ts:14):
    lowercase, non-alphanumeric runs → `-`, edge dashes trimmed — the identity for
    a bare lowercase folder name; NO prefix is added (the file header's `x-<name>`
    comment is stale — generate-previews.ts:6 vs :107). Native-tag safety comes
    from the renderer, not this transform: the `NATIVE` set always renders such
    tags native (spec 02 §1), so a target named exactly like a native tag (e.g.
    `button`) would render as the bare element, not the component. A `RESERVED`
    set — exactly `router-outlet`, `content`, `ng-content`, `ng-container`,
    `stage-bridge`, no others — is never treated as a project component.
  - `manifest.gen.ts` = `{ routes: Route[], modules: {load: {resolve}} }`; each module
    calls `previewResolve(meta, baseCase, ctx)`. `meta` = `{name, selector, kind,
    background, controlDefs, subControlDefs, subTargets}`, where `kind: "static" |
    "island"` is the binding axis — the ready gate: island targets wait for scope
    attach, statics are ready at SSR (last bullet below). This is NOT the
    page-vs-component routing axis (discovery's separate `Target`, §3), which never
    appears in `meta` and is instead baked into the route path
    (`/components|pages/<category>/…`); `baseCase` = `{props, signals, innerHtml,
    mocks}`. `app/src/main.ts` best-effort dynamic-imports it (try/catch so
    `deno check` passes without it).
  - Only the project's LEGACY `<src>/css-variables.json` is forwarded into the
    workbench (copied to the workbench app's `src/`, a stale copy removed —
    generate-previews.ts:96-99) so stages theme like the real app. The PREFERRED
    token source, `bootstrap/css-tokens.json` (spec 04 §1 step 5), is NOT forwarded,
    and the `app/` template ships no `bootstrap/` — a project keeping its tokens
    there stages UNTHEMED (§8 item 6).
  - Static targets get prop bindings wired to `caseData.props.*`; island targets get
    NO input bindings (signals applied live by the bridge).

## 3. The server (`server/`) — a rune-generated keep backend

Two modules (`discovery`, `testing`) registered in generated
`bootstrap/modules.ts`, bootstrapped by dev-owned `bootstrap/mod.ts`
(`bootstrapServer("server", modules, {port})`; `PORT` default 3000).

**The rune layering pattern** (per module):
```
<module>.rune                      # the spec
dto/*.ts                           # class-validator DTOs        [GENERATED]
entrypoints/http/mod.ts            # @EndpointController + @Public [GENERATED]
domain/coordinators/<name>/mod.ts  # assert(In) → data → pure core → assert(Out) [GENERATED]
domain/business/<name>/mod.ts      # pure logic (scaffolded once, hand-filled)
domain/data/<name>/mod.ts          # the fs/os I/O boundary
mod-root.ts                        # public surface re-export    [GENERATED]
```
The generated `<name>` slot is filled by four real coordinators: `discovery-scan` +
`manifest-build` (discovery module), `test-run` + `runner-ensure` (testing module); each
module also generates a `mod-root.ts` re-exporting its public surface.
Validation failures at the coordinator seams map to HTTP 422. All endpoints are
`@Public` (the workbench has no login). Faults are **string slugs** thrown as
`Error(slug)` — `scan-failed`, `no-match`, `provision-failed`, `runner-unavailable`,
`timeout` — keep maps them to 422, and `server/fixtures/heal-rules.json` (`v:1`;
`slugs.<slug>` → an array of `{kind:"note", label, why, retryAfter?}`, `retryAfter:true`
on the two provisioning slugs `provision-failed`/`runner-unavailable`) enriches four of
them — `scan-failed`, `no-match`, `provision-failed`, `runner-unavailable` — with a human
remediation note.

Under the cy-deno runner the two testing slugs are **derived from cy-deno's stable
`report.error` contract** (§3 Testing), not from a Playwright spawn: cy-deno's
`error:"no-specs"` (exit 2) → the `no-match` slug; `error:"driver-unavailable"` (exit 3,
the browser/driver couldn't launch — missing webview native libs or chrome binary) → the
`runner-unavailable` slug. The other two testing slugs **change meaning** vs the Playwright
runner:
- `provision-failed` no longer wraps a `playwright --version` probe. Request-time provision
  is still status-only (no install at request time — below), but what it now checks is the
  **Deno-native** runner: `@mrg-keystone/cy-deno@0.2.0` resolvable + a usable webview/chrome
  driver (§1 step 2). Thrown by `get-runner-status`'s data adapter
  (`domain/data/runner/mod.ts`'s `provision()`) only if that non-destructive status probe
  itself throws unexpectedly.
- `timeout` is no longer a Playwright-subprocess abort. The preferred in-process `run()`
  path (§2) spawns no child under an `AbortController`; cy-deno's own retry-able assertions
  carry their internal per-command timeouts, and a hung run surfaces through the report
  (its `llm/` bundle), not a spawn slug. `timeout` therefore only remains reachable on the
  `--json` **subprocess-fallback** path (a spawn-level abort), still with NO heal-rule
  entry — it 422s like the others but carries no remediation note.

`scan-failed` is unchanged — thrown by the discovery module's data adapter
(`domain/data/project/mod.ts`'s `scan()`), which wraps any exception from `discover()` into
`Error("scan-failed")`; since `discover()` never throws in normal operation (per-file
problems — a bad `fixture.json`/case JSON, a missing component file/export, or a component
missing its required `*.cy.ts` — are caught and collected into `problems`, and a missing
scan root is tolerated as zero entries), this fault fires only on an unexpected walk failure
(e.g. a filesystem permission error). `no-match` still covers "a selector matched zero
runnable specs" (a `filter` or explicit `files` list that resolves empty), now also raised
when cy-deno reports `error:"no-specs"`. A bare "run all" (`post-test-run` with neither
`filter` nor `files`) that turns up zero specs project-wide is still NOT this fault — the
runner returns `{ok: true, ran: false, total: 0, passed: 0, failed: 0, testResults: [],
problems: []}` directly, a hardcoded green pass that never drives cy-deno. The CLI's `test`
command never reaches that branch: it resolves its own file list first and returns early
(exit 0, §2) when empty, so it always hands the runner a non-empty selection.

**Discovery** (`server/src/core/business/discover/mod.ts` is the real scanner; the
rune business classes are mostly identity/passthrough):
- Two-stage scan (discover/mod.ts:381-406): the `<projectRoot>/src/*` top-level
  folders are enumerated as the scan ROOTS (`shell` skipped; `pages/` → target `page`,
  else `component` — there is NO canonical component dir, any top-level folder works),
  then each root is walked RECURSIVELY (so 09 §2's `src/**` phrasing is the same scan;
  a nested `src/components/<n>/` is found), skipping any path with an `isolate`
  segment. A folder previews iff it has BOTH `template.html` and `isolate/`; `island`
  iff it also has `logic.ts`.
- Parses `fixture.json` (controls/components/background/category/folder) and
  `cases/<name>/<name>.json`; computes route
  `/components|pages/<category>/[<folder>/]<name>`; collects the entry's co-located
  `*.cy.ts` specs (§5) — per COMPONENT/PAGE now, not per case.
- **The TDD gate**: a previewable component/page (`template.html` + `isolate/`) with ZERO
  co-located `*.cy.ts` raises the FATAL `missing-test` problem — the UI analogue of rune's
  fault-coverage lint ("every piece of code has a test"). RED-first: author the `.cy.ts`
  before the component exists, then build to green off cy-deno's `llm/` report (§2, §5).
  Like the other fatal kinds it aborts `dev`/`test` (exit 1) unless `-f/--force` is passed.
- `Problem` kinds: `fixture-json`, `case-json`, `component-file`, `component-export`,
  `missing-test` (fatal — the TDD gate above), `unsupported` (`_mocks` currently raises
  advisory `unsupported` — possibly stale; the preview harness DOES handle mocks).
- Naming churn: core `entries` ↔ DTO `entrys` (rune pluralizer) renamed on the way out
  (`data/project/mod.ts`) and back (`cli/lib/keep.ts`).
- **Two `@Public` HTTP endpoints** (`entrypoints/http/mod.ts`): `get-discovery`
  (:17, `order: 1`, `getDiscovery(RootDto): DiscoverResultDto`) dispatches to the
  `discovery-scan` coordinator → the scanner above, and is the primary scan route —
  it's what the CLI `list` command hits in-process (`cli/lib/keep.ts` `keep.discover` →
  `call("get-discovery", {projectRoot})` over `api.backend.fetch`, no TCP hop, `entrys`
  renamed back to `entries`). `get-manifest` (:23, `order: 2`,
  `getManifest(RootDto): ManifestDto`) dispatches to the `manifest-build` coordinator
  (next bullet).
- **Second business subject — `manifest`** (`domain/business/manifest/mod.ts`): beyond
  the scanner, the discovery module carries a `Manifest` business —
  `Manifest.fromDiscovery(scan).toDto()` builds the gallery view-model by projecting the
  discovery result ~1:1 (`entrys` + `problems`), the seam reserved for future
  navigator/tree denormalization. Its `manifest-build` coordinator
  (`domain/coordinators/manifest-build/mod.ts`) reads `project.scan(projectRoot)` and runs
  that pure projection; `get-manifest` surfaces it, and the workbench page reaches it
  SSR-only via `DiscoveryService.manifest` (§4).

**Testing**: the runner core (`runTests(req: RunRequest, deps: RunDeps = {})`,
`server/src/core/business/runner/mod.ts`) is the one path both the CLI and the server take —
§2's `runTests({files, baseUrl, projectRoot})` is the same function with `deps` omitted; the
server's data adapter (`domain/data/runner/mod.ts`) calls it as `runTests(dto, deps)`,
passing an explicit `deps` only in tests (deterministic fault injection). It now drives the
Deno-native **`@mrg-keystone/cy-deno@0.2.0`**. The preferred form is programmatic and
**in-process** — `import { run } from "jsr:@mrg-keystone/cy-deno/run"; const report = await
run({ baseUrl, specDir, specPattern, browser?, artifactsDir? })` — which never calls
`Deno.exit` and returns cy-deno's `Report` directly (the "the tool's JSON output IS the
state" discipline, spec 10 §2). The `--json` **CLI subprocess** (`deno run -A
--unstable-ffi jsr:@mrg-keystone/cy-deno --spec-dir <src> --spec-pattern "**/*.cy.ts"
--base-url <url> --browser webview --json`) is the fallback. Spec discovery is cy-deno's own:
`--spec-dir` + `--spec-pattern` (default `**/*.cy.{js,ts}`), spec identity = path relative
to the spec root, `--spec <substring>` filters. This REPLACES the Playwright spawn
(`~/.isolate-runner/.bin/playwright test <specs> --reporter=json` with `NODE_PATH`), the
`runSpec` `AbortController` timeout, and `--config` auto-detection.

cy-deno's **`Report`** is STABLE (byte-identical from `run()`, `--json`, and
`artifacts/report.json`): `{ ok (=== failed===0 && error===null), total, passed, failed
(counted per TEST), browser, error (null | "no-specs" | "driver-unavailable"), llm (path to
artifacts/llm/index.md), tests[] (one entry per ATTEMPT — the final attempt is
authoritative: {spec, name, status, durationMs, attempt, error, commands[]}), failures[]
(one per failed test: error + a regression label vs the previous run + near-miss locator
candidates + its own llm file) }`. `parseReport` maps it onto isolate's **`TestReport`** =
`{ ok, ran, total, passed, failed, testResults[], problems?, error?, browser?, llm? }`:
`ok`/`total`/`passed`/`failed` pass straight through; `ran` = `total > 0`; each
`testResults[]` entry projects a cy-deno test's final attempt (`title` ← `name`, `file` ←
`spec`, `ok` ← `status === "passed"`, `error` ← the test's `error`, `screenshot` ← its
`failures/*.png` when present, `caseName`/`route` recovered from the `cy.visit` route the
failing command hit); `error` carries cy-deno's `error` slug mapped through the fault table
above (`no-specs` → `no-match`, `driver-unavailable` → `runner-unavailable`); `llm` carries
the `artifacts/llm/` bundle path so the fixer/heal loop reads a failures-first, ~2 KB-per-
failing-test machine surface (per-command DOM deltas, per-command console, a repro command,
near-miss locators, the distilled DOM at failure) instead of decoding a screenshot. Because
a load failure is now counted as a **failed test** (not a silent `error`-only note that
left `failed === 0`), `ok` and the exit code agree — the honest-exit-code win of DX-IDEAL
§3.7.

`get-runner-status` (via the `runner-ensure` coordinator) RETURNS a **`RunnerStatusDto`** =
`{ ok, version?, path, message? }` (`server/src/testing/dto/runner-status.ts`): it now
probes the Deno-native runner — is `@mrg-keystone/cy-deno@0.2.0` resolvable and a
webview/chrome driver usable — instead of shelling `playwright --version` against
`~/.isolate-runner/.bin/playwright`. Non-destructive; request-time provision remains
status-only (no install at request time).

## 4. The workbench UI (`app/`)

- Routes: `""` → workbench, `/components` + `/pages` → gallery, plus generated preview
  routes.
- **workbench page**: resolver reads discovery via the SSR-only
  `DiscoveryService.manifest(ISOLATE_PROJECT)` (in-process
  `Backend.get("/http/get-manifest")` — no TCP hop). One island `<workbench>` is the
  whole shell: navigator, ⌘K palette, viewport/zoom/grid/background tools, resizable
  dock (controls/console/tests tabs), toasts, hash routing.
- **gallery page**: static SSR grouping target→category→folder, one `<run-tests>`
  island per case (POSTs `/api/http/post-test-run` from the browser to the same
  `@Public` endpoint (§3) — an actual network request, unlike the in-process call
  above, but gated by nothing: there is no token, no login, no other check anywhere
  in the workbench).
- **stage-bridge island**: a no-render re-export of `lib/preview-harness.ts`, living
  INSIDE the preview iframe as a sibling of the target.

**The postMessage protocol** (`source/target: "isolate-stage"`):
- Shell → stage: `{type:"set", scope, key, instKey?, value}` on control edits;
  `{type:"request"}` to re-publish.
- Stage → shell: `{type:"ready"}` (control surface + hydrated flag),
  `{type:"instances"}`, `{type:"event"}` (console feed).
- The shell mirrors `hydrated` → `__isolateReady` and forwards events →
  `__isolateEmit` on the main frame; the bridge binds listeners once per document and
  delegates through a module-level `active` handle (survives soft-nav re-hydration).

**Fixture data injection:**
- SSR seam `previewResolve(meta, base, ctx)`: `base.props` + query-string overrides +
  `_html` → innerHtml + `_m.<sel>.<key>` → child mock props; returns
  `{meta, caseData, __mocks}`.
- Live seam (bridge): island target → grab `el.__sprigScope`, apply case `_signals`
  via `signal.set` (retry 60×40ms for hydration order), then mark ready. Static
  target → SSR markup is final, ready immediately.
- Control edits: island signals set live (no reload); static props/innerHtml/mocks
  reload the iframe with query overrides; `target:"#css"` sub-controls write the DOM
  element directly.

## 5. The isolate case format

```
<component>/
  template.html                 # (+ logic.ts for an island)
  <name>.cy.ts                  # co-located Cypress spec(s) — the test unit, ≥1 REQUIRED
  isolate/
    fixture.json
    cases/<name>/<name>.json    # preview cases (routes + control data) — unchanged
```

- **fixture.json**: `category` (gallery group + URL segment; default folder name),
  `folder?`, `background?` (legacy `controls._background` honored),
  `controls: { <prop>: ControlDef }` where `ControlDef = { type?: "select"|"range"|
  "color"|"boolean"|"number"|"text", options?, min?, max?, step?, signal?, value? }`
  (`signal:true` = island signal control; bare value shorthand → `{value}`),
  `components: { <name>: {controls, target?} | ControlDef map }` — the shorthand
  drops the wrapper: an object is read as the controls map directly UNLESS it
  carries a `controls` key, in which case it's treated as the full wrapper
  (consequence: a control literally named `controls` must use the full-form
  wrapper, or it's read as one). The shorthand has no `target`; `target: "#css"`
  is only reachable via the full form (`target: "#css"` = direct-DOM instance
  control; no target = mock/re-render path).
- **case json**: bare keys → props; `_name` (label), `_innerHtml`,
  `_signals: {name: value}`, `_mocks: {name: "stub" | true | {stub?, props?}}`.
  The `true` form is discovery's intent-alias for `"stub"` (its `MockSpec` +
  doc comment, discover/mod.ts:57-66) but NO layer translates it — discovery,
  `generate-previews`, and `previewResolve` all pass mocks through verbatim — and
  the render-side type (spec 02 §4) has no boolean form: render.ts:275-279 stubs
  only on `"stub"`/`{stub:true}` and forces props only on `{props}`, so a `true`
  mock renders the child NORMALLY (being truthy it still excludes a mocked island
  from the async pre-pass, render.ts:478). Effectively inert — `"stub"` is the
  working spelling; drift tracked in §8 item 3.
  Props and `_innerHtml` bind to STATIC targets only: an island target's tag carries
  no input bindings (§2), so they never reach an island — not at SSR and not live
  (the bridge applies only `_signals`, preview-harness.ts:262-264). Island props
  merely seed the dock's prop-control values (a prop-control edit reloads the iframe
  without affecting the island); an island takes its case data via `_signals`, while
  `_mocks` still applies to its child components (`__mocks` rides the render opts +
  props bridge, spec 02 §4).
- **tests**: co-located **Cypress `*.cy.ts` specs** driven by cy-deno (NOT Playwright,
  NOT deno test). No import ceremony — the `cy.*` API is ambient (types via
  `{ "compilerOptions": { "types": ["jsr:@mrg-keystone/cy-deno/types"] } }`); TS is
  type-stripped, no build step. `.should(...)` assertions RETRY, so hydration and async
  DOM settle without any `waitHydrated`/`__isolateReady` poll — the `isolate-events`
  `capture()`/`waitHydrated()` helpers and the `__isolateReady`/`__isolateEmit` globals are
  RETIRED for tests (the stage-bridge keeps them only for the interactive `dev` dock, §4).
  Available: `visit, get, contains, click, type, select, clear, check, uncheck, mount,
  session, screenshot, request, wait, title, document`, chai-subset `expect()`, aliases
  `.as()`/`cy.get('@name')`, `Cypress.Commands.add`, `before/beforeEach/afterEach/after`
  hooks, an optional support file, per-test isolation (storage cleared + neutral page
  between tests; `testIsolation:false` opts out), `cy.session` snapshot/restore, console
  capture, and `cy.screenshot(name)` visual regression (pixel-diffed vs a baseline —
  deterministic on chrome). Honest limits: **no `cy.intercept` yet** (no network stubbing —
  rely on the SSR/fixture data isolate already serves), webview screenshots are
  whole-display + opt-in (`CY_DENO_SCREEN_CAPTURE=1`), `--video` is chrome-only.
- **Two isolation modes** (state both; pick per target kind):
  1. **`cy.visit(<case route>)`** against the isolate preview server — the route is the
     generated `/components|pages/<category>/[<folder>/]<case>` (§3), JS is served, so real
     hydration runs. **Recommended for islands and pages.**
  2. **`cy.mount(ssrHtml)`** — server-LESS: cy-deno serves the given HTML over http and
     navigates to it, and inline `<script>` executes. Relative `src`/`href` are NOT served
     (no static file server behind the mount), so for an ISLAND the client bundle
     (`client.js` + `isl.<selector>.js`) must be **inlined** into the mounted HTML for
     hydration to run; absolute URLs load from wherever they point. **Recommended for
     static/pure-unit components.**
- **The TDD gate** (§3 discovery): every component and page MUST carry ≥1 `*.cy.ts` — a unit
  with none is a fatal `missing-test` discovery problem. RED-first: author the spec, then
  build the component to green off cy-deno's `llm/` report.

## 6. `sprig isolate` ↔ `cli/main.ts`

The framework CLI's `isolate` subcommand is a thin supervisor: assert the workbench is
installed (`~/.sprig` must contain `app`, `server`, `cli`, `serve.ts` — else "run
`sprig update`"), pick a port, and spawn
`deno run -A --config <installRoot>/deno.json <installRoot>/cli/main.ts dev --root
<appAbs>`, setting `PORT` + `SPRIG_WB_ROOT` (`$TMPDIR/sprig-work/<repoKey>`).
`SPRIG_WB_ROOT` is the isolation key — without it, concurrent runs regenerate the one
shared workbench (the install root itself, named in §1 step 3) and delete each other's
previews mid-run.

## 7. Generated-vs-authored boundaries

- **Generated, never hand-edit**: `app/src/pages/_preview/**` (incl.
  `manifest.gen.ts`), `app/src/_preview/targets/**` (removed + rewritten each run);
  the rune tree (`bootstrap/modules.ts`, `dto/`, `entrypoints/`, `coordinators/`,
  `mod-root.ts`).
- **Dev-owned / hand-filled**: `bootstrap/mod.ts`, `bootstrap/config.ts`,
  `domain/business/*/mod.ts` (scaffolded once, sync preserves).
- **Authored**: `cli/`, `server/src/core/**` (the ported pure cores), the rest of
  `app/src/`, `serve.ts`, `serve-dev.ts`, `.rune` specs, `heal-rules.json`, fixture
  `isolate/` inputs, and the co-located `*.cy.ts` specs (RED-first, §5). The old
  `cli/lib/events/` `isolate-events` helper is retired with the Playwright runner (§1
  step 2, §5).
- **Legacy/dead**: `fixtures/sprig-app/src/_isolate/` (old generation artifact; nothing
  reads it; `framework/cli.ts` skips `_isolate` dirs).

## 8. Known drift + refactor targets

1. **Doc drift**: `cli/README.md` describes a stale Vite/Fresh architecture; the
   `discovery.rune` TYP descriptions still say Fresh/`.tsx`/PascalCase;
   `docs/guide.md` contains no isolate content at all (only the root README blurb).
   Version strings disagree (CLI `0.5.0`, workbench UI `v0.4`, repo
   `0.20.36-beta.1`).
2. **Four access paths to the same logic**: `list` via in-process keep client;
   `dev`/`test` import core functions directly; the UI via `Backend` DI; the browser
   via `/api/*`. Consolidation target.
3. **`_mocks`** flagged `unsupported` by discovery while the preview path implements
   it; the case-format `true` alias for `"stub"` is render-side inert (§5) —
   reconcile both.
4. `assetsDir` must be explicit in both compose roots (derived default points at a
   nonexistent dir for the workbench layout) — a silent 404-everything failure mode.
5. The `entries`/`entrys` double rename exists only because of rune's pluralizer —
   fix at the spec level.
6. Token forwarding covers only the legacy `src/css-variables.json`
   (generate-previews.ts:96-99); the preferred `bootstrap/css-tokens.json` (spec 04
   §1 step 5) never reaches the workbench, so apps on the preferred source get
   unthemed stages.
