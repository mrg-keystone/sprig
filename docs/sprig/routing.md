<sub>[← sprig docs](./README.md)</sub>

# Routing

Routes map URL paths to pages. The app is assembled in `main.ts` from three pieces: a route
table (`defineRoutes`), an SSR renderer (`createRenderer`), and `bootstrap`.

## Defining routes

```ts
// src/main.ts
import { bootstrap, defineRoutes, type Route, type SprigApp } from "@sprig/core";
import { dirname, fromFileUrl } from "@std/path";
import { createRenderer, type SsrRenderer } from "../../framework/.sprig/compiler/mod.ts";
import { resolve as workbenchResolve } from "./pages/workbench/resolve.ts";
import { resolve as galleryResolve } from "./pages/gallery/resolve.ts";

export const routes: Route[] = defineRoutes([
  { path: "", load: "./pages/workbench" },          // index
  { path: "components", load: "./pages/gallery" },
  { path: "pages", load: "./pages/gallery" },
  { path: "issues/:id", load: "./pages/issue" },    // :id → ctx.params.id (URL-decoded)
]);

export const renderer: SsrRenderer = await createRenderer(
  dirname(fromFileUrl(import.meta.url)),             // the src dir to scan
  "/ui",                                             // base path
  { dev: !!Deno.env.get("SPRIG_DEV") },
);

export const app: SprigApp = bootstrap({
  routes,
  base: "/ui",
  modules: {
    "./pages/workbench": { resolve: workbenchResolve },
    "./pages/gallery": { resolve: galleryResolve },
  },
  render: (load, inputs) => renderer.renderDocument(load, inputs),
});
```

- `path` is matched segment-by-segment. A `:param` segment captures into `ctx.params` (and is
  **URL-decoded** — `%20` → space). Routes may nest via `children` for a primary child chain.
- `load` is the page folder key; it indexes both `modules` (its `resolve`) and the renderer
  (its `template.html`, resolved by folder basename).
- `base` mounts the whole app under a prefix (`/ui`). `createRenderer(srcDir, base, { dev })`
  scans `srcDir` for folder-components and builds the registry once at boot.

## Params in a resolver

```ts
export const resolve: Resolve = async (ctx) => {
  const issue = await inject(IssueService).issue(ctx.params.id);   // already decoded
  return { issue };
};
```

## The shell `<router-outlet>`

The matched page renders into the shell's `<router-outlet>`, which SSR emits as a persistent
**`<sprig-outlet>`** element. This is the soft-nav swap boundary — keep it in the shell.

```html
<!-- shell/template.html -->
<div class="app-root">
  <router-outlet></router-outlet>
</div>
```

## What `bootstrap().fetch` enforces

- **Off-base 404:** any path not under `base` (including a bare `/` when a base is set) returns
  404 — the index is only reachable on-base.
- **No route match → 404.**
- **Method gating:** SSR pages are read-only resources. `OPTIONS` → 204 (`Allow: GET, HEAD,
  OPTIONS`); anything other than `GET`/`HEAD` → 405.
- **Resolver-set status:** honored on the response line (e.g. `setResponseStatus(…, 404)` —
  see [data-and-di.md](./data-and-di.md)).
- **Hardening + cache headers** on every HTML response: `content-type: text/html`,
  `cache-control: no-store`, `x-content-type-options: nosniff`, `x-frame-options: DENY`,
  `referrer-policy: no-referrer`.
- A resolver/render failure becomes a controlled **500** (no internal text leaked).

## Soft navigation (client)

When the browser supports the **Navigation API**, same-origin links under `base` are
soft-navigated: sprig fetches the destination, parses it, and swaps **only the
`<sprig-outlet>`** innerHTML inside a view transition (when available). Islands **outside** the
outlet stay mounted (state preserved); islands inside are torn down and re-armed (their chunks
lazy-load again on trigger).

It deliberately falls back to a full browser navigation for: non-interceptable events,
hash-only changes, downloads, form posts, cross-origin or off-base targets, reloads, same-path
(query/hash-only) navigations, and any non-2xx / redirected / non-HTML response. Scroll is
restored on back/forward, scrolls to a `#fragment` target when present, else jumps to top.
Browsers without the Navigation API just do normal navigations.

---

**Next:** [cli.md](./cli.md) — the dev/build loop.
**See also:** [hosting.md](./hosting.md) · [data-and-di.md](./data-and-di.md)
