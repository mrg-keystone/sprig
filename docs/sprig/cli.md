<sub>[← sprig docs](./README.md)</sub>

# The CLI

The `sprig` CLI lives at `framework/cli.ts`. Run it with `deno run -A framework/cli.ts <cmd>`,
or via the `deno task` aliases that `sprig init` writes into your app's `deno.json`.

```
sprig init  [dir]               scaffold a minimal, runnable sprig app           (default: .)
sprig dev   [appDir] [entry]    state-preserving HMR dev server (no Vite)        (default: app, serve.ts)
sprig build [appDir]            code-split islands + scope CSS + Tailwind → static/  (default: app)
sprig serve [entry]             boot a serve.ts's default { fetch } handler      (default: serve.ts)
sprig help
```

## `init [dir]`

Scaffolds a working app at `dir` (default `.`): `deno.json` (imports + `dev`/`build`/`start`
tasks, decorators enabled), `build.ts`, `serve.ts` (with a **no-op keep** stub), and a `src/`
tree with `shell/`, `pages/home/` (template + resolve + styles). See
[getting-started.md](./getting-started.md).

## `dev [appDir] [entry]`

State-preserving HMR with **no Vite**. It:

1. sets `SPRIG_DEV=1` and builds a **dev** client bundle (the HMR client + island chunks that
   **fetch** their AST so a hard reload is fresh);
2. imports your `entry` (`serve.ts`) production handler and the app's `renderer`;
3. wraps them in the compiler's dev server (`Deno.watchFs` + an SSE channel + a live AST
   endpoint) and serves on `PORT` (default 8000).

The HMR loop:

- editing a **`template.html`** or **`styles.css`** → re-parsed and **hot-swapped in place**,
  keeping each mounted island's reactive scope (its signals = its state) — no full reload. A
  mid-edit broken template (tree-sitter ERROR AST) and a no-op save are both suppressed.
- editing **`logic.ts`** or server code → rebuild + reload.

```bash
deno task dev        # → http://localhost:8000/ui
PORT=3000 deno task dev
```

## `build [appDir]`

Production build of `appDir/src` → `static/` (and the sibling server-only manifest). See
[architecture.md](./architecture.md) for the pipeline. Output:

```
static/client.js           the eager loader (scans the DOM, lazy-loads islands by trigger)
static/isl.<sel>.js        one tiny chunk per island
static/chunk-<hash>.js     the shared runtime (@sprig/core + interpreter + hydrate), loaded once
static/app.css             all component CSS, scoped + Tailwind-expanded + minified
.sprig-manifest.json       server-only { v, client, css, islands, chunks } — v drives ?v= cache-busting
```

`--dev` produces the AST-fetching dev variant. Both the CLI and the scaffolded `build.ts` call
`buildClient(src, static, { dev })`.

## `serve [entry]`

Imports `entry` (default `serve.ts`), asserts its default export has a `fetch`, and runs it
under `Deno.serve`. Equivalent to `deno serve -A serve.ts` (the `start` task), but going
through the CLI. For a real keep backend you'll typically use `deno serve -A --unstable-kv
serve.ts`. See [hosting.md](./hosting.md).

---

**Next:** [hosting.md](./hosting.md) — the serve composition.
**See also:** [getting-started.md](./getting-started.md) · [architecture.md](./architecture.md)
