# sprig

A folder-component web framework for Deno: **Angular-flavoured templates** compiled to HTML,
**server-rendered** with **selective island hydration**, served by a **keep** backend over **one
origin**, deployable to **Deno Deploy** with a single `deno serve`. The keep in-process client is
auto-wired into the UI's data layer — **no `globalThis`, no fetch shims, no manual dispatch**.

Built to the design in [`build-spec.md`](./build-spec.md), on the stack in [`list.md`](./list.md).
This repo is a **working, tested** implementation, not a sketch.

```
deno task build   # code-split islands + scope each styles.css + Tailwind → static/{client.js, isl.*.js, chunk-*.js, app.css}
deno task start    # deno serve serve.ts  → http://localhost:8000/ui
deno task dev      # state-preserving HMR: watcher + SSE, hot-swaps templates/CSS keeping island state (no Vite)
deno task test     # 37 tests: backend + SSR + compiler + scoping + browser hydration + soft-nav + code-split + encapsulation + HMR
```

## The one-origin entry

```ts
// serve.ts — the whole composition; deno serve / Deno-Deploy ready
import { serveSprig } from "@sprig/keep";
import { api } from "@app/backend";   // keep: bootstrapServer already awaited
import { app } from "@app/ui";         // sprig: bootstrap({ routes })
export default serveSprig({ keep: api, app, base: "/ui" });
```

`serveSprig` is the single-origin dispatcher:

| path | goes to |
|---|---|
| `/api/*` | keep `handler` (network, **token-gated**), prefix stripped, `info` forwarded |
| `/docs/*` | keep `handler` (Swagger / the cake) |
| `/ui/_assets/*` | the built `client.js` etc. (immutable cache + `?v=<hash>`) |
| everything else | the sprig SSR app, with the in-process `Backend` threaded in |

## The data path — no black magic

A page's `resolve.ts` reads its view-model **in-process** through a built-in `Backend` token —
the keep client (no port, no TCP, no token), bound per request by `serveSprig`:

```ts
// ui/src/board/resolve.ts
import { Backend, inject } from "@sprig/core";
export const resolve = async () => {
  const be = inject(Backend);            // server-scoped; injecting in island code throws
  const { data } = await be.get("/http/board", { method: "POST" });
  return { board: data };                // → the page's @inputs
};
```

The backend is **rune-generated** keep (`backend/board.rune` → `rune sync`): 4 endpoints returning
ready-to-render view-models, every seam asserted (bad input → 422).

## The folder-component model

A component is a **folder**: `template.html` (required) + optional `logic.ts` (→ island) +
`resolve.ts` (server data) + `styles.css`. Templates use the Angular surface the
[`tree-sitter-angular-template`](./tree-sitter-angular-template) grammar parses. **A component's
selector is its folder name** — `shared-components/avatar-stack/` → `<avatar-stack>`.

`src/` is organized by role: **`pages/`** (one folder per route, always **static** — interactivity
comes from the islands they place), **`shared-components/`** (reusable, e.g. the `counter` island),
and **`services/`** (`@Injectable` data layer the pages' `resolve.ts` inject). "Pages are static" is
**enforced**: a `logic.ts` directly in a `pages/<name>/` folder is a build- and boot-time error
(`assertStaticPage`) — move interactivity into a shared-component or a page-local
`pages/<name>/components/<comp>/` island.

- **Static** (`template.html` only) → pure SSR HTML, zero JS.
- **Island** (`+ logic.ts`) → SSR'd, wrapped in `<sprig-island>` + a JSON prop bridge, then
  hydrated on the client (reactive re-render via `@preact/signals-core`, events via delegation).

**Per-component styles + view encapsulation.** A component folder may carry a `styles.css`. The build
gives each component a stable scope id, marks every element its template emits with that id (at SSR
**and** on an island's client re-render), and rewrites each CSS rule's key selector to require that
marker — Angular's "Emulated" encapsulation, no Shadow DOM. So a component's styles **only** touch its
own elements; they can't leak to or be clobbered by another component (proven by the `scope:` unit tests
+ a headless-Chromium encapsulation test). Styling is **Tailwind v4**: author the scoped `styles.css`
with `@apply` + utilities; the build runs the Tailwind CLI and serves one immutable, hashed `app.css`.

**Per-island code-split (M7).** `sprig build` emits a tiny eager loader (`client.js`, ~200B), one
content-hashed **shared runtime chunk** (`@sprig/core` + the interpreter, loaded once), and one
small chunk per island (`isl.<sel>.js`). The loader scans the page and dynamically `import()`s each
island's chunk **only when its `trigger` fires** — `load` / `idle` / `visible` (IntersectionObserver)
/ `interaction`. So a page ships JS only for the islands actually on it: the dashboard never fetches
the issue page's `star-rating` chunk. The shared runtime is never duplicated, so the client root
injector + signals stay singletons across islands. Set a trigger in `logic.ts`:
`defineComponent({ trigger: "visible", setup: …})`.

The compiler (`ui/.sprig/compiler/`) parses templates with a **wasm** build of the grammar
(`web-tree-sitter`, no Rust) and walks the AST with one interpreter that runs **both** on the
server (→ HTML string) and the client (→ the same HTML, from a serialized JSON AST). It handles
interpolation, every binding form (`[prop]`/`[attr.x]`/`[class]`/`[style.x.unit]`/`[innerHTML]`),
`@if`/`@for`/`@switch`/`@let`/`@defer`, pipes, nested component composition, `<ng-content>`
projection, and `<router-outlet>`.

**Soft navigation:** the client intercepts same-origin `/ui/*` links via the Navigation API,
fetches the next page, swaps **only** the `<sprig-outlet>` inside a view transition, and
re-hydrates islands inside it — islands **outside** the outlet keep their state.

## Workspace

```
deno.json            workspace: ["./backend","./ui"] + the serve tasks
serve.ts             the deno-serve entry (export default serveSprig(...))
static/              build output (client.js + manifest) — gitignored
backend/             @app/backend — rune-generated keep API (board.rune → src/)
ui/                  @app/ui — the sprig folder-component app
  .sprig/core.ts     @sprig/core — DI, the Backend token, bootstrap()/SSR, signals
  .sprig/compiler/   the wasm template compiler + hydrate runtime + build + dev/HMR
  src/main.ts        the route table + bootstrap()
  src/pages/         routed pages (static): dashboard, board, issue, user
  src/shared-components/  reusable components: counter (island), issue-card
  src/services/      @Injectable data layer over the Backend: board, user
  src/shell/         the root layout (the <router-outlet> host)
packages/keep/       @sprig/keep — serveSprig + the thin `sprig` CLI
```

## What's tested (37, all green)

- **backend** — `rune lint` + `deno lint` clean; per-aggregate unit tests (`Board`/`Issue`/`Dashboard`/`User.assemble`) + per-coordinator integration tests (happy path **and** invalid input → the 422 assert seam); `exerciseEndpoints` walk + every endpoint's view-model over the in-process channel.
- **spine** — `serveSprig` dispatch + the in-process `Backend` reaching `resolve.ts` (no globalThis), through the real `serve.ts`.
- **compiler** — expression eval (16 cases), the renderer (control flow, bindings, projection, escaping), JSON-AST roundtrip.
- **hydration** (headless Chromium) — a counter island: signals, `(click)`, `[disabled]`, and `@if` all reactive.
- **soft-nav** (headless Chromium) — the Navigation API swaps the outlet; a shell island keeps its state across the navigation.
- **code-split** (headless Chromium) — the dashboard loads only the counter chunk + one shared runtime chunk and **never** fetches `star-rating`'s; the issue page lazy-loads `star-rating` on its `visible` trigger and it's reactive.
- **encapsulation** — `scope:` unit tests (the CSS scoper + the SSR marker) + a headless-Chromium test that the page's components have distinct scope markers, islands keep theirs after hydration, and one component's scope can't reach another's element.
- **HMR** (headless Chromium) — a counter island driven to 5, then its `template.html` is edited on disk; the dev watcher hot-swaps the island and the count is **still 5** (state preserved, no reload).

## Status vs the milestones

M0 compose · M1 in-process Backend · M2 SSR compiler · M3 islands + hydration · M4 soft-nav ·
M5 data via keep · M6 assets + build/dev/deploy · M7 per-island code-split — **all implemented and
tested**, plus per-component **view encapsulation** + Tailwind and **state-preserving HMR**. The one
remaining follow-up: legacy `*ngIf`/`*ngFor` (the app uses the modern `@`-syntax).

## Dev loop — state-preserving HMR, no Vite

`sprig dev` runs a long-lived server (not `deno serve --watch`): `serveSprig` + a `Deno.watchFs`
watcher + an SSE channel (`/_sprig/hmr`) + a live AST route (`/_sprig/ast/<sel>`). The island is the
HMR boundary — its state lives in signals created once in `setup()`, so:
- **`template.html` edit** → re-parse one file (≈ms, no rebundle) → push the new AST → the client
  swaps the island's nodes while keeping the **same scope** → **state preserved**.
- **`styles.css` edit** → re-scope + Tailwind → swap the `<link>` → repaint, zero JS, zero state.
- **`logic.ts`/server edit** → rebuild the dev bundle → full reload.

No bundler module graph needed: sprig already serializes templates to JSON and renders them with a
reactive `effect` from a registry, so "hot-swap a template while keeping state" is just *assign new
nodes, keep the scope, re-run the effect*.
