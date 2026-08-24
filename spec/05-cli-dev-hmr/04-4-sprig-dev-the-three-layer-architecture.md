## 4. `sprig dev` — the three-layer architecture

**Supervisor → child → server.**

| layer | responsibility | reacts to | drives |
|---|---|---|---|
| **Supervisor** | owns the registry, liveness checks, and port reclaim | child exit codes + signals | respawn |
| **Child** | builds + composes the app in-process | out-of-subtree monorepo edits (`watchProjectForRestart`) | exit 75 |
| **Server** (`createDevServer`) | serves the app + HMR | edits inside `srcDir` | SSE — kind→action dispatch delegated to [§6](06-6-dev-server-hmr-dev-ts-hmr-ts.md) |

**Trace — three edits, three forks.** A dev edits `counter/template.html`
(inside `srcDir`): `createDevServer`'s watcher owns it end to end — reparse,
kind→action dispatch, SSE (change→action table: [§6](06-6-dev-server-hmr-dev-ts-hmr-ts.md))
— a `template.html` edit hot-swaps in place entirely inside the server layer,
no child restart. Contrast a server-code edit, `resolve.ts`: it's "any other
`.ts`" in that same table, which takes exit 75 instead — the child exits, the
supervisor respawns it (below), the new child opens a fresh listener, and the
client's late `onopen` fires a `location.reload()` once it reconnects (03
[§9](../03-islands-and-hydration/09-9-hmr-hooks-in-the-client-runtime.md)).
Contrast a third fork: an edit OUTSIDE the app subtree entirely — a sibling
package in the same monorepo — never reaches `createDevServer`'s
`srcDir`-scoped watcher at all; `watchProjectForRestart` (below) catches it
instead and restarts the child the same way, exit 75.

That `location.reload()`'s live-signal-state wipe — and what survives it — is
owned by 03 [§9](../03-islands-and-hydration/09-9-hmr-hooks-in-the-client-runtime.md).

**Supervisor.** ONE shared dev process per repo+branch (`repoKey`); registry at
`~/.sprig/dev.json`, a JSON map `repoKey → { pid, "log-size", "log-folder" }`
(`DevLockEntry`, cli.ts:196-200), written via temp-file-then-rename so a
concurrent reader never sees a half-write (cli.ts:260-265). Liveness is a bare
pid check, nothing else: `pidAlive(pid)` shells out to `ps -p <pid>`
(cli.ts:267-278); there is no timestamp or heartbeat in the entry.

| registry-entry condition | liveness signal | reclaim/exit action |
|---|---|---|
| live owner | `pidAlive(pid)` true, the real owner | attach and stream its rotating log (MAX 2000 lines × 20 files, `attachShared`) |
| dead pid — the ONLY staleness signal | `pidAlive(pid)` false | reclaim: `killPort` BOTH of the repo's stable ports (SIGKILL whatever holds their LISTEN socket, regardless of what process that is, cli.ts:280-291), then overwrite the entry with the new run's own pid (cli.ts:1400-1414) |
| clean-exiting owner (SIGINT/SIGTERM, or its child exiting for a reason other than restart) | owner exits on its own | self-deletes its own entry, but only if it still owns it (`pid === Deno.pid`, cli.ts:1421-1434) |
| SIGKILL | no exit handler runs | skips that cleanup entirely — exactly the gap the dead-pid reclaim above exists to close |

The owner respawns the child on exit code 75 (`DEV_RESTART_CODE`).
`--no-cache` → `devStandalone` (own process, free ports, ephemeral pid-keyed
workbench, no registry).

**Child.** Resolves the UI dir (`resolveSprigUiDir` / `isSprigUiDir`,
cli.ts:922-930 — a UI package has `bootstrap/template.html` (the bootstrap-folder
shell, the renderer-preferred shape — [§5](05-5-sprig-build-rune-composition-emission.md)) or `src/mod.ts` (the
code-composed style; "legacy" in the detector's comment, yet still exactly what
`sprig init` emits, [§3](03-3-sprig-init-the-scaffold-contract.md) — both markers are live); base default `/ui`, overridable by
a SECOND positional (`const base = positionals[1] ?? "/ui"`, cli.ts:1525 — e.g.
`sprig dev . /admin` serves at `/admin` instead of the `/ui` default; the supervisor
forwards rawArgs to the child, cli.ts:1442, and itself reads the same
`positionals[1] ?? "/ui"` to open the right URL, cli.ts:1395).

**Env-flag/config contract:**

| flag | set by | read at | effect |
|---|---|---|---|
| `SPRIG_DEV_CHILD` | supervisor, spawning the child (cli.ts:1443) | `dev()`, cli.ts:1517 | take the child branch instead of re-entering the supervisor |
| `SPRIG_MERGED` | the merged-config re-exec, spawning itself with it (cli.ts:448) | `withMergedConfig`'s guard, cli.ts:414 | re-entry past the guard no-ops, so the merge runs exactly once |
| `SPRIG_DEV` | the child (cli.ts:1570) | the app's `createRenderer`, at module-eval | renderer emits `cfg.hmr`, waking the loader's dormant HMR client |
| `SPRIG_ASSETS_DIR` | the child, to `$TMPDIR/sprig-dev/<key>/static` (cli.ts:1580) | the app's `createRenderer`, at module-eval | `?v=` cache-busting hashes the dev bundle here instead of `<cwd>/static` — dev build output NEVER litters the source tree |

Re-execs under a merged deno.json (`withMergedConfig`) → writes
`<install>/.sprig-app.json`, where `<install>` is
`installRoot()` from [§1](01-1-entry-and-self-location.md) — the CLI's OWN install/checkout dir, e.g.
`~/.sprig/.sprig-app.json`, NOT the user's repo root; the merged file must sit
beside the install's own `deno.json` so that config's relative imports still
resolve — stale by design. Env loading forks on the same rune-vs-pure-UI
detection the Server section's composition parity uses (below): `.env` loads
ONLY in rune-backed mode (`if (rune) await loadDotEnv(join(rune.gitRoot,
".env"))`, cli.ts:1593) — a pure-UI app never loads it. `env/dev` loads
unconditionally after, for both forks (`loadDefaultDevEnv`, cli.ts:1596), and
`.env` wins on any overlap since `loadDotEnv` never overrides an
already-set var.

- `watchProjectForRestart` restarts the child on any monorepo change OUTSIDE the app
  subtree (excludes dot-paths, node_modules, spec, logs, locks).
- `healLegacyLocalPins` restores deno.jsons an older killed dev left rewritten.

**Server** (`createDevServer`). Composition parity: if
`<gitRoot>/server/bootstrap/mod.ts` contains
`bootstrapServer(` → dev calls the EXACT prod function, `serveSprig`, as
`serveSprig({keep: api, app, base, assetsDir: devCache})` — prod's generated
`serve.ts` ([§5](05-5-sprig-build-rune-composition-emission.md)) calls the same function as `serveSprig({ keep: api })`, one
arg, because `serveSprig` DERIVES the other three when they're omitted
(packages/keep/mod.ts's `deriveUiDir`/`composeApp`). Dev passes all four
explicitly instead of omitting the last three:

| arg | prod (derived from) | dev (passed value) | why dev pins it |
|---|---|---|---|
| `keep` | `{ keep: api }` — the only arg prod passes | `api` | no divergence — same rune backend |
| `app` | composed from `<gitRoot>/ui/src` | the app dev already built in-process | dev needs the renderer handle for HMR reparse ([§6](06-6-dev-server-hmr-dev-ts-hmr-ts.md)) |
| `base` | defaults to `/ui`, fixed — prod's `serve.ts` never passes a second positional | defaults to `/ui` too, but the child's SECOND positional overrides it (`sprig dev . /admin`, Child above) | default-matches prod; CAN diverge if the dev invocation passes an override |
| `assetsDir` | defaults to `<gitRoot>/ui/static` | `devCache`, the per-project temp cache (Child, above) | deliberate divergence — dev output must never land in `ui/static` |

"EXACT" describes the composition function and its dispatch, not an
identical argument list; pure-UI app → a
fallthrough chain, `sprigAuth()` in front of
`sprigUi({app, base, assetsDir: devCache})`:
`(await auth(req)) ?? (await ui(req, info)) ?? 404`. `sprigAuth()` is NOT a
wrapper around `sprigUi` — it's tried first and answers only `/auth/*`
(firebase-config/login/exchange/me/logout), in sessionless LEGACY mode (no
keep session engine to back it, so `login()`/`warmAuth()` still work but
`/auth/me` always answers 401); anything it doesn't match falls through to
`sprigUi`, which owns `<base>/**`; a request neither answers gets a bare 404.

Wraps the host in `createDevServer` (below). `onServerReload` → kill workbench +
exit 75 (supervisor restarts).

The isolate workbench is spawned concurrently on its own stable port; the FULL-APP
annotate overlay is ALWAYS on in this mode (`makeAnnotate({specRoot, srcDir,
isolateBase})` — handles `/__annotate/*`, injects the overlay into served HTML).
`--annotate <html>` ([§2](02-2-command-surface.md)) bypasses all of this instead: it serves ONLY that one HTML
file standalone, with the overlay attached to it (`makePrototypeAnnotate`) — no app
build, no routes, no workbench. The two never run together; `<html>` selects the
prototype file to annotate. A bare `--annotate` with no `<html>` argument is a
no-op: full-app annotate is already the default in this mode, so there is nothing
further to switch to.

`--open`: opt-in per invocation, off by default. Full-app mode pops the app+annotate
URL (`http://localhost:<appPort><base>`) once that listener is up, AND the isolate
workbench pops its own tab once ITS build finishes (both are best-effort, independent
opens — not one combined URL). Attaching to an already-running shared process instead
opens both immediately (the servers are already listening). `--annotate <html>` mode
opens only that one prototype URL once its listener is up. `--open` never affects
which server starts or its port — only whether/when a tab is popped.

**Acceptance criteria** — what a correct implementation of this section must satisfy:
- **Never two listeners on one port:** a live registry owner is attached to, never
  duplicated; a dead pid's entry is reclaimed (`killPort` both stable ports) before
  the new owner claims them and opens its own listener — no window where two
  processes hold the same port.
- **Dev build output never under source `static/`:** it lands in the per-project
  temp cache (`devCache`, `$TMPDIR/sprig-dev/<key>/static`) — the initial build,
  every HMR rebuild, and the asset server all read/write the same dir, and none of
  them touches `<gitRoot>/ui/static`.
- **Merged-config write happens once per child:** `SPRIG_MERGED` gates
  `withMergedConfig`'s re-exec; re-entry past the guard no-ops, so
  `.sprig-app.json` is written exactly once per child process.
- **Dev and prod dispatch through the same `serveSprig`:** both call the identical
  composition function; only the argument list differs (all four explicit in dev
  vs. `{ keep: api }` alone in prod, per the table above).

