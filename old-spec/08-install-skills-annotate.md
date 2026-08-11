# 08 — Distribution: install, Claude skills/agents, annotate overlay

> Subject: `framework/.sprig/install.ts`, `skills.ts`, `annotate.ts` +
> `annotate-client.js`, the `claude/` tree, root `install.ts`, and
> `scripts/sync-*.ts`. This is how sprig ships to machines and how the agent
> toolchain rides along.

## 1. Why a local install exists at all

Running the CLI straight from `jsr:` cannot work for two reasons — neither of which is
the grammar bytes (parse.ts fetches `grammar.bin` fine from a remote module URL, spec
02 §1): (a) `import.meta.dirname` is undefined on a remote run, so the CLI has no
install root (`installRoot()` exits with "run `sprig install`") — scaffold text,
workbench parts, and the merged dev config all need files on disk; (b) the compiler's
`web-tree-sitter` is an npm dep that needs the on-disk `node_modules`
(`nodeModulesDir:"auto"`) a bare `deno run jsr:…` doesn't provide. install.ts:1-8
compresses this to "grammar.bin + web-tree-sitter need a real on-disk node_modules".
So `sprig install` downloads the SOURCE bundle to `~/.sprig` (`$SPRIG_HOME` override)
and runs `deno install` THERE.

- Release channel: GitHub repo `mrg-keystone/sprig`, rolling tag `runtime-latest`;
  `bundleUrl()` prefers a `sprig-runtime*.tar.gz` asset, falls back to the
  default-branch archive.
- `installRuntimeFromDeployment()` (= `sprig install` / `sprig update`):
  fetch → atomic swap into `~/.sprig` (keeping `.old`) → `deno install` →
  `installSkills` + `installAgents` → write the `sprig` launcher into
  `$DENO_INSTALL_ROOT/bin` (else `~/.deno/bin`; install.ts:26)
  (`exec deno run -A --config <dir>/deno.json <dir>/framework/cli.ts "$@"`).
- `installRuntimeFromWorkingTree(repoRoot)` (= `sprig install --dev`): same, wired to
  the current checkout.
- The **isolate workbench ships inside the runtime bundle**
  (`WORKBENCH_PARTS = ["app","server","cli","serve.ts"]`); `assertWorkbench` throws
  "run `sprig update`" if any part is missing.
- The JSR publish set (deno.json `publish.include`) carries only the framework
  runtime files (compiler, core, auth, annotate, install, skills, spec-root, cli,
  keep + vendor) — the workbench rides the GitHub bundle, not JSR.
- Root `install.ts` is a DIFFERENT thing: the isolate project's standalone remote
  bootstrap (repo `mrg-keystone/isolate` → `~/.isolate`), duplicated
  download/extract because it can't import the bundle before it exists. `~/.isolate`
  is the FOURTH distribution channel (§6.1) and fully independent of `~/.sprig`:
  it carries its own `isolate` bin (installed to the same `$DENO_INSTALL_ROOT/bin`
  override, else `~/.deno/bin`; install-core.ts:212), and `isolate update`
  (cli/lib/install-core.ts) refreshes it from `mrg-keystone/isolate` releases, while
  `sprig isolate` always runs `~/.sprig`'s workbench copy (spec 07 §6) — the two
  installs never update each other.

## 2. Claude asset deployment (`skills.ts`)

`sprig install`/`update` deploy the `claude/` tree into user scope by
**whole-entry replace keyed by name**:
- `claude/skills/<name>/` → `~/.claude/skills/<name>` (`CLAUDE_SKILLS_DIR` override) —
  one FOLDER per skill; a dir without `SKILL.md` is skipped EXCEPT `interfaces/`
  (shared cross-skill contracts, carried wholesale).
- `claude/agents/<name>.md` → `~/.claude/agents/` (`CLAUDE_AGENTS_DIR` override) —
  flat `.md` files.
- Replace = unlink symlink → `rm -rf` → `cp -R`; **never clobbers a destination
  containing `.git`** (a dev symlink survives); dotfiles skipped; skips cleanly when
  no `~/.claude` exists. `installSkillsFromDeployment()` can pull the `skills-latest`
  release asset independently.
- Pinned by skills.test.ts: stray user files inside a managed skill are GONE after
  install; unrelated skills untouched; symlinked skills replaced without
  write-through.

Inventory: skills `sprig:audit`, `sprig:breakdown`, `sprig:build`, `sprig:design`,
`sprig:prototype` + `interfaces/` (README, design-system.md, prototype.md,
sprig-app.md, ui-breakdown.md); 14 agents (`sprig-audit-{fixer,hunter,root-cause,
validator}`, `sprig-breakdown-{analyst,capture,spec-writer}`,
`sprig-build-{analyst,component,scaffolder}`, `sprig-design-{author,deriver,
verifier}`, `sprig-prototype-builder`).

**`sprig:prototype` ships executable payloads, not just prose.** The inventory
above lists only family names + `interfaces/`, but a skill FOLDER is copied
verbatim — `installSkill` → `replaceEntry` = `cp -R` the whole dir (skills.ts:66,
§2's opening mechanism) — so everything under `claude/skills/sprig:prototype/`
lands in `~/.claude/skills/sprig:prototype/` with no separate step. Three payloads
ride along:
- **`design-lint/`** — a whole vendored, Deno-native UI anti-pattern linter (~23
  git-tracked files, ~492K, Apache-2.0, vendored from the "impeccable" project —
  github.com/pbakaus/impeccable; see `LICENSE` + `NOTICE`). CLI entry
  `bin/detect.mjs` (thin wrapper over the engine's `detectCli()`,
  detect-antipatterns.mjs); FOUR detection engines under
  `src/engine/engines/{browser,regex,static-html,visual}` (Astral full-render /
  source-text regex / zero-dep static HTML + CSS-cascade / screenshot-contrast);
  an antipattern registry `src/engine/registry/antipatterns.mjs` — 41 rules
  (`slop`/`quality`, 37 default + 4 provider-gated behind `--gpt`/`--gemini`),
  each mapped to which engine can fire it by `RULE_ENGINE_SUPPORT`; a
  Puppeteer→Astral import-map shim (`shims/puppeteer-astral.mjs`, aliased as the
  bare `puppeteer` specifier in the payload's own `deno.json` imports so upstream
  `src/engine/**` stays byte-for-byte identical and URL/visual scanning runs under
  Deno with NO npm/node_modules — `nodeModulesDir:"none"`); a generated in-page
  bundle (`detect-antipatterns-browser.js`, injected via `Page.evaluate`); and its
  own `deno.json`/`deno.lock`/`LICENSE`/`NOTICE`. Run as `deno task lint <file|dir>`
  (static) or `deno task lint:url <url>` (browser).
- **`assets/proto-host/`** — a copied generic Deno serving harness (`_start.ts` +
  `deno.json`, `deno task start`): the two-seam prototype host that serves the
  AI-authored HTML + `objects/*.json` read model + `commands.json` write contract
  (and an annotate overlay), knowing nothing app-specific.
- **`scripts/detect.mjs`** — a Node-shaped entrypoint the agent calls
  (`node .../scripts/detect.mjs --json <targets>`) that FORWARDS to design-lint's
  `bin/detect.mjs` — resolves it via `$DESIGN_LINT_BIN`/`$DESIGN_LINT_DIR` or by
  walking up for a sibling `design-lint/`, then invokes `deno run` so the
  import-map shim is in effect (design-lint is the single source of truth; the
  skill no longer ships its own engine copy).

**Guardrail sync**: every agent def carries an auto-synced block between
`<!-- BEGIN sprig-agent-guardrail -->…<!-- END -->` markers, stamped verbatim from
`scripts/agent-guardrail.md` by `deno task sync:agent-guardrail`; the drift gate is
`deno task check:agent-guardrail` — the same script run with `--check` (both tasks
in the root deno.json; spec 10 §2). Rationale: subagents spawn with only their own
`.md` as context and historically improvised `find /` (600+ root crawls measured;
Claude Code shims find to a multithreaded bfs that pegs cores). **Never hand-edit
inside the markers.**

**Release discipline** (README): any release changing a public runtime/compiler
surface must update the matching `claude/skills/*/references/*.md` + agent defs in
the SAME commit (measured failure: 112 tool calls reverse-engineering an undocumented
`ResolveCtx`).

## 3. `scripts/sync-rune.ts`

`deno task sync:rune [version]` repins `@mrg-keystone/rune` to the newest JSR version
(authoritative `api.jsr.io`) across `server/deno.json` + every `fixtures/*/deno.json`,
then relocks. `server/deno.json` is the source of truth `sprig init`'s `runeRange()`
reads.

## 4. The annotate overlay (`annotate.ts` + `annotate-client.js`)

A ⌘/Ctrl+click feedback overlay injected into served HTML. The two modes are
mutually exclusive: `sprig dev --annotate <html>` does not layer prototype mode on
top of the project dev server — it replaces the project dev server with a
standalone server for the one throwaway HTML file, and BUILD mode does not run in
that invocation. Bare `sprig dev` (no `--annotate`) always runs BUILD mode.

- **BUILD mode** (`makeAnnotate` — always on under bare `sprig dev`): each note is keyed to
  the COMPONENT owning the clicked element, resolved via the view-encapsulation scope
  id (`componentScopeId` from the compiler). `scanComponents(srcDir)` maps scope-id →
  `{component, relDir, selector, kind: static|island|page, isolate?, isolateUrl?}`
  (island = has logic.ts; isolate info derived from `isolate/fixture.json` + cases —
  the "edit in isolation" hint). Notes persist to
  `<specRoot>/spec/ui/build-notes.json` (component-keyed, with a `_howto` header);
  screenshots as `build-notes.<key>.png` beside it. **Consumer:** the sprig:build
  agent fleet — each entry names a component to open in `sprig isolate` and fix.
  This is sprig's ONE load-bearing `spec/ui` path (anchored via `specRootOf` — the
  git-root walk of spec 09 §2).
- **PROTOTYPE mode** (`makePrototypeAnnotate` — `sprig dev --annotate <html>`): serves
  one throwaway HTML + its dir with the same overlay, keyed to ELEMENTS by CSS
  selector; persists to a sibling `<name>.feedback.json`; supports an inline source
  patch (`/__annotate/inline` writes `data-note`/`data-note-css` onto the matched
  opening tag) and SSE hot-reload on external edits.

HTTP API (both modes): `/__annotate/ping` (identity — the CLI uses it to detect/reuse
a running instance), `/state`, `/clear`, `/save`, `/shot`; prototype adds `/reload`
(SSE) + `/inline`. Injection: `inject(res)` splices
`<script>window.__SPRIG_ANNOTATE__=<cfg></script>` + the client JS before `</body>`;
`annotate-client.js` (~76KB) is loaded as text via a module-relative URL (works
file:// and https://).

## 5. This repo hosts its own composed app

- `serve.ts` (root): `serveSprig({ keep: api, app, base: "", assetsDir:
  <repo>/app/static })` — the isolate workbench as a production app. Its
  `start` task is the same `ensureRuneWorkspace`-generated form spec 05 §5
  documents: `deno serve -A serve.ts`, no `--unstable-kv` flag on the command
  line — `ensureRuneWorkspace` hoists `unstable:["kv"]` into the root
  `deno.json` itself, so the KV backend the session store needs is already
  declared there and the flag would be redundant.
- **The repo commits the full prebuilt asset bundle.** `app/static/**` is
  git-TRACKED (not gitignored): `client.js`, `chunk-*.js`, `isl.workbench.js`,
  `isl.run-tests.js`, `isl.stage-bridge.js`, `app.css`, `templates.json`, and
  `build-info.json` — the eight of them. `buildClient` also writes a ninth file into
  this same `outDir`, `import-map.json` (spec 04 §2) — that one is a build-time-only
  record consumed by the bundler invocation itself and never read again, so it is
  NOT part of this committed set; only the eight above are checked in. `serve.ts:23` serves this dir as
  `assetsDir`, and the `start` task (`deno serve -A serve.ts`) has NO build step,
  so these checked-in outputs ARE what makes prod / Deno Deploy work. In
  particular `templates.json` (~498K) is the prebuilt serialized-AST registry that
  `createRenderer` reads at boot (from `SPRIG_ASSETS_DIR`, else `<cwd>/static`;
  compiler/mod.ts:100) so `main.ts` / `serve-dev.ts` never live-parse every
  template with tree-sitter.
- `serve-dev.ts`: the same composition wrapped in `createDevServer`, plus a project
  watcher that mirrors user-project component edits into
  `app/src/_preview/targets/*` or re-discovers on structural change. It sets
  `SPRIG_ASSETS_DIR=outDir` (serve-dev.ts:30) BEFORE it imports `main.ts` — because
  `createRenderer` reads that env at module-eval to load the prebuilt
  `templates.json` (ASTs) instead of tree-sitter-parsing every template at boot;
  the order is load-bearing (serve-dev.ts:27-30).
- `.sprig-app.json` (root) is NOT authored config — it is the stale merged-config
  artifact `withMergedConfig` writes during `sprig dev` on a `--dev` install (its
  imports point into an external app's absolute paths).
- `.infra/git.json` is the provenance sidecar `writeBuildInfo` copies into
  `static/build-info.json` (moved out of deno.json to avoid merge conflicts; the
  deno.json `git` block is the legacy fallback).
- `env/prod` exists but is empty; `env/dev` doesn't exist; the convention is flat
  dotenv files under `env/<name>` loaded by the dev CLI.

## 6. Refactor notes

1. Four distribution channels (JSR publish set, GitHub runtime bundle, GitHub skills
   release, and the standalone `mrg-keystone/isolate` release → `~/.isolate` — §1)
   with different contents — document or collapse.
2. The install is imperatively copied state with `.old` backup; failed installs and
   `~/.sprig` wipes have been observed (spec 10 §1.6) — consider a manifest +
   verify/repair step.
3. Skills deployment "whole-entry replace" deletes user edits inside managed skill
   folders by design — this contract must stay loud.
4. annotate.ts mixes two products (component feedback vs prototype feedback) behind
   one overlay — a natural split.
