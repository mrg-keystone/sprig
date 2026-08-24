## 2. Command surface

This is the command index; each row delegates deep behavior to the owning spec.
See DX-IDEAL [§3.5/§3.8](../DX-IDEAL/04-3-per-subsystem-ideal.md) (honest CLI
verbs, `sprig doctor`) for proposed changes to this surface.

Decided: these are as-shipped; DX-IDEAL
[§3.5/§3.8](../DX-IDEAL/04-3-per-subsystem-ideal.md)'s proposed surface lands
in this table only once it ships, not ahead of it.

A `—` owning spec means the row is TERMINAL: `clean`, `check`, `stop`,
`version`, and `help` have no deeper spec — the "what it does" cell IS the
whole contract.

| command | args | what it does | owning spec |
|---|---|---|---|
| `sprig init` | `[dir]` | scaffold a **ui/ + server/ monorepo** | [§3](03-3-sprig-init-the-scaffold-contract.md) |
| `sprig dev` | `[appDir] [base] [--annotate <html>] [--open] [--no-cache]` | supervised HMR dev server — template edits hot-swap in place, logic/server edits full-reload wiping signal state | [§4](04-4-sprig-dev-the-three-layer-architecture.md)/[§6](06-6-dev-server-hmr-dev-ts-hmr-ts.md) |
| `sprig build` | `[appDir] [--rune] [--clean]` | (normal) code-split islands + scope CSS + Tailwind → `ui/static/`, then unconditionally emit the rune composition; `--clean` short-circuits to `sprig clean` instead — removes artifacts, runs NO build and emits NO composition | [§5](05-5-sprig-build-rune-composition-emission.md) |
| `sprig clean` | `[appDir]` | remove exactly `<ui>/static/` + a marker-carrying generated `serve.ts` | — |
| `sprig check` | `[appDir]` | typecheck the app under the SAME forced import map the build uses (temp config carrying app compilerOptions) | — |
| `sprig isolate` | `[appDir] [--no-open]` | launch the isolate workbench against the app (delegates to `cli/main.ts dev`) | spec 07 |
| `sprig serve` | `[entry]` | run the app's host entry as a **subprocess** (`deno run -A <entry>`, default `serve.ts`) after loading `env/dev`; the entry must self-listen | [§5](05-5-sprig-build-rune-composition-emission.md) |
| `sprig stop` | `[appDir]` | kill the shared dev process + ports for this repoKey | — |
| `sprig install` / `sprig update` | `[--dev]` (install only) | install/refresh the `~/.sprig` runtime + Claude skills/agents + launcher | spec 08 |
| `sprig -v` / `--version` | — | local version + build-info vs latest GitHub runtime release (bare-word `sprig version` also accepted, cli.ts:2183) | — |
| `sprig help` / `--help` / `-h` / *(no command)* | — | print USAGE, exit 0 (cli.ts:2191-2196) | — |

