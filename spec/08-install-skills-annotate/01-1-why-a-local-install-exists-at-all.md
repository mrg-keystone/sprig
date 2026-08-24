## 1. Why a local install exists at all

Running the CLI straight from `jsr:` cannot work for two reasons — neither of which is
the grammar bytes (parse.ts fetches `grammar.bin` fine from a remote module URL, spec
02 §1): (a) **no install root** — `import.meta.dirname` is undefined on a remote run,
so `installRoot()` exits with "run `sprig install`" (trace of what that means for a
local run: 05-cli [§1](../05-cli-dev-hmr/01-1-entry-and-self-location.md)); (b) **no
on-disk `node_modules`** — the compiler's `web-tree-sitter` is an npm dep needing
`nodeModulesDir:"auto"`, which a bare `deno run jsr:…` doesn't provide. install.ts:1-8
compresses this to "grammar.bin + web-tree-sitter need a real on-disk node_modules".
So `sprig install` downloads the SOURCE bundle to `~/.sprig` (`$SPRIG_HOME` override)
and runs `deno install` THERE.

Every artifact that lands in `~/.sprig` earns its place by feeding one of those two
blockers or a consumer that needs a real path on disk:

| artifact in `~/.sprig` | consumer | why it must be on disk |
|---|---|---|
| `framework/` | `installRoot()` | holds `cli.ts`; its `import.meta.dirname` (`~/.sprig/framework`) anchors `installRoot()` to that dir's PARENT, `~/.sprig` (blocker a; trace: 05-cli [§1](../05-cli-dev-hmr/01-1-entry-and-self-location.md)) |
| `node_modules` | compiler's `web-tree-sitter` | npm dep needing `nodeModulesDir:"auto"` (blocker b) |
| `server/deno.json` | `runeRange()` | reads the `@mrg-keystone/rune` pin straight from this file (05-cli §1) |
| scaffold text + workbench parts | `sprig init` / `sprig isolate` | `assertWorkbench` requires `app`, `server`, `cli`, `serve.ts` present on disk |
| merged dev config | dev server | no remote install root exists to read config from (blocker a) |

The `sprig` launcher itself is NOT one of those on-disk `~/.sprig` artifacts — step 5
below writes it to `$DENO_INSTALL_ROOT/bin` (else `~/.deno/bin`), because the
invocation entrypoint the shell resolves via `PATH` has to live there, not inside the
install root it then execs into.

- Release channel: GitHub repo `mrg-keystone/sprig`, rolling tag `runtime-latest`;
  `bundleUrl()` prefers a `sprig-runtime*.tar.gz` asset, falls back to the
  default-branch archive.
- `installRuntimeFromDeployment()` (= `sprig install` / `sprig update`):
  1. Fetch the bundle (release channel above).
  2. Atomic swap into `~/.sprig`, keeping the prior install as `.old` (rollback
     artifact).
  3. `deno install`.
  4. Deploy Claude assets — `installSkills` + `installAgents` (mechanics + inventory
     owned by [§2](02-2-claude-asset-deployment-skills-ts.md)).
  5. Write the `sprig` launcher into `$DENO_INSTALL_ROOT/bin` (else `~/.deno/bin`;
     install.ts:26) — `exec deno run -A --config <dir>/deno.json <dir>/framework/cli.ts
     "$@"`.
- `installRuntimeFromWorkingTree(repoRoot)` (= `sprig install --dev`): same, wired to
  the current checkout.
- The **isolate workbench ships inside the runtime bundle**
  (`WORKBENCH_PARTS = ["app","server","cli","serve.ts"]`); `assertWorkbench` throws
  "run `sprig update`" if any part is missing.
- The JSR publish set (deno.json `publish.include`) carries only the framework
  runtime files (compiler, core, auth, annotate, install, skills, spec-root, cli,
  keep + vendor) — the workbench rides the GitHub bundle, not JSR.
- Root `install.ts` is a DIFFERENT thing: the isolate project's own standalone remote
  bootstrap (repo `mrg-keystone/isolate` → `~/.isolate`) — not this doc's subject.
  It's the FOURTH distribution channel ([§6](06-6-refactor-notes.md).2), fully
  independent of `~/.sprig` (the two installs never update each other); its bin /
  `install-core.ts` / `isolate update` mechanics belong to spec 07
  [§2](../07-isolate-workbench/02-2-the-isolate-cli-cli.md).

