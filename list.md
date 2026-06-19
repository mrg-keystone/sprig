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
