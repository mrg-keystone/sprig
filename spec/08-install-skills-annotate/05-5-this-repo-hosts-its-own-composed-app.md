## 5. This repo hosts its own composed app

`serve.ts`'s `serveSprig({ keep: api, app, base: "", assetsDir: <repo>/app/static })`
call IS the composition
[07 §1](../07-isolate-workbench/01-1-what-isolate-is-end-to-end.md) step 6
specifies, instantiated for this repo — the isolate workbench, running as this
repo's own production app. `serveSprig`'s dispatch table and `base:""` semantics
are [06 §3](../06-keep-serving-composition/03-3-the-servesprig-composition-current-as-built.md)'s
to detail (base `""` is why previews land at `/components/…` with no `/ui` prefix
to skip); what follows is only what's repo-specific.

**`serve.ts` (prod) / `serve-dev.ts` (dev) — an adjacent pair; one thing differs.**
- **prod** — `deno task start` → `deno serve -A serve.ts`: the same
  `ensureRuneWorkspace`-generated `start` task spec 05 §5 documents; committed
  `app/static/**` assets, no build step (assets row below).
- **dev** — `deno run -A cli/main.ts dev -r <repo>` (or `sprig isolate <repo>`;
  [07 §1](../07-isolate-workbench/01-1-what-isolate-is-end-to-end.md) step 6) →
  `serve-dev.ts`: the same composition wrapped in `createDevServer`, plus a
  project watcher that mirrors user-project component edits into
  `app/src/_preview/targets/*` or re-discovers on structural change. It sets
  `SPRIG_ASSETS_DIR=outDir` (`serve-dev.ts:30`) BEFORE it imports `main.ts` — the
  order is load-bearing (`serve-dev.ts:27-30`); see the assets row below for why
  the env var matters.

Neither command line carries `--unstable-kv` — `ensureRuneWorkspace` hoists
`unstable:["kv"]` into the root `deno.json` itself, so the KV backend the session
store needs is already declared there and the flag would be redundant.

**Prod cold boot (golden path).** `deno serve -A serve.ts` on Deno Deploy: the
`start` task's command line has no build step, so none fires → the handler serves
committed `app/static/**` as `assetsDir` (`serve.ts:23`) → `createRenderer` reads
the ~498K `templates.json` from disk instead of live-parsing (mechanism detailed
in the assets row below) → the first `GET /components/…` is served straight off
those committed artifacts.

`createRenderer` resolves `templates.json` via `SPRIG_ASSETS_DIR` (else
`<cwd>/static`; `compiler/mod.ts:100`), and `deno task start` runs with cwd = repo
root, so an unset env var would resolve to `<repo>/static` (doesn't exist), not
the committed `<repo>/app/static` where `templates.json` lives — `serveSprig`'s
`assetsDir` argument only feeds `serveAsset`/versioning, not `createRenderer`, so
it doesn't cover this either. Decided: `serve.ts` sets `SPRIG_ASSETS_DIR` to
`<repo>/app/static` before its `import { app } from "./app/src/main.ts"` line,
mirroring `serve-dev.ts:30`'s set-before-import pattern — this is what makes the
golden path above hold; a refactor fix to the generated/repo `serve.ts`, not a
`serveSprig` change.

| path | category (authored entrypoint / committed deploy asset / build-time-only / stale merged-config artifact / provenance sidecar / dev-CLI config) | who writes it | git-tracked? | read at runtime? |
|---|---|---|---|---|
| `serve.ts` (root) | authored entrypoint | `ensureRuneWorkspace` / `writeRuneServe` (spec 05 §5) | yes | yes — the prod entrypoint (`deno serve -A serve.ts`) |
| `serve-dev.ts` (root) | authored entrypoint | `ensureRuneWorkspace` (spec 05 §5) | yes | yes — the dev entrypoint |
| `app/static/**` — `client.js`, `chunk-*.js`, `isl.workbench.js`, `isl.run-tests.js`, `isl.stage-bridge.js`, `app.css`, `templates.json`, `build-info.json` (8 files) | committed deploy asset | `buildClient` (7 of 8); `build-info.json` by `writeBuildInfo`, copied from `.infra/git.json` | **YES — never gitignore this dir: the `start` task has no build step, so these checked-in files ARE what makes prod / Deno Deploy work** | yes — `serve.ts:23` serves the dir as `assetsDir`; `createRenderer` reads `templates.json` (~498K, the prebuilt serialized-AST registry) from `SPRIG_ASSETS_DIR` (else `<cwd>/static`; `compiler/mod.ts:100`) at boot — both `serve-dev.ts` (line 30) and `serve.ts` set `SPRIG_ASSETS_DIR` explicitly before importing `main.ts` (see the golden-path note above), so neither ever live-parses; `build-info.json` is read once — lazily, on the first request, memoized thereafter — by `buildMetaReader` for the provenance head-meta tags |
| `app/static/import-map.json` | build-time-only | `buildClient` (spec 04 [§2](../04-build-pipeline-and-artifacts/02-2-the-artifact-set-static.md)) | **NO — correctly untracked**: a build-time-only record consumed by the bundler invocation itself and never read again | no |
| `.sprig-app.json` (root) | stale merged-config artifact | `withMergedConfig`, during `sprig dev` on a `--dev` install | no — its imports point into an external app's absolute paths, so there's nothing valid for another checkout to commit | not specified in this doc — treat as write-only. What matters: **never hand-edit it — `withMergedConfig` overwrites it on the next `--dev` install** |
| `.infra/git.json` | provenance sidecar | not specified in this doc — `writeBuildInfo` only reads and copies it forward | no — moved out of the `deno.json` `git` block specifically to stop the per-commit merge conflicts that block caused there; a tracked copy of this file would just relocate the same churn | build time only, by `writeBuildInfo`, which copies it into `static/build-info.json`; the `deno.json` `git` block is the legacy fallback |
| `env/prod` | dev-CLI config | static file, no generator — part of the checked-in convention | yes (empty) | yes — flat dotenv, loaded by the dev CLI |
| `env/dev` | dev-CLI config | — (doesn't exist yet) | n/a | n/a until added — the convention allows it; the dev CLI would load it once present |

