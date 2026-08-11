# 05 — The sprig CLI, dev loop, and HMR

> Subject: `framework/cli.ts` (~2,200 lines — the `sprig` CLI) and the dev servers
> `framework/.sprig/compiler/dev.ts` + `hmr.ts`. Pinned by `dev-hmr-reldir.test.ts`,
> `hmr-config-gate.test.ts`.

## 1. Entry and self-location

- Dispatch: `const [cmd, ...rest] = Deno.args`, `switch` at cli.ts:2119-2200; unknown →
  USAGE + exit 1.
- Static imports only for the package's own modules (JSR-analyzable); `annotate.ts` is
  the one lazy dynamic import (dev-only).
- `cliVersion()` — own semver from `<framework>/../deno.json`; null on a remote `jsr:`
  run. `sprigRange()` — a caret FALLBACK range (`^<cliVersion>`, else `^0.19.0`);
  `init` pins EXACT `cliVersion()` (matching `stamp()`) and only falls back to
  `sprigRange()` when that is null (cli.ts:1732-1736 — so §3's "EXACT" is the normal
  case). `runeRange()` — the `@mrg-keystone/rune` pin read from
  `<install>/server/deno.json` (fallback `^3`) — `scripts/sync-rune.ts` keeps that
  source of truth fresh.
- `installRoot()` — `<import.meta.dirname>/..`; a remote run prints "run `sprig
  install`" and exits (no disk install root on a `jsr:` run, and web-tree-sitter's
  npm `node_modules` must be on disk — the grammar bytes alone would fetch fine from
  JSR; spec 08 §1).
- Ports: `freePort(start)` (+50 scan); `appPort(seed)` — STABLE port via FNV-1a of the
  seed into 20000-28999; `PORT` env overrides the main app/dev(annotate) server's port
  (`appPort` calls keyed on the app/repo). The isolate workbench is a SEPARATE process
  (`deno run … cli/main.ts dev`, spec 07 §1 step 6), and it reads that SAME `PORT` env
  var name for its own port (`Number(Deno.env.get("PORT") ?? 8000)`) — but the launcher
  spawns it with its OWN `PORT` value set explicitly on that child's env (spec 07 §6),
  overriding whatever `PORT` the parent shell had, so a user-set `PORT` never leaks
  into the workbench's listener: supervised (`devPorts`, §4) sets it to
  `appPort(\`isolate:<repoKey>\`)` — a SECOND stable hash, independent of the app
  port's `appPort(<repoKey>)` and with no collision check between the two (a same-repo
  hash collision is possible in principle, just made unlikely by the 9000-wide band);
  `--no-cache` standalone instead scans forward from the app port —
  `freePort(appPort + 1)` — so its iso port can never coincide with its own app port.
  There is only ONE port env var, `PORT`; it is the scan (standalone) or the distinct
  hash seed (supervised) — plus the launcher's explicit per-process override — not a
  second env var name, that keeps the two ports apart in practice.
- Git anchoring: `gitRepoRoot` (walk to `.git` dir OR file), `repoKey(target)` =
  `<repo-folder>-<branch>` — the key for dev-process sharing and workbench isolation.

## 2. Command surface

| command | what it does |
|---|---|
| `sprig init [dir]` | scaffold a **ui/ + server/ monorepo** (see §3) |
| `sprig dev [appDir] [base] [--annotate <html>] [--open] [--no-cache]` | supervised, state-preserving HMR dev server (see §4); a SECOND positional overrides the serve base path (default `/ui`, cli.ts:1525) — see §4; `--open` pops a browser tab per listener once it's ready — see §4 for which URLs and when; off by default. `--annotate <html>` switches to standalone PROTOTYPE annotate — serve that one HTML file with the overlay instead of the full app + workbench (a bare `--annotate` with no matching `.html` arg is a no-op, since full-app annotate is already the default) |
| `sprig build [appDir] [--rune] [--clean]` | code-split islands + scope CSS + Tailwind → `ui/static/`; ALWAYS emits the rune composition (git-root `serve.ts` + workspace) — `--rune` is accepted as a harmless no-op (composition is unconditional, cli.ts:2136-2143; there is no `--no-rune`); a pure-UI app (no keep backend) errors + exits 1 BEFORE anything builds (§5 step 1); `--clean` short-circuits to `sprig clean` — artifacts are removed INSTEAD of building, and NO build runs (cli.ts:2132-2135); it is not clean-then-build |
| `sprig clean [appDir]` | remove exactly `<ui>/static/` + a marker-carrying generated `serve.ts` |
| `sprig check [appDir]` | typecheck the app under the SAME forced import map the build uses (temp config carrying app compilerOptions) |
| `sprig isolate [appDir] [--no-open]` | launch the isolate workbench against the app (delegates to `cli/main.ts dev` — spec 07 §6) |
| `sprig serve [entry]` | run the app's host entry as a **subprocess** `deno run -A <entry>` after loading `<projectRoot>/env/dev` — default entry `serve.ts` (cwd-relative); stdio + exit code forwarded (cli.ts:1239-1252). The entry must SELF-listen (NOT `deno serve` socket binding) — the app's own deno.json is discovered from cwd. NB: against the generated composition root (§5's bare `export default serveSprig(...)`) `deno run` ignores the default export, so the no-argument case evaluates the module without ever serving — that file is launched via the workspace `start` task (`deno serve -A serve.ts`) |
| `sprig stop [appDir]` | kill the shared dev process + ports for this repoKey |
| `sprig install [--dev]` / `sprig update` | install/refresh the `~/.sprig` runtime + Claude skills/agents + launcher (spec 08) |
| `sprig -v/--version` (bare-word `sprig version` also accepted, cli.ts:2183) | local version + build-info vs latest GitHub runtime release |

## 3. `sprig init` — the scaffold contract

Refuses to clobber (named target must not exist; `.` must be empty). Emits:
- Git-root `deno.json` — tasks `dev`/`build` (workspace/imports/start added by
  `ensureRuneWorkspace`).
- `ui/deno.json` — `@app/<name>`, decorator compilerOptions + dom libs, `$`-alias
  imports, `@mrg-keystone/sprig(+/keep)` pinned EXACT to the CLI version
  (`cliVersion() ?? sprigRange()` — the caret range only when the version is
  unreadable, §1).
- `server/deno.json` — `@mrg-keystone/rune@<runeRange>`,
  **`reflect-metadata@0.1.13` EXACT** (a range double-loads the polyfill and wipes
  decorator metadata).
- `server/bootstrap/mod.ts` — `export const api = await bootstrapServer("<name>", [], {})`.
- `ui/src/mod.ts` — `defineRoutes` + module-level `createRenderer` +
  `bootstrap({routes, base:"/ui", renderer})`.
- `ui/src/shell/{template.html,styles.css}` — the scanned-shell form. The renderer
  supports BOTH shell locations and PREFERS `ui/bootstrap/template.html` when present
  (spec 02 §5); the scaffold simply emits the `src/shell/` form (cli.ts:1836-1854).
- `ui/src/pages/home/{logic.ts,template.html,styles.css}`,
  `ui/src/services/state/mod.ts` (`State extends StateService`, `static key`).
- Then `writeRuneServe` + `ensureRuneWorkspace` + `stamp`.

**This scaffold's shape is a cross-repo contract**: rune's `rune init` runs
`sprig init` and overlays its backend onto exactly this layout (spec 09 §4).

## 4. `sprig dev` — the three-layer architecture

**Supervisor → child → server.**
- **Supervisor**: ONE shared dev process per repo+branch (`repoKey`); registry at
  `~/.sprig/dev.json`, a JSON map `repoKey → { pid, "log-size", "log-folder" }`
  (`DevLockEntry`, cli.ts:196-200), written via temp-file-then-rename so a
  concurrent reader never sees a half-write (cli.ts:260-265). Liveness is a bare
  pid check, nothing else: `pidAlive(pid)` shells out to `ps -p <pid>`
  (cli.ts:267-278) — a live owner → attach and stream its rotating log (MAX 2000
  lines × 20 files, `attachShared`); a dead pid is the ONLY staleness signal
  (there is no timestamp or heartbeat in the entry). Because a reclaimed pid
  could in principle have been reused by an unrelated process, reclaim never
  trusts the liveness check alone: a stale entry → `killPort` BOTH of the
  repo's stable ports (SIGKILL whatever holds their LISTEN socket, regardless of
  what process that is, cli.ts:280-291) and only then does the new run overwrite
  the entry with its own pid (cli.ts:1400-1414) — so even a false-positive-alive
  pid can never leave two servers bound to the same ports. A clean-exiting owner
  (SIGINT/SIGTERM, or its child exiting for a reason other than restart) deletes
  its own entry first, but only if it still owns it (`pid === Deno.pid`,
  cli.ts:1421-1434); a SIGKILL skips that cleanup entirely, which is exactly the
  gap the pid-liveness reclaim above exists to close. The owner respawns the
  child on exit code 75 (`DEV_RESTART_CODE`). `--no-cache` → `devStandalone` (own
  process, free ports, ephemeral pid-keyed workbench, no registry).
- **Child/server**: resolve the UI dir (`resolveSprigUiDir` / `isSprigUiDir`,
  cli.ts:922-930 — a UI package has `bootstrap/template.html` (the bootstrap-folder
  shell, the renderer-preferred shape — spec 02 §5) or `src/mod.ts` (the
  code-composed style; "legacy" in the detector's comment, yet still exactly what
  `sprig init` emits, §3 — both markers are live); base default `/ui`, overridable by
  a SECOND positional (`const base = positionals[1] ?? "/ui"`, cli.ts:1525 — e.g.
  `sprig dev . /admin` serves at `/admin` instead of the `/ui` default; the supervisor
  forwards rawArgs to the child, cli.ts:1442, and itself reads the same
  `positionals[1] ?? "/ui"` to open the right URL, cli.ts:1395); the supervised child
  is marked by the `SPRIG_DEV_CHILD=1` env flag it's spawned with (cli.ts:1443), which
  `dev()` reads at cli.ts:1517 to take the child branch instead of re-entering the
  supervisor; set `SPRIG_DEV=1` and `SPRIG_ASSETS_DIR=<$TMPDIR/sprig-dev/<key>/static>` (dev build
  output NEVER litters `static/`). Re-execs under a merged deno.json
  (`withMergedConfig`, gated by the `SPRIG_MERGED` env flag — the re-exec sets
  `SPRIG_MERGED=1` (cli.ts:448) so re-entry past the guard at cli.ts:414 no-ops and the
  merge runs exactly once → writes `<install>/.sprig-app.json`, where `<install>` is
  `installRoot()` from §1 — the CLI's OWN install/checkout dir, e.g.
  `~/.sprig/.sprig-app.json`, NOT the user's repo root; the merged file must sit
  beside the install's own `deno.json` so that config's relative imports still
  resolve — stale by design). Loads `.env` then `env/dev`.
- **Composition parity**: if `<gitRoot>/server/bootstrap/mod.ts` contains
  `bootstrapServer(` → dev calls the EXACT prod function, `serveSprig`, as
  `serveSprig({keep: api, app, base, assetsDir: devCache})` — prod's generated
  `serve.ts` (§5) calls the same function as `serveSprig({ keep: api })`, one
  arg, because `serveSprig` DERIVES the other three when they're omitted: `app`
  is composed from `<gitRoot>/ui/src`, `base` defaults to `/ui`, `assetsDir`
  defaults to `<gitRoot>/ui/static` (packages/keep/mod.ts's `deriveUiDir`/
  `composeApp`). Dev passes all three explicitly instead of omitting them: `app`
  because dev already built it in-process (it needs the renderer handle for
  HMR reparse — §6), and `base`/`assetsDir` to pin them to the SAME values that
  derivation would produce, except `assetsDir` — dev deliberately points that
  one at the per-project temp cache (`devCache`, §4's child section) instead of
  `ui/static`, so dev output never lands in the source tree. "EXACT" describes
  the composition function and its dispatch, not an identical argument list;
  pure-UI app → a
  fallthrough chain, `sprigAuth()` in front of
  `sprigUi({app, base, assetsDir: devCache})`:
  `(await auth(req)) ?? (await ui(req, info)) ?? 404`. `sprigAuth()` is NOT a
  wrapper around `sprigUi` — it's tried first and answers only `/auth/*`
  (firebase-config/login/exchange/me/logout), in sessionless LEGACY mode (no
  keep session engine to back it, so `login()`/`warmAuth()` still work but
  `/auth/me` always answers 401); anything it doesn't match falls through to
  `sprigUi`, which owns `<base>/**`; a request neither answers gets a bare 404.
- Wraps the host in `createDevServer` (below). `onServerReload` → kill workbench +
  exit 75 (supervisor restarts).
- The isolate workbench is spawned concurrently on its own stable port; the FULL-APP
  annotate overlay is ALWAYS on in this mode (`makeAnnotate({specRoot, srcDir,
  isolateBase})` — handles `/__annotate/*`, injects the overlay into served HTML).
  `--annotate <html>` (§2) bypasses all of this instead: it serves ONLY that one HTML
  file standalone, with the overlay attached to it (`makePrototypeAnnotate`) — no app
  build, no routes, no workbench. The two never run together; `<html>` selects the
  prototype file to annotate.
- `--open`: opt-in per invocation, off by default. Full-app mode pops the app+annotate
  URL (`http://localhost:<appPort><base>`) once that listener is up, AND the isolate
  workbench pops its own tab once ITS build finishes (both are best-effort, independent
  opens — not one combined URL). Attaching to an already-running shared process instead
  opens both immediately (the servers are already listening). `--annotate <html>` mode
  opens only that one prototype URL once its listener is up. `--open` never affects
  which server starts or its port — only whether/when a tab is popped.
- `watchProjectForRestart` restarts the child on any monorepo change OUTSIDE the app
  subtree (excludes dot-paths, node_modules, spec, logs, locks).
- `healLegacyLocalPins` restores deno.jsons an older killed dev left rewritten.

## 5. `sprig build` — rune composition emission

`build(appDir, outDir, rune)` — the command dispatcher always passes `rune=true`
(cli.ts:2143); the function's own default is `rune=false`, used only by `sprig dev`'s
internal build call (dev composes in-process instead of emitting serve.ts). With
`rune=true`:
1. `emitRuneComposition` — folds sibling `server/` + `ui/` into ONE git-root
   deployable: `assertServerBackend` (requires `server/bootstrap/mod.ts` with
   `bootstrapServer(`; missing → error + exit 1, cli.ts:989-1000, naming
   `rune init`/`rune sync` as the fix), `writeRuneServe`, `ensureRuneWorkspace`.
   There is NO UI-only build path: a pure-UI app exits here and produces no
   `static/` — it is served by `sprig dev` (§4's `sprigUi` composition, temp-cache
   build) until a keep backend exists. Only dev's internal `rune=false` call builds
   without composing.
   - `writeRuneServe`: git-root `serve.ts` =
     `export default serveSprig({ keep: api })` importing
     `./server/bootstrap/mod.ts`. Carries `RUNE_SERVE_MARKER`; refuses to clobber a
     hand-written serve.ts; adds `/serve.ts` to `.gitignore` (build artifact).
   - `ensureRuneWorkspace`: git-root deno.json becomes a workspace over `./ui` +
     `./server`; hoists `@mrg-keystone/sprig(+/keep)`, `@std/path`,
     `@preact/signals-core` to the root and **strips `@mrg-keystone/sprig*` from
     members** (dual-core prevention); writes `start` task — `--env-file=.env` is
     appended IFF `<gitRoot>/.env` exists at THIS build's run time (the same
     existence check `sprig build --rune`'s own console output uses to print its
     `--env-file` hint); no `.env` present → `deno serve -A serve.ts` with the
     flag absent, matching §2's NB. The flag is baked into the task text at
     generation time, not re-checked per launch — adding a `.env` later takes
     effect on the next `sprig build --rune`; hoists `unstable:["kv"]`.
2. `stamp(appDir)` — re-pin existing `@mrg-keystone/sprig` keys to the exact CLI
   version up the deno.json chain (local `file:` overrides untouched); migrates
   legacy `@sprig/core`/`@sprig/keep` names first.
3. `buildClient` (spec 04) + `writeBuildInfo` (provenance from `.infra/git.json`,
   legacy fallback: the `git` block in deno.json).

## 6. Dev server + HMR (`dev.ts`, `hmr.ts`)

`createDevServer` wraps the PROD handler and adds: a 60ms-debounced
`Deno.watchFs(srcDir)`, an SSE channel `<base>/_sprig/hmr`, and a live AST endpoint
`<base>/_sprig/ast/<sel>` (malformed selector → clean 400; island wins bare-selector
ambiguity). Rebuilds are serialized through one in-flight drain loop; each change kind
is isolated in try/catch.

Change → action table:
| edit | action | user experience |
|---|---|---|
| `template.html` | `renderer.reparse(relDir)`; if changed, SSE `{type:"template", sel, template: astFor(relDir)}` | instant hot swap, **island state preserved** |
| `styles.css` / `src/css-variables.json` | `buildCss` then SSE `{type:"css", v}` | stylesheet swap, no reload |
| any other `.ts` | supervisor restart (exit 75) — ESM can't evict a cached module subgraph; else (unsupervised) rebuild + SSE `{type:"reload"}` | full reload |
| anything else | NOTHING — matches no branch (dev.ts:94-104) | stale until the next restart |

`src/css-variables.json` is the LEGACY per-app token source (distinct from, and one
letter off from, the PREFERRED `bootstrap/css-tokens.json` — spec 04 §1 item 5, spec
07 §2). It lives inside the watched `srcDir` (hence the branch above); the preferred
file lives in `ui/bootstrap/`, outside `srcDir`.

The table is total: every other path is dropped by the dispatcher. Notably
`routes.json` (routes load at boot; an edit lands only on the next restart — any `.ts`
edit or a `sprig dev` re-run; `watchProjectForRestart` excludes the app subtree) and
`css-tokens.json` (the preferred build-time token source, spec 04 §1 item 5, but it
lives in `ui/bootstrap/`, OUTSIDE the watched srcDir, and has no branch anyway). Known
dev-loop gap: neither `routes.json` nor `css-tokens.json` hot-applies.

**Identity rule (bug W):** reparse is keyed by relDir (a page-local component never
clobbers a same-basename global), while the SSE `sel` is the bare selector because the
client matches mounted islands by `data-sel` (dev-hmr-reldir.test.ts).

Client side (`hmr.ts`): `startHmr(base)` runs `enableHmr()` BEFORE hydration, opens the
EventSource; `template` → `hotTemplate` (same scope, state kept); `css` → bump every
stylesheet `?v=`; `reload` → `location.reload()`; a late `onopen` (server restarted) →
reload. **Gate:** the dormant receiver activates only on the runtime data flag
`cfg.hmr`, emitted strictly when the renderer is in dev mode — the bundle itself is
byte-identical dev↔prod (hmr-config-gate.test.ts).

## 7. Refactor notes

1. cli.ts is a 2,200-line single file mixing arg parsing, process supervision, config
   merging/rewriting, port management, scaffold text, and build orchestration —
   the highest-leverage decomposition target in the repo.
2. `withMergedConfig`'s on-disk artifact (`<install>/.sprig-app.json`, §4) and
   `healLegacyLocalPins` exist because dev re-execs under a merged config — a config
   model that avoids rewriting user files would delete both.
3. `sprig serve` (subprocess exec) vs the generated `deno serve serve.ts` start task
   are different launch paths with different semantics — confusing surface.
4. The stable-port hash + squatter reclaim logic and the dev.json registry are ad-hoc
   process management; consider a proper daemon protocol or dropping shared-process
   mode.
5. Version pins live in THREE places (sprig `cliVersion()`/`sprigRange()`/`stamp`,
   rune `SPRIG_IMPORTS`, `sync-rune.ts` targets) — see spec 09 §4.
