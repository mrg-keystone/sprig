## 3. `sprig init` — the scaffold contract

The current as-built precondition gates the whole command, checked once
before any writes: `sprig init` refuses to run against a named target that
already exists, or against a non-empty `.`. That gate is reachable only
against an empty target, so every emitted path below is necessarily absent
and gets written on the one run that passes it — the per-path
"write-if-absent" column describes that single-pass write, not a re-entrant
fill.

**Decided:** as-shipped, `sprig init` keeps this refuse-if-present gate — the
documented current behavior, unchanged by this spec. 09
[§2](../09-ecosystem-contracts/02-2-sprig-s-spec-obligations.md) owns the
cross-repo TARGET this gate is meant to converge toward — `sprig init` as an
idempotent contributor that also lays a `spec/` skeleton + `spec/manifest.json`
when absent, rather than a refuser — and is the single source for that
model's mechanics; it is not re-derived here. As-shipped, `init` writes
neither the `spec/` skeleton nor `spec/manifest.json` today — both are TARGET
obligations owned by 09 §2, not current writes, and so don't appear in the
table below.

**What a passing run writes** — `sprig init myapp` in an empty dir emits
exactly this tree (every path is described in full in the table below):

```
myapp/
├── deno.json                        # workspace over ./ui + ./server
├── .gitignore                       # /serve.ts appended
├── serve.ts                         # composition root
├── ui/
│   ├── deno.json
│   └── src/
│       ├── mod.ts
│       ├── shell/
│       │   ├── template.html
│       │   └── styles.css
│       ├── shared-components/       # empty — the $.shared-components/ alias target
│       ├── pages/
│       │   └── home/
│       │       ├── logic.ts
│       │       ├── template.html
│       │       └── styles.css
│       └── services/
│           └── state/
│               └── mod.ts
└── server/
    ├── deno.json
    └── bootstrap/
        └── mod.ts
```

**Acceptance criterion #1 below checks every row marked ✓ in the "file
path?" column; the `<target>`/`.` precondition row and the version-stamp
row are not file paths and are checked by their own acceptance criteria
instead.**

| path | file path? | purpose | pin | re-run | rune-overlay target? (→ 09 [§4](../09-ecosystem-contracts/04-4-locked-invariants-sprig-s-half.md)) |
|---|---|---|---|---|---|
| `<target>` / `.` | — | invocation precondition | — | refuse-if-present — named target must not exist; `.` must be empty | — |
| `deno.json` (git-root) | ✓ | tasks `dev`/`build`; reshaped in the SAME init run by `ensureRuneWorkspace` (cli.ts:1922) into a workspace over `./ui`+`./server` — root `workspace`, hoisted `imports` (including the sprig pin hoisted out of `ui/deno.json`), a `start` task (`deno serve -A serve.ts`), `unstable:["kv"]`. `sprig build --rune` re-runs the same reshape idempotently on every later build (05 [§5](05-5-sprig-build-rune-composition-emission.md)) | see pin table below | write-if-absent at init; idempotent reshape on every later build | yes |
| `.gitignore` (git-root) | ✓ | `ensureGitignore` (cli.ts:1102, called from `writeRuneServe`) appends `/serve.ts` — created if absent, entry added if not already present | — | write-if-absent; a re-run skips the append if the entry is already there | no |
| `serve.ts` (composition-root) | ✓ | written directly by init's `writeRuneServe` (cli.ts:1921) — unconditional at init time (init just wrote `server/bootstrap/mod.ts` itself, so there's nothing to gate on); appended to `.gitignore` as a build artifact, never tracked source. `sprig build --rune` re-runs the same `writeRuneServe` idempotently on every later build, there gated on `assertServerBackend` finding `server/bootstrap/mod.ts` (05 [§5](05-5-sprig-build-rune-composition-emission.md)) | — | write-if-absent at init; refuses to clobber a hand-written `serve.ts` on later re-runs | yes |
| version stamp | — | `stamp()` re-pins the git-root `deno.json`'s sprig keys (the copy `ensureRuneWorkspace` hoisted there) to the exact CLI version | matches the git-root `deno.json`'s pin — see pin table below | write-if-absent | no |
| `ui/deno.json` | ✓ | `@app/<name>`, decorator compilerOptions + dom libs, `$`-alias imports — the scaffold template writes a sprig pin here, but `ensureRuneWorkspace` (run in the same init pass) hoists it to the git-root `deno.json` and strips it from this file entirely, so a passing init leaves `ui/deno.json` with NO sprig pin | — | write-if-absent | no |
| `ui/src/mod.ts` | ✓ | `defineRoutes` + module-level `createRenderer` + `bootstrap({routes, base:"/ui", renderer})` | — | write-if-absent | no |
| `ui/src/shell/{template.html,styles.css}` | ✓ | the scanned-shell form. The renderer supports BOTH shell locations and PREFERS `ui/bootstrap/template.html` when present (spec 02 [§5](../02-template-compiler/06-5-mod-ts-registry-page-assembly-renderer.md)); the scaffold itself emits the `src/shell/` form (cli.ts:1836-1854) | — | write-if-absent | no |
| `ui/src/shared-components/` | ✓ | empty dir — the target of the `$.shared-components/` alias (cli.ts:1914) | — | write-if-absent | no |
| `ui/src/pages/home/{logic.ts,template.html,styles.css}`, `ui/src/services/state/mod.ts` | ✓ | sample page + `State extends StateService` (`static key`) | — | write-if-absent | no |
| `server/deno.json` | ✓ | `@app/<name>-server`, decorator compilerOptions, pins `@mrg-keystone/rune` + `reflect-metadata` (cli.ts:1780) — see pin table below | see pin table below | write-if-absent | no |
| `server/bootstrap/mod.ts` | ✓ | starter `bootstrapServer("<name>", [], {})` (cli.ts:1796) — `rune init`/`rune sync` fill it in | — | write-if-absent | no |

**Dependency pins:**

| dependency | version | exact vs range | why |
|---|---|---|---|
| `@mrg-keystone/sprig(+/keep)` (git-root `deno.json`) | `cliVersion() ?? sprigRange()` | EXACT `cliVersion()`; caret RANGE only when the version is unreadable | auto-derived from the CLI's own version — no `SPRIG_RANGE` constant remains in `framework/cli.ts` ([§1](01-1-entry-and-self-location.md)). `ensureRuneWorkspace` hoists this pin to the git-root `deno.json` and strips it from `ui/deno.json` entirely, so the pin lives at the root, not in the member. |
| `@mrg-keystone/rune` (`server/deno.json`) | `<runeRange>` | RANGE | rune's published pin, resolved by `runeRange()` ([§1](01-1-entry-and-self-location.md)) |
| `reflect-metadata` (`server/deno.json`) | `0.1.13` | EXACT | a RANGE double-loads the polyfill and wipes decorator metadata |

**This scaffold's shape is a cross-repo contract**: rune's `rune init` runs
`sprig init` and overlays its backend onto exactly this layout (spec 09 [§4](../09-ecosystem-contracts/04-4-locked-invariants-sprig-s-half.md)).

**Acceptance criteria** — a passing `sprig init` satisfies all of:

- every path marked ✓ in the "file path?" column above exists under the
  target dir.
- the git-root `deno.json`'s `@mrg-keystone/sprig`(`+/keep`) pin (hoisted
  there by `ensureRuneWorkspace`) equals what `stamp()` wrote, equals
  `cliVersion()` (falling back to `sprigRange()` only when the version is
  unreadable); `ui/deno.json` carries no sprig pin at all.
- `server/deno.json`'s `reflect-metadata` pin is exactly `0.1.13`.
- the invocation gate refuses observably: against a named target that
  already exists, exit code 1 and `sprig init: "<dir>" already exists —
  choose a new name or remove it first.` (the raw argument as passed, quoted);
  against a non-empty `.`, exit code 1 and `sprig init: <absolute-path> is
  not empty (e.g. <entry>) — run it in an empty directory or pass a new app
  name.` (the resolved absolute path — `appAbs` — not the raw `.` argument).

