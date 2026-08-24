## 3. The server (`server/`) — a rune-generated keep backend

Two modules (`discovery`, `testing`) registered in generated
`bootstrap/modules.ts`, bootstrapped by dev-owned `bootstrap/mod.ts`
(`bootstrapServer("server", modules, {port})`; `PORT` default 3000).

**The rune layering pattern** (per module — which of these files are generated vs
hand-authored is [§7](07-7-generated-vs-authored-boundaries.md)'s call, not this diagram's):
```
<module>.rune                      # the spec
dto/*.ts                           # class-validator DTOs
entrypoints/http/mod.ts            # @EndpointController + @Public
domain/coordinators/<name>/mod.ts  # assert(In) → data → pure core → assert(Out)
domain/business/<name>/mod.ts      # pure logic
domain/data/<name>/mod.ts          # the fs/os I/O boundary
mod-root.ts                        # public surface re-export
```
The `<name>` slot is filled by four real coordinators: `discovery-scan` +
`manifest-build` (discovery module), `test-run` + `runner-ensure` (testing module); each
module also produces a `mod-root.ts` re-exporting its public surface.
Validation failures at the coordinator seams map to HTTP 422. All endpoints are
`@Public` (the workbench has no login):

| endpoint | order | route | in DTO → out DTO | coordinator | module | primary caller |
| --- | --- | --- | --- | --- | --- | --- |
| `get-discovery` (`entrypoints/http/mod.ts:17`) | 1 | `/http/get-discovery` | `RootDto` → `DiscoverResultDto` | `discovery-scan` | discovery | CLI `list`, in-process (`cli/lib/keep.ts` `keep.discover` → `call("get-discovery", {projectRoot})` over `api.backend.fetch`, no TCP hop; `entrys` renamed back to `entries`) |
| `get-manifest` (`entrypoints/http/mod.ts:23`) | 2 | `/http/get-manifest` | `RootDto` → `ManifestDto` | `manifest-build` | discovery | workbench page, SSR-only (`DiscoveryService.manifest`, [§4](04-4-the-workbench-ui-app.md)) |
| `post-test-run` | — | `/http/post-test-run` | `TestRunRequestDto` → `TestReport` | `test-run` | testing | gallery page's `<run-tests>` island — an actual browser POST to `/api/http/post-test-run`, gated by nothing ([§4](04-4-the-workbench-ui-app.md)) |
| `get-runner-status` | — | `/http/get-runner-status` | `RootDto` → `RunnerStatusDto` | `runner-ensure` | testing | — (not wired to a caller in the documented flows; `dev`/`test` provisioning calls the business function directly, in-process, bypassing this route) |

In-process callers (CLI, SSR) hit `/http/<endpoint>` directly via `call()`/`Backend`, no
TCP hop; the one browser caller goes through the `/api/http/<endpoint>` proxy instead.
Order/line anchors not given above are per-module `entrypoints/http/mod.ts` positions
the spec doesn't pin down. Faults are **string slugs** thrown as `Error(slug)`; the full
taxonomy — trigger, HTTP mapping, heal-rule enrichment — is at the end of this section,
after the happy-path responsibilities below.

**Discovery** (`server/src/core/business/discover/mod.ts` is the real scanner; the
rune business classes are mostly identity/passthrough):
- **Discoverability predicates** (two-stage scan, discover/mod.ts:381-406):
  - scan-root classification: the `<projectRoot>/src/*` top-level folders are the scan
    ROOTS — `shell` skipped; `pages/` → target `page`; else → target `component` (there
    is NO canonical component dir, any top-level folder works).
  - recursive walk: each root is walked RECURSIVELY (so 09 [§2](../09-ecosystem-contracts/02-2-sprig-s-spec-obligations.md)'s `src/**` phrasing is
    the same scan; a nested `src/components/<n>/` is found), skipping any path with an
    `isolate` segment.
  - previewable iff: `template.html` AND `isolate/` are both present.
  - island iff: previewable AND `logic.ts` is also present.
- Parses `fixture.json` (controls/components/background/category/folder) and
  `cases/<name>/<name>.json`; computes route
  `/components|pages/<category>/[<folder>/]<name>`; `collectTests` gathers each case's
  own `cases/<name>/tests/*.spec.ts` specs ([§5](05-5-the-isolate-case-format.md)) — per
  CASE, not per component/page.
- `Problem` kinds (`discover/mod.ts`'s `Problem.kind`) — fatal kinds abort `dev`/`test`
  (exit 1) unless `-f/--force` is passed ([§2](02-2-the-isolate-cli-cli.md)):

  | kind | trigger | fatal/advisory |
  | --- | --- | --- |
  | `fixture-json` | `fixture.json` fails to parse | fatal |
  | `case-json` | a case's `<name>.json` fails to parse | fatal |
  | `component-file` | no `.tsx` in the folder matches the export name (exact or case-insensitive) | fatal |
  | `component-export` | the matched `.tsx` exports neither `default` nor the expected name | fatal |
  | `unsupported` | a case's `_mocks` is set — sub-component mocking isn't wired into sprig previews yet (possibly stale: the preview harness DOES handle mocks) | advisory |

  There is no test-coverage gate — a previewable unit with zero specs raises no problem
  at all; it simply has nothing to run.
- Naming churn: core `entries` ↔ DTO `entrys` (rune pluralizer) renamed on the way out
  (`data/project/mod.ts`) and back (`cli/lib/keep.ts`).
- **Second business subject — `manifest`** (`domain/business/manifest/mod.ts`): beyond
  the scanner, the discovery module carries a `Manifest` business —
  `Manifest.fromDiscovery(scan).toDto()` builds the gallery view-model by projecting the
  discovery result ~1:1 (`entrys` + `problems`), the seam reserved for future
  navigator/tree denormalization. Its `manifest-build` coordinator
  (`domain/coordinators/manifest-build/mod.ts`) reads `project.scan(projectRoot)` and runs
  that pure projection; `get-manifest` surfaces it, and the workbench page reaches it
  SSR-only via `DiscoveryService.manifest` ([§4](04-4-the-workbench-ui-app.md)).

**Testing**: the runner core (`runTests(req: RunRequest, deps: RunDeps = {})`,
`server/src/core/business/runner/mod.ts`) is the one path both the CLI and the server take —
[§2](02-2-the-isolate-cli-cli.md)'s `runTests({files, baseUrl, projectRoot})` is the same function with `deps` omitted; the
server's data adapter (`domain/data/runner/mod.ts`) calls it as `runTests(dto, deps)`,
passing an explicit `deps` only in tests (deterministic fault injection). It drives the
**Playwright** runner provisioned at `~/.isolate-runner` (`PW_BIN =
~/.isolate-runner/node_modules/.bin/playwright`): resolve specs (explicit `files` or
discovery), path-safety-filter them against the project root (`specReason`), spawn
`playwright test <safe-files> --reporter=json [--config <path>]` via `runSpec` (a
`Deno.Command` wrapped in an `AbortController` hard timeout — `DEFAULT_TIMEOUT_MS` =
the `ISOLATE_SPAWN_TIMEOUT_MS` env var or a 120s default; a whole-app suite is one spawn,
so a large suite needs the env override), and parse its JSON-reporter stdout with
`parseReport`. `--config` is `req.config` when given, else the first of
`playwright.config.ts`/`playwright.config.js` found at `projectRoot` (auto-detected). DX-IDEAL
§3.7 targets replacing this Playwright spawn with the Deno-native `@mrg-keystone/cy-deno`
runner (in-process `run()`, no child process, no CLI-subprocess fallback) — not yet built;
everything below this line is the Playwright as-built.

The wire DTO **`TestRunRequestDto`** (`server/src/testing/dto/test-run-request.ts`) —
the `post-test-run` endpoint's `in DTO`, above — carries only `{filter?, files?, baseUrl?,
projectRoot?}`; the data adapter passes it straight into `runTests`, so a browser POST can
never carry `config`. The runner-core **`RunRequest`** (`server/src/core/business/runner/mod.ts`)
is a superset adding a fifth field, `config?`, set only by an in-process caller that builds
the request by hand — no wire caller sets it. As-built, `runTests` resolves whichever of
these fields are present into the literal Playwright arg list with no directory-folding and
no glob synthesis:

| `RunRequest` field | wire (`TestRunRequestDto`)? | as-built handling |
| --- | --- | --- |
| `files` (non-empty) | yes | passed straight through — each entry becomes a literal path arg to `playwright test`, after the path-safety filter (`specReason`) drops anything outside the project root or not matching `.spec.ts[x]` |
| `files` (omitted) | yes | `runTests` calls `discover(root)` instead and flattens every case's `tests[]` into the file list, recording each file's `caseName`/`route` in a lookup map that `parseReport` uses to attach them to the matching `TestResultDto` |
| `filter` | yes | narrows whichever list (explicit `files` or discovered) to entries whose file path or case name includes the substring |
| `baseUrl` | yes | reaches the spawned Playwright process as the `ISOLATE_BASE_URL` env var |
| `config` | no — `RunRequest`-only | passed as `--config <path>`; auto-detected at `projectRoot` when omitted (above) |

DX-IDEAL §3.7's cy-deno target changes the `files` row: since neither of cy-deno's run
surfaces takes a per-file list (`run()` takes `specDir`/`specPattern`; the `--json`
subprocess adds only a single `--spec <substring>` filter), the runner core would instead
fold a same-directory `files` list into `specDir` + a brace-glob `specPattern` (a lone
entry using `--spec <substring>` on its basename), and reject a `files` list spanning
multiple directories with 422 (`no-match`) rather than silently running a superset — not
yet built.

`parseReport(stdout, stderr, byFile, root)` (`server/src/core/business/runner/mod.ts`)
parses Playwright's `--reporter=json` stdout (`Uint8Array`) into isolate's
**`TestReport`** = `{ ok, ran, total, passed, failed, testResults[], problems?, error? }`
(`TestReportDto`, `server/src/testing/dto/test-report.ts`) — no `browser`/`llm`/`attempt`/
`commands` field exists on either side:

| Playwright JSON source | `TestReport` field | transform |
| --- | --- | --- |
| top-level `errors[]` (a spec that failed to LOAD — unresolvable import, syntax error; no suite, no spec) | `error` | messages ANSI-stripped, joined, sliced to 1600 chars — a **note only**; a load failure does NOT populate `testResults` and does NOT count toward `failed` |
| `suites[].specs[]` walked recursively (`suite.file`, then each `spec.tests[0].results[0]`) | `testResults[]` (`TestResultDto`, `server/src/testing/dto/test-result.ts`) | `title`←`spec.title`; `file`←the absolute spec path; `line`←`spec.line`; `ok`←`!!spec.ok`; `error`←`result.error.message ?? result.errors[0].message` (ANSI-stripped); `screenshot`←the `"screenshot"` attachment's `path`; `caseName`/`route`←looked up in the discovery-built `byFile` map by absolute path (present when `files` came from discovery, absent when the caller passed explicit `files`) |
| — | `total` / `passed` / `failed` | `testResults.length`; `total − failed`; `testResults.filter(t => !t.ok).length` — `failed` is counted per TEST, not per load failure |
| — | `ran` | `parsed && testResults.length > 0` |
| — | `ok` | `parsed && testResults.length > 0 && failed === 0 && loadErrors.length === 0` |
| — | `error` (fallback, no load errors) | when the run didn't parse or produced zero results, `parseReport` itself back-fills `error` with the last 800 chars of ANSI-stripped stderr (trimmed) — `undefined` only if that stderr tail is also empty |
| — | `problems?` | never populated by `parseReport` — the hardcoded zero-spec "run all" pass (below) sets it to `[]`; no path fills it with real entries, so its element type (distinct from discovery's `Problem`, above) is out of scope here |

`runTests` adds one more back-fill on top of `parseReport`'s: if the parsed report still comes
back with `ran: false` and an empty `error` (i.e. stderr was empty too, so `parseReport`'s
stderr-tail fallback also produced `undefined`), `runTests` sets `error` to a diagnostic guess
naming the likely cause (an unresolvable import, or a spec not importing
`{ test, expect } from "@playwright/test"`) — so a stderr-diagnostic-but-no-results run never
comes back with `error: undefined`.

A load failure today lands only in `error` (as a note), leaving `failed === 0` — so `ok`
can be `false` (via the `loadErrors.length === 0` clause) while no individual test is
marked failed. DX-IDEAL §3.7 targets counting a load failure as a failed test instead, so
`ok` and the process exit code agree without a separate load-error carve-out.

`get-runner-status` (via the `runner-ensure` coordinator) RETURNS a **`RunnerStatusDto`** =
`{ ok, version?, path, message? }` (`server/src/testing/dto/runner-status.ts`): `runnerStatus()`
checks `exists(PW_BIN)` first — if the binary isn't provisioned it returns `{ok: false,
path: RUNNER_DIR, message: "Playwright runner not provisioned at ~/.isolate-runner — run
any isolate command to install it."}`; otherwise it shells `PW_BIN --version`,
regex-extracts the version string, and returns `{ok: true, version, path: RUNNER_DIR,
message: "runner ready"}`. Non-destructive; request-time provision remains status-only (no
install at request time). DX-IDEAL §3.7 targets probing the Deno-native `cy-deno` runner
instead (resolvable + a usable webview/chrome driver) — not yet built.

**Golden path — one unit, start to finish**: take `src/components/button/`:
```
src/components/button/
  template.html
  isolate/
    fixture.json                          # {category: "button", controls: {label: {value: "Click me"}}}
    cases/primary/primary.json            # {label: "Click me"}
    cases/primary/tests/renders.spec.ts   # test("renders the primary case", …); imports { test, expect } from "@playwright/test"
```
- **Discovery**: `components` is a scan ROOT (not `pages/`, not `shell`) → target
  `component`. The recursive walk finds `button/` (no `isolate` segment above it); it
  previews (`template.html` + `isolate/` present, no `logic.ts` → NOT an island). Route
  = `/components/button/primary` (category `button` from `fixture.json`, no `folder`,
  case `primary`). `collectTests` gathers `cases/primary/tests/renders.spec.ts` as that
  case's spec.
- **`post-test-run`**: `POST /http/post-test-run` with `TestRunRequestDto = {files:
  ["src/components/button/isolate/cases/primary/tests/renders.spec.ts"], baseUrl:
  "http://127.0.0.1:8000", projectRoot: "<sprig-app>"}` spawns `playwright test
  src/components/button/isolate/cases/primary/tests/renders.spec.ts --reporter=json`
  against that one spec. Playwright's JSON reporter comes back with one suite whose
  `specs[0].tests[0].results[0]` reports `{status: "passed"}`; `parseReport` projects it
  onto `TestReport = {ok: true, ran: true, total: 1, passed: 1, failed: 0, testResults:
  [{title: "renders the primary case", file:
  "<projectRoot>/src/components/button/isolate/cases/primary/tests/renders.spec.ts",
  ok: true, error: undefined, caseName: undefined, route: undefined}],
  error: undefined}` — per the transform table above: this call passed an explicit
  `files` list, so `byFile` was never populated (that map is only built on the
  discovery branch) and the lookup misses.

**Fault taxonomy**: `keep` maps every thrown fault to HTTP 422.
`server/fixtures/heal-rules.json` (`v:1`; `slugs.<slug>` → an array of `{kind:"note",
label, why, retryAfter?}`) enriches four of the five slugs with a human remediation
note; `retryAfter:true` marks the two provisioning slugs (`provision-failed`,
`runner-unavailable`).

| slug | thrown by | trigger | →HTTP | heal-rule note? | retryAfter? |
| --- | --- | --- | --- | --- | --- |
| `scan-failed` | discovery data adapter — `domain/data/project/mod.ts`'s `scan()` | wraps any exception from `discover()`; per-file problems (bad `fixture.json`/case JSON, an unresolved component file/export, an unsupported `_mocks`) are caught into `problems` instead, and a missing scan root is tolerated as zero entries, so this fires only on an unexpected walk failure (e.g. a filesystem permission error) | 422 | yes | no |
| `no-match` | the runner core's pre-check (`runTests`, `server/src/core/business/runner/mod.ts`) | the path-safety-filtered spec list is empty AND a selector was given (`filter` or a non-empty `files`) — a selector-less "run all" that matches zero specs is NOT this fault: the runner returns a hardcoded `{ok:true, ran:false, total:0, testResults:[], problems:[]}` pass instead of spawning Playwright | 422 | yes | no |
| `provision-failed` | `get-runner-status`'s data adapter — `domain/data/runner/mod.ts`'s `provision()` | the non-destructive status probe (`runnerStatus()` — `exists(PW_BIN)` then `PW_BIN --version`, [§1](01-1-what-isolate-is-end-to-end.md) step 2) itself throws unexpectedly (the probe normally returns `{ok: false}` rather than throwing) | 422 | yes | yes |
| `runner-unavailable` | `runTests`, once the spec list is non-empty | `runnerPresent()` (`exists(PW_BIN)`) is false — specs are ready to run but the Playwright binary isn't provisioned under `~/.isolate-runner` | 422 | yes | yes |
| `timeout` | `runSpec`'s `AbortController` abort | the Playwright spawn exceeds `DEFAULT_TIMEOUT_MS` (`ISOLATE_SPAWN_TIMEOUT_MS` env, default 120s) — the only run path, so this is reachable on any run, not just a subprocess fallback | 422 | NO | no |

DX-IDEAL §3.7's cy-deno target changes two of these: `no-match` and `runner-unavailable`
would derive from cy-deno's stable `report.error` contract (`"no-specs"` /
`"driver-unavailable"`) instead of this pre-check and binary-presence check, and a load
failure would count as a failed test rather than only populating `error` (the
honest-exit-code fix noted above).

The CLI's `test` command never reaches the `no-match` "run all" exemption path on an
empty project: it resolves its own file list first and returns early (exit 0,
[§2](02-2-the-isolate-cli-cli.md)) when empty, so it always hands the runner a non-empty selection.

