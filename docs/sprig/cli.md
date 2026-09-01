<sub>[← sprig docs](./README.md)</sub>

# The CLI

The `sprig` CLI lives at `framework/cli.ts`. Run it with `deno run -A framework/cli.ts <cmd>`,
or via the `deno task` aliases that `sprig init` writes into your app's `deno.json`.

```
sprig init  [dir]               scaffold a minimal, runnable sprig app           (default: .)
sprig dev   [appDir] [entry]    state-preserving HMR dev server (no Vite)        (default: app, serve.ts)
sprig build [appDir]            code-split islands + scope CSS + Tailwind → static/  (default: app)
sprig check [appDir]            typecheck under the CLI runtime + template wiring lint  (default: .)
sprig map   [appDir]            print the wiring channels (who sets/edits/reads)  (default: .)
sprig serve [entry]             boot a serve.ts's default { fetch } handler      (default: serve.ts)
sprig help
```

## `map [appDir]` (and the wiring lint)

`sprig map` renders the app's dataflow from its templates alone — one stable-ordered line
per wiring channel, one clause per verb, pages joined through a forwarding
`<router-outlet>` included:

```
org: set by side-nav → edited by org-quick-rename → read by org-detail, app-detail
```

`sprig check` runs the wiring lint over the whole template graph (undeclared signal /
no-origin channel → **error**; lone participant / multiple `sets:` → **warning**), and
`sprig build` refuses to ship a template graph with wiring errors. See
[wiring.md](./wiring.md).

## `init [dir]`

Scaffolds a working app at `dir` (default `.`): `deno.json` (imports + `dev`/`build`/`start`
tasks, decorators enabled), `build.ts`, `serve.ts` (with a **no-op keep** stub), and a `src/`
tree with `shell/`, `pages/home/` (template + resolve + styles). See
[getting-started.md](./getting-started.md).

## `dev [appDir] [entry]`

State-preserving HMR with **no Vite**. It:

1. sets `SPRIG_DEV=1` and builds the client bundle — the **byte-identical prod bundle** (there is
   no dev variant). Every build compiles in a dormant HMR client; `SPRIG_DEV` makes the SSR emit
   `cfg.hmr`, which wakes it. Island chunks bake their AST like prod; on a hard reload the woken
   receiver refetches each island's AST from the dev server, so an edited template is still fresh;
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

Production build of `appDir/src` → `static/`. See [architecture.md](./architecture.md) for the
pipeline. Output:

```
static/client.js           the eager loader (scans the DOM, lazy-loads islands by trigger)
static/isl.<sel>.js        one tiny chunk per island (its template AST baked in)
static/chunk-<hash>.js     the shared runtime (@mrg-keystone/sprig + interpreter + hydrate), loaded once
static/app.css             all component CSS, scoped + Tailwind-expanded + minified
static/templates.json      server-only prebuilt ASTs so the SSR renders without the tree-sitter parser
```

The build writes **no manifest**: `?v=` is the content hash of `static/`, recomputed by the SSR on
demand (`readVersion`), so the output folder is self-contained. There is **no `--dev` variant** —
`buildClient(src, static)` emits one bundle, and `sprig dev` serves those exact bytes (HMR rides on
top via the `cfg.hmr` runtime flag, never a different build).

## `serve [entry]`

Imports `entry` (default `serve.ts`), asserts its default export has a `fetch`, and runs it
under `Deno.serve`. Equivalent to `deno serve -A serve.ts` (the `start` task), but going
through the CLI. For a real keep backend you'll typically use `deno serve -A --unstable-kv
serve.ts`. See [hosting.md](./hosting.md).

---

**Next:** [hosting.md](./hosting.md) — the serve composition.
**See also:** [getting-started.md](./getting-started.md) · [architecture.md](./architecture.md)
