# sprig example app

A worked example of the **folder-component** model: Angular-flavoured DX (components, DI,
`<router-outlet>`) on the static-HTML + island-hydration stack from
[`../../list.md`](../../list.md). Templates are the same Angular syntax the
[`tree-sitter-angular-template`](../../tree-sitter-angular-template) grammar parses.

## A component is a folder

| File | Required | Effect |
|------|----------|--------|
| `template.html` | ✅ | the view — Angular syntax, compiled to Preact |
| `logic.ts` | — | **presence makes it an island** (hydrated); default-exports `defineComponent(setup)` |
| `styles.css` | — | folder styles — **global-by-convention** (BEM), see note below |
| `resolve.ts` | — | *(pages)* runs on the **server** with DI; its return value is the page's `@input`s |

A route references a component by its **folder path** (e.g. `"./shell/components/user"`), never a
single file — the folder *is* the component (`template.html` is just one file in it). The build
instruments that string: discovers the folder's files, compiles them, and wires lazy loading.

- **`template.html` only, no free names → STATIC.** Pure server-rendered HTML, **zero** JS.
  (`shared-components/site-nav`, `shell/components/about`.)
- **`template.html` only, reads free names → STATIC + PARAMETRIZED.** The free identifiers its
  `{{ }}` / `[bindings]` read become **implied `@input`s** — no `logic.ts` needed. Still zero
  client JS; the parent fills the inputs at SSR. (`shared-components/user-badge` → implied
  inputs `name`, `bio`.)
- **`template.html` + `logic.ts` → ISLAND.** SSR'd for first paint, wrapped in `<is-land>`,
  then hydrated. (`shared-components/counter`, `shell/components/board/components/detail`.)

A `logic.ts` is only needed for local state (signals), event handlers/methods, injected deps,
or explicit typed inputs — a purely presentational component goes without. The implied inputs
are inferred from the template AST:

```sh
cd ../../tree-sitter-angular-template
deno run -A scripts/implied-inputs.ts ../fixtures/app/src/shared-components/user-badge/template.html
# → { "inputs": ["bio", "name"], "requiresLogic": false }
```

`requiresLogic` is `true` when the template has `(event)` / `[(two-way)]` bindings or method
calls — interactivity that can't be static, so a `logic.ts` is required.

The **folder name is the selector**: `counter/` → `<counter>`, `site-nav/` → `<site-nav>`.
A name **must not** equal a native HTML element (the compiler errors if it does); a hyphen is
recommended. Tag resolution order: **local `components/` → `shared-components/` → built-ins
(`router-outlet`) → native HTML passthrough**.

> **Styles.** `styles.css` is bundled and applied **globally** — scope it yourself with BEM
> (as the example does). True per-component scoping needs either a CSS-modules esbuild plugin
> (off the `deno bundle` path, see `list.md`) or moving styles into a goober `` css`…` ``
> literal in `logic.ts`. goober does **not** scope external `.css` files.

## Where folders live

Every folder-component has the **same shape** — `template.html` (+ optional `logic.ts` /
`styles.css` / `resolve.ts`) — and **any** component may hold a `components/` subfolder of child
folder-components. That nesting is **uniform and recursive**, to any depth, no matter how a child
is referenced — by **tag** (`<kpi-tile>` in a template) or by **route** (a named-outlet target in
`main.ts`). Both kinds of child live under their parent's `components/`.

There is **no special "layout"** and **no special `pages/` directory**. A layout is just the
*root component* — the route at `path: ""` whose `<router-outlet>` hosts the matched page. And
since a route's children are filed under their parent's `components/` like any other child, the
pages simply **are** the shell's `components/`. The whole app is therefore **one recursive
folder-component tree** rooted at `shell/`, plus two cross-cutting registries (`shared-components/`
for tag components used across the tree, and `services/` for DI providers):

```
src/
  shell/                      the ROOT component (the route at path ""): <site-nav> +
                              <router-outlet> + <toast-host>. Was "the layout".
    components/               the routed pages — the shell's route-children
      dashboard/  board/  issue/  user/  about/  docs/  settings/  landing/
        components/           …each page nests its own components/, recursively
  shared-components/          tag components used across the tree (site-nav, counter, tag-chip, …)
  services/<name>/            one @Injectable per folder (mod.ts + colocated test.ts)
  main.ts                     route table + bootstrap
```

`about` shows the recursion end-to-end — a four-level chain, every level the same folder-component
shape, tag-resolved through each component's own `components/` first:

```
shell/components/about/                                         <about>
  components/our-story/                                         <our-story>
    components/milestone/                                       <milestone>
      components/year-badge/                                    <year-badge>
```

Named-outlet route targets are children too, so they sit under their parent's `components/`
beside its tag components — e.g. `board/components/detail` (the `detail=:id` outlet),
`board/components/panel-filters` (the `panel=filters` outlet), and `board/components/kanban-column`
(used by the `<kanban-column>` tag). `main.ts` just names the folder by path:
`load: "./shell/components/board/components/detail"`.

Template scope (islands): in `template.html`, signals returned by `defineComponent` are read
as `name()` and methods called as `fn()` — e.g. `{{ count() }}`, `(click)="inc()"`.

## Dependency injection

`@Injectable({ scope })` registers a service; `inject(Service)` resolves it from the active
injector (root → route → component). `providedIn: "root"` makes it a per-side singleton owned
by the root injector. The **`scope` is the SSR/island boundary**:

| scope | resolvable | example |
|-------|-----------|---------|
| `server` | SSR only | `UserService` (data), secrets, in-process keep backend |
| `client` | hydrated island only | DOM-only stores |
| `both` | each side, independent instance | `Logger`, `Router`, isomorphic logic |

**DI never crosses the wire — data does.** An island can only `inject()` `client`/`both`
services; server-only values reach it as serialized `@input`s — produced by a page's
server-side `resolve.ts` (see `shell/components/user`) and shipped via the island prop bridge. Injecting
a `server` service in island code throws (see `core.ts`).

- **Server:** a fresh request-scoped root injector per request (a danet middleware runs the
  request inside it via `runInInjector`). sprig keeps its **own** injector — it is not danet's
  container; the two coexist.
- **Client:** one document-level root injector (`clientRoot()`, e.g. `window.__sprig_root`).
  This requires `@sprig/core` + `providedIn:"root"` services to be emitted as **one shared
  chunk** that island bundles import (not duplicate), so client singletons are truly shared.

## Router & `<router-outlet>`

`main.ts` maps URLs to page folders; `<router-outlet>` (in the root `shell` component) marks where
the matched page renders. The outlet is a **reserved built-in**: it compiles to a real, persistent
boundary element the server always emits (with a stable selector) — the one exception to the
"component tags are replaced by their output" rule, because it must survive as the swap target.

- **Server is the sole renderer.** Match URL → render the shell with the page in the outlet →
  full HTML document.
- **Client soft-nav** (one model, not two): the Navigation API intercepts same-origin link
  clicks → `fetch(e.destination.url, { signal: e.signal })` → parse the document → replace
  **only** the outlet's `innerHTML` inside `document.startViewTransition()`. Islands **outside**
  the outlet (e.g. `<site-nav>`) stay mounted and keep state; islands inside re-arm on
  insertion. Guard the swap on `!e.signal.aborted` so a superseded nav can't mount the wrong
  page. Use `e.intercept({ scroll: "manual", … })` and restore scroll explicitly. Unsupported
  browsers fall back to a full navigation (cross-document `@view-transition`). A route's `load`
  is a **folder-path string** (`"./shell/components/user"`) the build instruments — a declarative
  route→folder mapping, not a function and not a client render path.
- `Router` (scope `both`, `providedIn:"root"`) exposes `url`/`params` signals + `navigate()`.
  A page inside the outlet is destroyed/recreated each soft-nav, so it reads its params **once**
  at (re)hydration via `@input` — `shell/components/user` gets `:id` from its `resolve.ts`, not by reading
  `Router.params` live. Live `params`/`url` reactivity is for persisted islands outside the outlet.

### Named outlets — the `=` URL scheme

The whole screen lives in the path, so it's deep-linkable and SSR-renderable:

```
/settings/main=question/sidebar=admin/    sidebar outlet = admin panel, main outlet = "question"
```

A route's `children` can fill **named** outlets — the outlet is baked into `path` with the **same
`=` syntax** the URL uses: `{ path: "sidebar=admin", load }`, `{ path: "main=:topic", load }`
(`shell/components/settings` declares `<router-outlet name="sidebar">` + `name="main"` + `name="panel"`; an explicit
`{ outlet, path }` is an equivalent alternative). `=` is the outlet delimiter in both the URL and
the route table — split on the first `=`, literal `=`→`%3D`, `/`→`%2F`. Outlet segments are
canonically **sorted**, so one screen = one URL. The value may be a `:param` (`main=question` →
`topic="question"`, the implied-input of the logic-less `main` panel). **Links are plain `<a href>`**
— no special API; imperative is `setOutlet`/`clearOutlet`.

There's **no special "outlet route" kind** — every entry is just a `Route` (`path`/`load`/`children`),
so `children` nests infinitely on both axes (a `panel=…` outlet inside a `sidebar=…` outlet inside a
page); `=` in a `path` is the only thing that makes it match a `name=value` segment instead of a primary one.

Engine + tests: `.sprig/router.ts`, `.sprig/router.test.ts` (`deno test`). Validate outlets vs
templates: `deno run -A scripts/check-outlets.ts`.

> Status: this is a spec-by-example. `.sprig/core.ts` is the runtime contract — the template
> compiler, per-island `deno bundle`, and keep SSR wiring (marked `STUB`) are the build
> pipeline described in `list.md`, not yet implemented here.
