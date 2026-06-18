# isolate cli/

The user-facing CLI, built on **cliffy**. Run from inside a Fresh 2 project (or
point `--root` elsewhere).

```
isolate list              list discovered components + their cases/routes (table)
isolate dev               materialize + serve the preview app, open the browser
isolate test [filter]     run cases' Playwright tests headlessly (--json for CI)
isolate update            reinstall the latest bundled skills + the global CLI
isolate --help            auto-generated help (cliffy)
```

## Install / update (GitHub releases)

isolate ships as a **GitHub release bundle** — one `isolate-vX.Y.Z.tar.gz`
containing `cli/ + server/ + ui/ + skills/` (the UI is packaged with the CLI).
`.github/workflows/release.yml` builds + publishes it on every push to `main`.

First-time install (one-liner):

```sh
deno run -A https://raw.githubusercontent.com/mrg-keystone/isolate/main/install.ts
```

This downloads the latest release, extracts the runtime to **`~/.isolate/`**,
copies the skills to **`~/.claude/skills/<name>`**, and installs the global
`isolate` bin via `deno install` from `~/.isolate/cli/main.ts`. Thereafter:

```sh
isolate update      # re-pull the latest skills + CLI + UI (all in the bundle)
```

- `install.ts` (repo root) is the standalone bootstrap; `cli/lib/install-core.ts`
  is the shared download → extract → install-skills → install-bin logic that both
  the bootstrap and `isolate update` use.
- The bin is installed from the **local** `~/.isolate/cli/main.ts`, so the CLI's
  relative reads (`../../ui`, `../../server`) resolve to the bundle. The CLI
  imports the server core by **relative path** (no cross-package `@/`), which is
  what survives `deno install -g`.
- Skill install never deletes a `.git` checkout (dev layouts stay safe).


Global `-r, --root <path>` (default `.`). `dev`: `--no-open`, `-f/--force`.
`test`: `[filter]` (matches a spec path OR `component/case`), `--json`, `--base-url`.

## Layout

```
main.ts                cliffy Command tree + global --root + error handler
commands/
  list.ts              discover() → @cliffy/table + routes
  dev.ts               materialize + spawn keep (API) + Vite preview + open
  test.ts              materialize + start preview + runTests() + report
  update.ts            → lib/update.cmdUpdate
lib/
  format.ts            problem report, list table, test-report printer (@cliffy/ansi)
  process.ts           pump/drain, startServer (ready-URL detect), openBrowser, signals
  runner.ts            ensureRunner — provisions ~/.isolate-runner (Playwright + rxjs + events)
  materialize.ts       the reference setupApp, adapted to copy ui/ instead of inlined strings
  update.ts            JSR latest + skills install + global CLI (ported from reference)
  events/              the isolate-events helper (capture/waitHydrated) copied into the runner
```

## How it reaches the other layers

- **list / test** call the server's pure core directly — `deno.json` maps `@/` →
  `../server/`, so `discover()` and `runTests()` are imported in-process (no keep
  bootstrap needed; the reference did the same).
- **dev** materializes the `ui/` template into `~/isolate/<project>` (symlinking
  the host's components/islands/pages, generating the manifest + per-case routes +
  preview islands), then spawns the **keep** server (`../server`) for the run-button
  proxy and the **Vite** preview app, wired via `ISOLATE_KEEP_URL`.
- **test** materializes, starts the Vite preview, then `runTests()` spawns
  Playwright against it (passing the materialized `playwright.config.ts`).

## Verified

`deno check` / `deno lint` / `deno fmt` clean. End-to-end against
`reference/fixtures/fresh-app`:
- `isolate list` → 4 components, 9 cases (table + routes)
- `isolate test button/primary` → `1/1 passed`
- `isolate dev` → `◆ isolate ready → http://127.0.0.1:8321/`

`update` is ported from the reference but not exercised here (it hits JSR + does a
global install).
