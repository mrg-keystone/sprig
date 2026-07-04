# The sprig guide

sprig is a folder-component web framework for Deno. You write **Angular-flavoured
templates** and small TypeScript files in convention-named folders; sprig compiles the
templates (via a tree-sitter grammar) and renders them to HTML on the server, hydrating
only the interactive **islands** on the client. Styles are view-encapsulated, data is
loaded through dependency injection, and the whole thing serves from one `{ fetch }`
handler.

- [Mental model](#mental-model)
- [Project layout](#project-layout)
- [Folder-components](#folder-components)
- [Template syntax](#template-syntax)
- [Islands & hydration](#islands--hydration)
- [Data & services (DI)](#data--services-di)
- [View encapsulation](#view-encapsulation)
- [Routing](#routing)
- [The CLI](#the-cli)
- [Hosting](#hosting)
- [Testing](#testing)

---

## Mental model

```
request → serveSprig → sprig app (bootstrap) → match route → resolve.ts (load data via DI)
        → renderer: page template.html → shell <router-outlet> → full HTML document
        → browser: client.js boots → each <sprig-island> hydrates its logic.ts
```

- **Pages** are static on the server (no JS shipped) unless they contain islands.
- **Islands** (`logic.ts` present) are the only things hydrated on the client. Each ships
  as its own code-split chunk, loaded on its trigger (`load` / `idle` / `visible` /
  `interaction`).
- **The shell** is the persistent document layout with a `<router-outlet>`.

---

## Project layout

A sprig app is a folder scanned for `template.html` files:

```
src/
  main.ts                     # routes + renderer + bootstrap (the app entry)
  shell/
    template.html             # root layout — must contain <router-outlet></router-outlet>
    styles.css                # document-level styles (use :global for body/:root)
  pages/
    <page>/
      template.html           # the routed page
      resolve.ts              # async data loader (server-only, runs in the request injector)
      styles.css              # scoped page styles
      components/             # OPTIONAL page-local components (shadow same-named globals)
        <name>/{template.html, logic.ts, styles.css}
  shared-components/
    <name>/                   # globally reusable components
      template.html
      logic.ts                # OPTIONAL — its presence makes this folder an island
      styles.css
  services/
    <domain>/mod.ts           # @Injectable data layer
serve.ts                      # serveSprig({ keep, app, base }) — the one-origin handler
```

A component's **identity is its folder path** (not just the basename), so two
`issue-card/` folders in different places don't collide. A component under
`pages/<page>/components/<name>/` **shadows** a same-named global component within that
page only.

`sprig init <dir>` scaffolds this structure with a working home page.

---

## Folder-components

A component is a folder with up to four files:

| file | role |
|---|---|
| `template.html` | the markup (Angular-flavoured). **Required.** |
| `styles.css` | view-encapsulated styles for this component |
| `logic.ts` | island reactive scope (`defineComponent`). Its presence ⇒ this is an island. |
| `resolve.ts` | **pages only** — server-side data loader; its return becomes the page's inputs |

A folder directly under `pages/` is a **page** and can never be an island (the framework
asserts this). Put interactive bits in `pages/<page>/components/` or `shared-components/`.

---

## Template syntax

Templates are HTML plus Angular-style control flow, bindings, and interpolation.

```html
<!-- interpolation -->
<h1>{{ project.name }}</h1>
<p>{{ price | number:'1.0-2' }} · {{ today | date:'short' }}</p>

<!-- control flow -->
@if (board; as b) {
  <h2>{{ b.title }}</h2>
} @else {
  <p>No board.</p>
}

@for (issue of issues; track issue.id) {
  <issue-card [issue]="issue"></issue-card>
} @empty {
  <li>Nothing here</li>
}

<!-- property / attribute / class bindings -->
<a [attr.href]="url" [class.active]="isActive">{{ label }}</a>
<input [value]="name()" [disabled]="busy()" />

<!-- events (delegated on the client); $event is in scope -->
<button (click)="inc()">+</button>
<input (input)="search.set($event.target.value)" />
<form (keyup.control.enter)="submit()"></form>

<!-- block-scoped local -->
@let total = a + b;

<!-- custom components / islands resolve by folder name -->
<counter></counter>
```

Notes:

- **String literals in expressions use single quotes** (`controlType(c) === 'select'`) —
  double quotes inside `{{ }}` / `@if` / `@for` are a grammar error. Keep large literal
  arrays in `logic.ts` and iterate them.
- Pipes: `number`, `percent`, `currency`, `date`, `titlecase`, `i18nPlural`, … with
  multi-arg syntax `value | slice:1:3`.
- `<router-outlet></router-outlet>` (in the shell) is replaced with the matched page.
- Keep templates "dumb": compute filtered/grouped view-models in `logic.ts`/`resolve.ts`
  with `computed(...)` and iterate plain arrays.

---

## Islands & hydration

An island is a folder with a `logic.ts` whose default export is a `defineComponent(...)`.
The `setup` function returns the reactive scope the template reads.

```ts
// shared-components/counter/logic.ts
import { defineComponent, signal } from "@mrg-keystone/sprig";

export default defineComponent({
  trigger: "visible",          // "load" (default) | "idle" | "visible" | "interaction"
  inputs: ["start"],           // names bound via <counter [start]="3">
  setup: (ctx) => {
    const start = ctx.input<number>("start", 0);
    const count = signal(start());
    const inc = () => count.set(count() + 1);
    const dec = () => count.set(Math.max(0, count() - 1));
    return { count, inc, dec };
  },
});
```

```html
<!-- shared-components/counter/template.html -->
<div class="counter">
  <button (click)="dec()" [disabled]="count() <= 0">−</button>
  <output>{{ count() }}</output>
  <button (click)="inc()">+</button>
</div>
```

Reactivity primitives (from `@mrg-keystone/sprig`):

- `signal(initial)` → a callable accessor: read `count()`, write `count.set(v)`.
- `computed(() => …)` → derived, read-only accessor.
- `effect(() => …)` → re-runs when its reads change (client-side).

`ctx.input(name, fallback)`, `ctx.output(name)`, `ctx.model(name, fallback)` bridge
component inputs/outputs.

**`setup()` runs on BOTH the server (initial SSR paint) and the client (hydration).**
Guard browser-only side effects:

```ts
if (typeof document !== "undefined") {
  addEventListener("keydown", onKey);   // client only
}
```

The client re-renders the island reactively, morphing the DOM in place (focus/scroll/caret
are preserved), and delegates `(event)` bindings on the island root.

---

## Data & services (DI)

A page's `resolve.ts` runs on the server inside a request-scoped injector and returns the
template's inputs:

```ts
// pages/board/resolve.ts
import { inject, type Resolve } from "@mrg-keystone/sprig";
import { BoardService } from "../../services/board/mod.ts";

export const resolve: Resolve = async () => {
  const board = inject(BoardService);   // sync DI — call before the first await
  return { board: await board.board() };
};
```

Services are `@Injectable` classes. The built-in `Backend` token is the in-process keep
client (SSR only — DI never crosses the wire):

```ts
import { Backend, inject, Injectable, currentInjector, setResponseStatus } from "@mrg-keystone/sprig";

@Injectable({ scope: "server" })       // "server" | "client" | "both"
export class BoardService {
  #be = inject(Backend);
  #req = currentInjector();

  async issue(id: string) {
    const { ok, data } = await this.#be.get("/http/issue", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ issueId: id }),
    });
    if (!ok || data == null) setResponseStatus(this.#req, 404); // map missing → 404
    return data ?? null;
  }
}
```

On the client, islands fetch over the network channel instead:
`fetch("/api/http/<endpoint>", { method: "POST", body })`.

---

## View encapsulation

Each component's `styles.css` is scoped to that component's markup: sprig adds a unique
attribute (derived from the folder path) to the component's elements and to the rightmost
compound of every selector. So `.card h3 { }` only matches *this* component's `.card h3`.

- Use `:global(...)` to escape encapsulation for document-level rules:
  ```css
  :global(body) { margin: 0; }
  :global(:root) { --accent: #c2410c; }
  ```
- `@keyframes`, unknown at-rules, and `:global` are left unscoped.
- Tailwind `@apply` works in component `styles.css` (the build runs Tailwind).
- The scope id is the same across SSR, the scoped `app.css`, and client hydration — so
  styles survive hydration.

---

## Routing

```ts
// src/main.ts
import { bootstrap, defineRoutes, type Route, type SprigApp } from "@mrg-keystone/sprig";
import { createRenderer } from "<framework>/.sprig/compiler/mod.ts";
import { resolve as boardResolve } from "./pages/board/resolve.ts";

export const routes: Route[] = defineRoutes([
  { path: "", load: "./pages/dashboard" },
  { path: "board", load: "./pages/board" },
  { path: "issues/:id", load: "./pages/issue" },   // :id → ctx.params.id, URL-decoded
]);

export const renderer = await createRenderer(
  new URL("./", import.meta.url).pathname,           // the src dir to scan
  "/ui",                                              // base path
  { dev: !!Deno.env.get("SPRIG_DEV") },
);

export const app: SprigApp = bootstrap({
  routes,
  base: "/ui",
  modules: { "./pages/board": { resolve: boardResolve } },
  render: (load, inputs) => renderer.renderDocument(load, inputs),
});
```

`resolve` receives `{ params, url }`. The app's `fetch` 404s off-base paths, gates the HTTP
method (GET/HEAD/OPTIONS), runs the matched route's guards, honours a resolver-set status
(e.g. 404), and sets security + cache headers. Client-side, same-origin navigations are
soft-nav'd (the outlet is swapped, outside islands persist).

### Route guards

```ts
import { type Guard, inject } from "@mrg-keystone/sprig";

const requireAuth: Guard = (ctx) => {
  if (!inject(Session).user) return ["login"];   // → 302 <base>/login
  return ctx.path;                               // same route → proceed
};

// in defineRoutes: a parent's guards protect its whole subtree
{ path: "admin", load: "./pages/admin", guards: [requireAuth],
  children: [{ path: "users", load: "./pages/users" }] }
```

A guard returns **the route (as path segments) the navigation should go to**: `ctx.path` to
proceed, any other route to 302 there. Returned routes are app-relative — the framework
prefixes `base` onto the `Location`. The matched chain runs **parent-first, before
`resolve`** (a denied page does no data work); async guards are awaited; `inject()` works
synchronously inside (the same route injector `resolve` gets); a throwing guard is a
controlled 500. Complete runnable example: `fixtures/guarded-app`.

---

## The CLI

```
sprig init  [dir]              scaffold a minimal, runnable sprig app (default: .)
sprig dev   [appDir] [entry]   state-preserving HMR dev server (default: app, serve.ts)
sprig build [appDir]           code-split islands + scope CSS + Tailwind → static/ (default: app)
sprig serve [entry]            boot a serve.ts's default { fetch } handler (default: serve.ts)
```

`framework/cli.ts` is the entry (`deno run -A framework/cli.ts <cmd>`; or `deno task sprig`
in this repo). `dev` builds the bundle — the **same bytes prod serves** (no dev variant) —
and runs a watcher + SSE channel: editing a `template.html` or `styles.css` hot-swaps it
**with island state preserved** (no full reload, no Vite); editing `logic.ts`/server code
rebuilds and reloads.

---

## Hosting

`serveSprig` is the one-origin composition root:

```ts
// serve.ts
import { serveSprig } from "@mrg-keystone/sprig/keep";
import { api } from "./server/bootstrap/mod.ts"; // a keep backend ({ backend, handler })
import { app } from "./app/src/main.ts";

export default serveSprig({ keep: api, app, base: "/ui" });
//   deno serve -A --unstable-kv serve.ts   →   http://localhost:8000/ui
```

Dispatch:

| path | handler |
|---|---|
| `/api/*` | keep network handler (token-gated), prefix stripped |
| `/docs*` | keep Swagger UI |
| `<base>/_assets/*` | built static files (`client.js`, `isl.*.js`, `app.css`) with ETag/immutable cache |
| `<base>/*` | the sprig SSR app, with the in-process `Backend` threaded in |

The gateway also hardens `/api/*`: it rejects forbidden methods, oversized or
over-nested JSON bodies, and malformed bodies with `4xx` (not `5xx`). A starter app with no
backend can pass a no-op `keep` (see what `sprig init` scaffolds).

The build writes `static/{client.js, isl.<sel>.js, chunk-*.js, app.css}` plus a server-only
`templates.json` (prebuilt ASTs so the SSR skips tree-sitter). There is no manifest — the
cache-buster `v` is the content hash of `static/`, which the renderer recomputes on demand.

---

## Testing

- **Unit** (compiler/interpreter/CSS): import the functions directly — see
  `framework/.sprig/compiler/compiler.test.ts` (`parseTemplate`, `evalExpr`, `renderNodes`,
  `scopeCss`, …).
- **SSR / HTTP**: `import handler from "./serve.ts"` and drive `handler.fetch(new Request(...))`
  — see `app/spine.test.ts`.
- **Browser hydration**: drive the served app with Playwright (real DOM focus/observer/
  soft-nav behaviours that can't be seen at a smaller seam).

```bash
deno test -A framework/.sprig/compiler/compiler.test.ts
deno test -A app/spine.test.ts
```
