## 1. Entry and self-location

- Dispatch: `const [cmd, ...rest] = Deno.args`, `switch` at cli.ts:2119-2200 — the full
  command list it dispatches to is [§2](02-2-command-surface.md); unknown `cmd` → USAGE +
  exit 1.
- Static imports only for the package's own modules (JSR-analyzable); `annotate.ts` is
  the one lazy dynamic import (dev-only).
- Installed vs. remote `jsr:` run — every self-location helper forks on ONE signal,
  `import.meta.dirname` (a real path when this module loaded from disk — `~/.sprig` or a
  repo checkout under `--dev` — `undefined` when it loaded straight from `jsr:`/`https:`;
  it never throws, unlike `fromFileUrl(import.meta.url)`):

  | helper / requirement | installed (`~/.sprig` or a checkout) | remote `jsr:` run |
  |---|---|---|
  | `cliVersion()` | own semver, read from `<install>/deno.json` | `null` |
  | `sprigRange()` | `^<cliVersion()>` | `^0.19.0` (used only when `cliVersion()` is null — [§3](03-3-sprig-init-the-scaffold-contract.md)'s "EXACT" is the normal case) |
  | `runeRange()` | the `@mrg-keystone/rune` pin, read DIRECTLY from `<install>/server/deno.json` via `import.meta.dirname` — NEVER through `installRoot()` (its jsr guard `Deno.exit(1)`s uncatchably; routing through it would kill every remote run, e.g. every Deno Deploy build, instead of degrading gracefully) | `^3` floor |
  | `installRoot()` | `<import.meta.dirname>/..` | prints "run `sprig install`" and `Deno.exit(1)`s — every OTHER on-disk requirement below rests on that same exit |
  | web-tree-sitter grammar (spec 08 §1) | npm `node_modules` present on disk | same wall as `installRoot()` — the grammar bytes alone would fetch fine from JSR, but `node_modules` doesn't |

  `cliVersion()` feeds both `sprigRange()` (the init pin) and `stamp()` (the build-time
  pin); `init` pins the EXACT value whenever it's non-null (cli.ts:1732-1736).
  `scripts/sync-rune.ts` keeps the installed `server/deno.json` pin fresh.
- Concrete trace — one `sprig dev` invocation, installed CLI: `cli.ts` lives at
  `~/.sprig/framework/cli.ts`, so `import.meta.dirname` = `~/.sprig/framework` and
  `installRoot()` = `~/.sprig`. `cliVersion()` reads `~/.sprig/deno.json` → say `0.19.4`,
  so `sprigRange()` = `^0.19.4`; `runeRange()` reads `~/.sprig/server/deno.json` → say
  `^3.2.0`. The user runs `sprig dev` from `~/code/acme-storefront`, a git repo on branch
  `feature/checkout`: `gitRepoRoot` walks up from the cwd to `~/code/acme-storefront`
  (finds `.git` there); `gitBranch` returns `feature/checkout`, sanitized to
  `feature-checkout`; `repoKey` = `<repo-folder>-<branch>` = the folder name, not the
  full path, hyphen-joined with the branch → `acme-storefront-feature-checkout`.
  `devPorts("acme-storefront-feature-checkout")` then hashes that key twice: the app port
  is `appPort("acme-storefront-feature-checkout")` (a fixed value in 20000-28999, the
  same on every run for this repo+branch), and the embedded isolate workbench's port is
  the independent hash `appPort("isolate:acme-storefront-feature-checkout")`.
- Ports: `freePort(start)` (+50 scan) is the generic free-port scanner; `appPort(seed)`
  hashes a seed via FNV-1a into 20000-28999 for a STABLE, deterministic port. The
  standalone `sprig isolate` command picks its OWN port with
  `freePort(Number(Deno.env.get("PORT") ?? 8000))` — a forward scan starting at 8000 (or
  a caller-set `PORT`), NOT an `appPort` hash — then passes that value to the spawned
  workbench process (`deno run … cli/main.ts dev`, spec 07 §1 step 6) via the child's
  `PORT` env, the SAME env var name the main app reads.

  | context | how the port is chosen | role of `PORT` | collision guarantee vs app port |
  |---|---|---|---|
  | main app (`sprig dev`) | `appPort(repoKey)` | overrides this port directly — the `appPort` call is keyed on the app/repo | — (this IS the app port) |
  | `dev --annotate <html>` (prototype) server | `appPort(basename(htmlPath))` — keyed on the prototype FILE's basename, not `repoKey` | overrides this port directly | none against the app port — keyed on the prototype file, so two prototypes in one repo don't collide with each other OR with the main app port |
  | isolate — supervised, embedded in `sprig dev` (`devPorts`, [§4](04-4-sprig-dev-the-three-layer-architecture.md)) | `appPort(\`isolate:<repoKey>\`)` — a SECOND, independent hash | the launcher sets the child's `PORT` explicitly (spec 07 [§6](../07-isolate-workbench/06-6-sprig-isolate-cli-main-ts.md)), overriding whatever `PORT` the parent shell had | none — independent hash from the app port's, no collision check between the two; a same-repo collision is possible in principle, just made unlikely by the 9000-wide band |
  | `sprig isolate` (standalone command) | `freePort(Number(PORT ?? 8000))` — forward scan starting at 8000 | same launcher-set child `PORT` mechanics as above, but the VALUE passed comes from the scan, not a hash | none checked against the supervised row's hash — deliberately NOT `appPort(\`isolate:<repoKey>\`)`: reusing that hash here would collide with an already-running supervised workbench for the same repo |
  | isolate workbench spawned under `dev --no-cache` (devStandalone) | `freePort(appPort + 1)` — forward scan from the app port | same launcher-set child `PORT` mechanics as above; reached only via `dev --no-cache`, a separate path from the `sprig isolate` row above (07 [§6](../07-isolate-workbench/06-6-sprig-isolate-cli-main-ts.md); `sprig isolate`'s own command row exposes no `--no-cache`, [§2](02-2-command-surface.md)) | guaranteed distinct — a forward scan starting past the app port can never land on it |

  The launcher sets each spawned child's `PORT` explicitly, per process — that override
  is what keeps a user-set parent-shell `PORT` from leaking into a workbench's listener.
  Acceptance criterion: `appPort(seed)` must be deterministic and always land in
  20000-28999, for any seed.
- Git anchoring: `gitRepoRoot` (walk to `.git` dir OR file), `repoKey(target)` =
  `<repo-folder>-<branch>` — the key for dev-process sharing and workbench isolation.
  When the walk reaches the filesystem root without finding a `.git`, `repoKey` falls
  back to `target` itself (its own folder name, no branch suffix) rather than erroring —
  silently, today, so two unrelated non-git directories sharing a folder name would share
  a dev-registry key and ports.

  > **[DECIDE]** Should running outside any git repo stay a silent cwd/folder-name
  > fallback, or hard-error and require a repo? Recommended default: keep the fallback
  > (erroring outside git is needless friction for a quick prototype dir) but log a
  > one-line warning naming the fallback key, so a same-name collision is loud instead of
  > silent.

