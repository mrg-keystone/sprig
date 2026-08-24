## 6. `sprig isolate` ↔ `cli/main.ts`

The framework CLI's `isolate` subcommand is a thin wrapper over `cli/main.ts dev`
([§2](02-2-the-isolate-cli-cli.md)): it adds a fixed set of defaults on top of the raw
command and delegates everything else. This section owns that delta — 07
[§1](01-1-what-isolate-is-end-to-end.md)'s entry-path table points its owner column
here:

| concern | what `sprig isolate` sets | raw `cli/main.ts dev` default | owner |
|---|---|---|---|
| install precondition | asserts the workbench is installed — `~/.sprig` must contain `app`, `server`, `cli`, `serve.ts` — else prints "run `sprig update`" and exits before spawning | none — invoked directly, no install check | this section |
| app root | resolves the given `<app>` to an absolute `<appAbs>`, passed as `--root <appAbs>` | `--root <path>` (default `.`), the caller resolves it themselves | this section |
| `SPRIG_WB_ROOT` | a per-repo `SPRIG_WB_ROOT` = `$TMPDIR/sprig-work/<repoKey>` — a private per-repo-branch copy | unset → the shared install root itself ([§1](01-1-what-isolate-is-end-to-end.md) step 3) | this section |
| `PORT` | computed by the port rule below, set explicitly on the child's env | `PORT` env, else `8000` ([§1](01-1-what-isolate-is-end-to-end.md) step 6) | this section |
| `--config` | pinned to `<installRoot>/deno.json` | not pinned — invoked directly, the caller's own environment resolves it | this section |
| forwarded flags | `--no-open` passes straight through to `cli/main.ts dev`'s own `--no-open` — the only flag the wrapper's command row carries (05-cli [§2](../05-cli-dev-hmr/02-2-command-surface.md) lists `sprig isolate`'s args as exactly `[appDir] [--no-open]`); `-f/--force` NOT reachable — bypass a fatal discovery problem ([§1](01-1-what-isolate-is-end-to-end.md) step 1) by running `cli/main.ts dev -f` directly against the app instead | `[--no-open] [-f/--force]` both available directly ([§2](02-2-the-isolate-cli-cli.md)) | this section |

**Delegates** (unowned here): the dev flow itself (discover → provision → materialize
→ generate → build → serve, [§1](01-1-what-isolate-is-end-to-end.md)), everything else
`cli/main.ts` does internally ([§2](02-2-the-isolate-cli-cli.md)), the port
algorithm's mechanics (05-cli
[§1](../05-cli-dev-hmr/01-1-entry-and-self-location.md)), and the command-row surface
`sprig isolate` itself exposes (05-cli
[§2](../05-cli-dev-hmr/02-2-command-surface.md)).

**Port**: the wrapper doesn't invent a port scheme — it follows 05-cli
[§1](../05-cli-dev-hmr/01-1-entry-and-self-location.md)'s standalone-command rule:
`PORT` = `freePort(Number(Deno.env.get("PORT") ?? 8000))`, a forward free-port scan
seeded at the parent shell's `PORT` (or `8000` when unset). This is deliberately NOT
`appPort(\`isolate:<repoKey>\`)` — that hash is reserved for the isolate workbench
EMBEDDED in a supervised `sprig dev` (05-cli
[§1](../05-cli-dev-hmr/01-1-entry-and-self-location.md)); reusing it here would collide
with an already-running supervised workbench for the same repo. The wrapper sets the
child's `PORT` env explicitly to the scanned value either way, so a parent-shell
`PORT` only ever reaches the child as the scan's seed — never as a direct override of
its listener.

**Worked example** — `sprig isolate ./app` run inside repo `foo` on branch `main`:
`appAbs` resolves to `/Users/…/foo/app`; `repoKey` = `foo-main`; `SPRIG_WB_ROOT` =
`$TMPDIR/sprig-work/foo-main`; `PORT` = `freePort(Number(PORT ?? 8000))` — e.g. the
first free port at or above `8000`; the wrapper spawns `deno run -A --config
~/.sprig/deno.json ~/.sprig/cli/main.ts dev --root /Users/…/foo/app`; the workbench
serves at `http://127.0.0.1:<port>/` ([§1](01-1-what-isolate-is-end-to-end.md) step 6).

`SPRIG_WB_ROOT` is the isolation key — without it, concurrent runs regenerate the one
shared workbench (the install root itself, named in [§1](01-1-what-isolate-is-end-to-end.md) step 3) and delete each other's
previews mid-run.

**Why `--config <installRoot>/deno.json`**: the spawned process runs `cli/main.ts` out
of the install root and imports that root's own `cli/`, `server/`, `app/` trees — so it
needs that tree's own import map and permissions to resolve, not the target app's
`deno.json` (whose import-map entries may differ or be absent for the same specifiers)
and not a bare `jsr:` default (which would re-resolve the workbench's dependencies
instead of using the pinned local install it actually ships).

**Acceptance criteria** — what a correct implementation of this wrapper must satisfy:
- **Exactly one spawn, closed flag surface:** `sprig isolate <app>` spawns exactly
  `deno run -A --config <installRoot>/deno.json <installRoot>/cli/main.ts dev --root
  <appAbs> [--no-open]` — no other flag reaches the child.
- **Child env is explicit:** the spawned child's `PORT` and `SPRIG_WB_ROOT` are both
  set directly on its env, not inherited from the parent shell.
- **No workbench-root collisions:** two concurrent runs on different `repoKey`s never
  write the same workbench root — each gets its own `$TMPDIR/sprig-work/<repoKey>`.
- **Missing install aborts before spawn:** an install missing any of `app`/`server`/
  `cli`/`serve.ts` prints "run `sprig update`" and exits without spawning the child.
- **`-f/--force` unreachable:** no `sprig isolate` argument can set `-f/--force` on
  the child — that row's arg list stops short of it.

