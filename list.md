# Stack list

Building islands hydration manually (server-rendered HTML + selective client hydration) without a full framework.

## Libraries

### Preact
- **What:** ~3 kB UI rendering library (React-compatible API). The view layer — components, virtual DOM, hooks, signals.
- **Role here:** renders the components, and provides `hydrate()` to wire up server-rendered DOM on the client.
- **Install (npm):** `npm i preact`
- **Install (Deno/JSR or import map):** `npm:preact`
- **Docs:** https://preactjs.com/

### @11ty/is-land
- **What:** Framework-agnostic partial-hydration web component (~1.79 kB, zero deps). Not coupled to any framework or SSG.
- **Role here:** the islands orchestration — hydrates a server-rendered region only when a condition fires, loading that region's JS lazily.
- **Loading conditions:** `on:visible`, `on:idle`, `on:interaction`, `on:media`.
- **Install (npm):** `npm i @11ty/is-land`
- **Docs / repo:** https://github.com/11ty/is-land

## Styling (scoped — no CSS leaks)

Two flavors, same split as Angular's "view encapsulation": **emulated** (hashed class names — global resets still apply) vs **Shadow DOM** (a hard boundary — nothing crosses, including your own globals).

### goober — emulated scoping (primary)
- **What:** <1 kB CSS-in-JS, styled-components-like API. Generates scoped class names → no leaking between components.
- **Fits the stack:** published on `deno.land/x/goober`; Preact integration (`setup(h)`); SSR via `extractCss()`. Runtime — needs no CSS build plugin, rides through `deno bundle` as plain JS.
- **Docs:** https://goober.js.org · https://github.com/cristianbote/goober

### Declarative Shadow DOM — true isolation (for hard boundaries)
- **What:** Browser-native; CSS cannot cross the shadow boundary either way. SSR-able with `<template shadowrootmode="open">` (styles inside, no JS needed for structure); Preact renders into it. Natural fit since islands are already custom elements.
- **When:** self-contained islands/widgets (esp. embedded third-party). **Caveat:** the boundary also blocks your *global* styles — opt back in via CSS custom properties (they pierce) or `::part()`.
- **Docs:** https://web.dev/articles/declarative-shadow-dom

### CSS Modules — emulated, plain `.css` (alternative)
- **What:** `Button.module.css`; class names hashed at build → scoped, no runtime.
- **Build:** needs a CSS-modules esbuild plugin (e.g. `esbuild-css-modules-plugin`, Lightning-CSS based) on the scripted-esbuild path — `deno bundle`'s CSS handling isn't built for module-scoping.

### Tailwind CSS v4 — utility-first (different approach, can coexist)
- **What:** atomic utility classes — sidesteps leaking by having *no* component stylesheets, just single-purpose globals. Alternative philosophy to goober/scoped CSS; pick one as primary (utilities for most, scoped CSS for complex components).
- **Zero-Node / no node_modules:** use the **v4 standalone CLI** (downloaded binary — no Node, npm, node_modules, or PostCSS). **Avoid `npm:tailwindcss`** — it pulls the Oxide Rust native binary → node_modules/native-addon friction in Deno.
- **Near zero-config in v4:** no `tailwind.config.js`; CSS-first (`@import "tailwindcss";` + `@theme`), automatic content detection (no `content: []`).
- **NOT a `deno bundle` step:** it's its own watcher (`tailwindcss -i input.css -o static/styles.css --watch`) → emits CSS served via `@std/http`, linked in `<head>`. Runs in parallel with `deno bundle` (JS), not through it.
- **Shadow DOM caveat:** the global utility sheet doesn't pierce shadow boundaries — inject it per shadow root if you encapsulate islands.
- **Don't use twind** (old Deno runtime-Tailwind): unmaintained, Deno-deprecated.
- **Docs:** https://tailwindcss.com/blog/standalone-cli · https://tailwindcss.com/docs/installation/tailwind-cli

## Server / Router

### keep (`@mrg-keystone/keep`)
- **What:** Opinionated Deno backend framework on top of danet (Nest-style). The HTTP server + router for the app. Backend-only — imposes nothing on rendering, so it sits cleanly under Preact + is-land.
- **Role here:** define all routes in `main.ts` via danet `@Controller`/`@Get` classes; page handlers render Preact → HTML string and return a `text/html` `Response`. Full-document responses keep cross-document view transitions working.
- **Route style:** decorator controllers registered through a `@Module` (no imperative `app.get()` — danet is class/decorator based). Controllers + `bootstrapServer` + `listen` can all live in one `main.ts`.
- **Pages vs APIs:** plain danet `@Get` for HTML pages; keep's `@Endpoint` controllers for JSON APIs (adds the cake/process tooling, Swagger, auth). Mix both in the same app.
- **SSR bonus:** in-process `backend.fetch(...)` loads data with no network hop and no token — ideal for server-rendering a page.
- **Run:** `await api.listen()` or `Deno.serve((req, info) => api.handler(req, info))` (forward `info`, or localhost trust + `/_mint` break).
- **Docs:** JSR `@mrg-keystone/keep`; danet — https://danet.land

## Component model (folder = component)

A component is a **folder** (worked example: `fixtures/app`).
- `template.html` (**required**) — the view, in Angular-flavoured syntax (`{{ }}`, `[prop]`, `(event)`, `@if/@for/@switch`). Parsed by the in-repo **`tree-sitter-angular-template`** grammar → AST → compiled to a Preact render function.
- `logic.ts` (**optional**) — its presence promotes the folder to an **island**. Needed only for local state (signals), event handlers/methods, injected deps, or explicit typed inputs — **a purely presentational component goes without one**. Default-exports `defineComponent({ inputs?, setup })`; `setup()` returns the template scope. In templates, both signals and computeds read as `name()` and methods call as `fn()` — so the runtime wraps signals in **callable accessors** (raw `@preact/signals` Signals aren't callable; `count.value`/`count.set()` still write).
- `styles.css` (**optional**) — **global-by-convention** (BEM). True scoping needs a CSS-modules esbuild plugin (off the `deno bundle` path, see Styling) or goober `` css`…` `` in `logic.ts` — goober does not scope external `.css` files.
- `resolve.ts` (**optional, pages**) — runs on the **server** inside the request injector (may `inject()` server services) and returns the page's `@input`s.

**Three kinds:**
- *template only, no free names* → **static**: pure server-rendered HTML, **zero** client JS.
- *template only, reads free names* → **static + parametrized**: the free identifiers its `{{ }}`/`[bindings]` read are **implied `@input`s** — no `logic.ts` needed. Still zero client JS; the parent fills them at SSR. Inferred from the template AST by `tree-sitter-angular-template/scripts/implied-inputs.ts` (`{{ name }} {{ bio }}` → inputs `["bio","name"]`). A template with `(event)`/`[(two-way)]`/method calls can't be static — the tool reports `requiresLogic: true`.
- *template + logic* → **island**: SSR'd for first paint, wrapped in `<is-land on:…>` with a JSON prop bridge, then hydrated by its own `deno bundle` chunk.

**Selector = folder name** (`counter/` → `<counter>`). The compiler swaps component tags for their rendered output; native HTML tags pass through. A name **must not** equal a native HTML element (compile error); hyphen recommended. Resolution order: local `components/` → `shared-components/` → built-ins (`router-outlet`) → native.
- **Inputs:** islands declare them explicitly (`inputs: [...]`) so the compiler can wire/validate parent bindings; static components have them **implied** (see above). `[x]="expr"` passes an evaluated expression, a plain `attr="…"` passes a string. **Outputs** `(x)` and two-way `[(x)]` (= `x` input + `xChange` output) bind via `ctx.output`/`ctx.model`.

**Compile/loader contract:** `template.html` is not consumed by plain `deno bundle` (a `.tsx` pipeline). The "island glue you own" (esbuild + `@luca/esbuild-deno-loader`, see below) parses `template.html` → Preact render fn, co-bundles sibling `logic.ts`/`styles.css`, and emits **one module per folder**.

**Referencing:** a route names a component by its **folder-path string** `load: "./shell/components/user"` — the folder *is* the component, `template.html` is just one file in it. The build instruments the string (discovers the files, compiles, lazy-loads); no per-route import function. (A layout isn't special — it's the **root component**, the route at `{ path: "", load: "./shell", children: [ …pages… ] }`, whose `<router-outlet>` hosts the matched page. Its route-children — the pages — file under its own `components/` like any child, so there is no separate `layout` field, and no special `layouts/` or `pages/` directory.)

**Layout:** one recursive folder-component tree — `src/shell/` (the root component) with the pages under `src/shell/components/<route>/` (each nesting its own `components/`, to any depth) — plus the cross-cutting `src/shared-components/`, `src/services/`, and `src/main.ts` (route table + bootstrap).

## Dependency injection

Angular-style DI. sprig keeps its **own** request-scoped injector (a danet middleware runs each request inside it via `runInInjector`) — it is *not* danet's container; the two coexist.
- `@Injectable({ scope, providedIn })` registers a service; `inject(Token)` resolves from the active injector. Hierarchy: **root → route → component**; `providedIn:"root"` is a per-side singleton instantiated **at** the root (not wherever first requested).
- **`scope` is the SSR/island boundary:** `server` (DB / secrets / in-process keep backend), `client` (DOM-only stores), `both` (isomorphic; an independent instance per side — e.g. `Logger`, `Router`).
- **DI never crosses the wire — data does.** An island may only inject `client`/`both` services; server-only values reach it as serialized **`@input`s**, produced by a page's `resolve.ts` and shipped via the island prop bridge (the JSON `<script>` glue below). Injecting a `server` token in island code throws.
- **Client root:** one document-level injector (`clientRoot()`). This requires `@sprig/core` + `providedIn:"root"` services to be emitted as **one shared chunk** islands import (not duplicated per island) — otherwise each per-island bundle gets its own registry/root and "singletons" diverge.

## Router & `<router-outlet>`

- `main.ts` maps URL → page **folder-path string** (`load: "./shell/components/user"`); the build instruments each into a lazy per-folder `deno bundle` chunk. `<router-outlet>` (in the root `shell` component) is a **reserved built-in**: it compiles to a real, persistent boundary element with a stable selector (the one exception to tag-swapping) so it can be the swap target.
- **Server is the sole renderer:** match URL → run each matched route's `resolve.ts` for `@input`s → render the matched route tree (root component → … → page) into its `<router-outlet>`s → full HTML document (keep handler).
- **Client soft-nav (one model):** the **Navigation API** (below) intercepts same-origin links → `fetch(e.destination.url, { signal: e.signal })` → parse → replace **only** the outlet's `innerHTML` inside `document.startViewTransition()`, guarded on `!e.signal.aborted`. Islands **outside** the outlet stay mounted (state preserved); islands inside re-arm on insertion. Use `e.intercept({ scroll: "manual" })` + explicit scroll restore. Unsupported → full-navigation fallback (cross-document `@view-transition`). A route's `load` is a declarative folder-path string the build instruments — not a function, not a client render path.
- `Router` (scope `both`, `providedIn:"root"`) exposes `url`/`params` signals + `navigate()`. A page inside the outlet is recreated each soft-nav, so it reads params **once** at (re)hydration via `@input` (e.g. `/users/:id` → `resolve.ts`); live `params`/`url` reactivity is for persisted islands outside the outlet.

### Named outlets & the URL scheme

The whole screen lives in the path, so every view is deep-linkable + SSR-renderable:

```
/settings/main=question/sidebar=admin/
 └ plain segments → the PRIMARY route chain
          └ `name=value` segments → NAMED outlets (which <router-outlet name="…"> shows what)
```

- **`=` is the outlet delimiter in BOTH the URL and the route table** (joining `/` and `:` as reserved). A path segment containing `=` is a `name=value` outlet assignment; split on the **first** `=`. A literal `=` in a value is `%3D`, a `/` is `%2F` (an outlet value is one segment in v1). (Browsers treat `=` as an ordinary path char — verified — so this is free.)
- **Canonical form** sorts outlet segments by name → one screen ⇒ one URL (cache / equality / back-forward safe).
- **Route table — it's all just routes.** There is no special "outlet route" kind: every entry is a `Route` (`path` / `load` / `children`); whether it matches a primary segment or a `name=value` outlet segment is just whether its `path` contains `=` — `{ path: "users/:id", load }` vs `{ path: "sidebar=admin", load }`, `{ path: "main=:topic", load }` (an explicit `{ outlet: "sidebar", path: "admin" }` is an equivalent alternative). So `children` nests **infinitely on both axes** — a `panel=…` outlet inside a `sidebar=…` outlet inside a page, etc. Params inherit down; the value may be a `:param` (`main=question` matches `path: "main=:topic"` → `topic="question"`, an implied `@input` to a logic-less panel).
- **Links just work:** `<a href="/settings/main=question/sidebar=admin/">` *is* the whole navigation — no special link API. Imperative: `setOutlet`/`clearOutlet` build the next URL.
- **Per-outlet swap:** soft-nav diffs the parsed outlet sets, so changing one `=` segment swaps only that outlet's region; siblings/parents (and their island state) persist.
- **Engine + grammar-validated:** `.sprig/router.ts` (parse/serialize/match) + `.sprig/router.test.ts`; `scripts/check-outlets.ts` reads `<router-outlet name>` from each template (via the grammar) and verifies every `outlet:` route has a matching declared outlet.

## Browser APIs (no install)

### Cross-document View Transitions
- **What:** Built-in browser API that animates between **full page navigations** (the SSR/MPA case). Browser snapshots the old page, loads the new document, and animates between them. No JavaScript, no library.
- **Role here:** page transition animations for our server-rendered, full-navigation app — the SPA-feel without an SPA.
- **Opt in (CSS, on every participating page):**
  ```css
  @view-transition { navigation: auto; }
  ```
- **Shared-element morphs:** give an element the same `view-transition-name` on both pages:
  ```css
  .hero { view-transition-name: hero; }
  ```
- **Customize the animation** via pseudo-elements: `::view-transition-old(root)` / `::view-transition-new(root)`.
- **Constraints:** same-origin only; fires on push/replace/traverse navigations (not first load).
- **Browser support (June 2026):** Chrome/Edge 126+ ✅ · Safari 18.2+ ✅ · Firefox 🟡 in progress (behind flag). Degrades gracefully — unsupported browsers just do a normal instant navigation.
- **Gotcha:** transition waits for the next page to be ready, so slow pages feel laggy → prefetch with speculation rules.
- **Docs:** https://developer.chrome.com/docs/web-platform/view-transitions/cross-document · https://developer.mozilla.org/en-US/docs/Web/CSS/Reference/At-rules/@view-transition

### Partial navigation (Navigation API)
- **What:** Browser-native navigation interception. **Baseline (Newly Available) since Jan 2026** — Chrome, Edge, Firefox 147, Safari 26.2. Zero deps, no node_modules.
- **Role here:** soft navigation — intercept a link click, `fetch` the next page, swap one region of the DOM **without a full reload**, so islands outside the swap stay alive (no re-hydrate; scroll, media, island state preserved).
- **Shape:**
  ```js
  navigation.addEventListener("navigate", (e) => {
    if (!e.canIntercept || e.hashChange || e.downloadRequest) return;
    e.intercept({
      async handler() {
        const html = await fetch(e.destination.url).then((r) => r.text());
        document.startViewTransition(() => {
          // swap the main region from `html`
        });
      },
    });
  });
  ```
- **View transitions:** intercepted navigations animate via **same-document** `document.startViewTransition()`; non-intercepted / unsupported ones fall back to the cross-document `@view-transition` rule. The two coexist.
- **Re-hydrate:** `<is-land>` is a custom element, so swapped-in islands generally upgrade and arm on insertion — confirm your loader handles dynamically-added nodes.
- **Degrades:** where unsupported (now rare), the link just does a normal full navigation — no breakage.
- **Alternative:** want declarative instead of hand-rolled? **htmx** `hx-boost` (JSR/esm.sh/vendored — no node_modules) does the same swap via attributes.
- **Docs:** https://developer.mozilla.org/en-US/docs/Web/API/Navigation_API · https://web.dev/blog/baseline-navigation-api

## Build, dev & assets (Deno-native — no node_modules)

> Key point: `npm:`/`jsr:` deps resolve into Deno's global cache (`DENO_DIR`), **not** a local `node_modules` — as long as `nodeModulesDir` stays off in `deno.json`. This is the whole reason for going Deno-native instead of Fresh's Vite path.

### `deno bundle` — the build pipeline
- **What:** Built into Deno since **2.4** (July 2025); esbuild under the hood, but nothing to install and **no node_modules**.
- **Covers:** TSX→browser JS, bundling, tree-shaking, minification, code-splitting, client *and* server targets, content-hashed filenames (asset fingerprinting).
- **Use:** `deno bundle --platform browser islands/Counter.tsx --outdir static/js` — per-island entry → hashed bundle.
- **React→Preact aliasing:** import map in `deno.json` — `"react": "npm:preact/compat"`, `"react-dom": "npm:preact/compat"`, plus `"jsxImportSource": "preact"` in compilerOptions.
- **Docs:** https://docs.deno.com/runtime/reference/bundling/

### esbuild + `@luca/esbuild-deno-loader` — when you need a build *script*
- **What:** Programmatic esbuild with Deno resolution (https:/npm:/jsr:/import maps). Use the **native** loader (reads Deno's global cache → no node_modules); avoid the **portable** loader (it requires a local node_modules for npm deps).
- **Why over `deno bundle`:** plugins, watch/incremental rebuilds, a dev server, fine-grained control over the island build.
- **Docs:** https://jsr.io/@luca/esbuild-deno-loader

### Dev loop
- **Server:** `deno run --watch` (or keep's `KEEP_DEV`) restarts on change.
- **Client:** `deno bundle --watch` / esbuild `context.watch()` rebuilds island bundles; add a tiny SSE/WebSocket live-reload snippet.
- **Honest gap:** rebuild + full reload, **not** state-preserving HMR. True island HMR is the one thing only Vite (i.e. Fresh) gives you.

### Static files + head — `@std/http`
- **Static serving:** `serveDir` / `serveFile` from `jsr:@std/http` (Deno std) — mount under keep or a route.
- **Cache-busting:** use the content-hashed filenames `deno bundle`/esbuild emit (no `asset()` helper needed).
- **Head management:** a Preact layout component rendering `<head>`; inject the right island `<script>`s from your build's output manifest.

### Island glue (the part you own)
- is-land is the *loader*; `deno bundle` is the *builder*. The missing middle — discover islands, serialize each island's props into a JSON `<script>`, emit the `<is-land>` wrapper pointing at the right hashed bundle — is a small build script + server render helper you write. No turnkey Deno-native tool.
- **References (Node-oriented — study, not drop-in):** `@barelyhuman/preact-island-plugins` (esbuild island plugin, `//@island lazy:0.2` syntax) and the `preact-islands-diy` starter.

## Notes
- The stack now covers the whole Fresh surface minus Vite/node_modules: keep = server HTML (Preact → string in a route handler) + routing; `deno bundle` = per-island JS; is-land = selective hydrate; Navigation API + view transitions = partial nav + animation; `@std/http` = static. The hand-written part is the island glue (prop serialization + `<is-land>` wrappers), the partial-nav swap, and a small dev live-reload.
- What you genuinely give up vs Fresh: state-preserving island **HMR**, and the zero-config "drop a .tsx in islands/ and it just works" ergonomics. Everything else is replaced.
- Cross-document view transitions are pure CSS and need no JS — best fit for the full-navigation SSR setup.
