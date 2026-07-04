<sub>[← sprig docs](./README.md)</sub>

# Routing

Routes map URL paths to pages. The app is assembled in `main.ts` from three pieces: a route
table (`defineRoutes`), an SSR renderer (`createRenderer`), and `bootstrap`.

## Defining routes

```ts
// src/main.ts
import { bootstrap, defineRoutes, type Route, type SprigApp } from "@mrg-keystone/sprig";
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

## Guards

A guard is a function that returns **the route the navigation should go to**, as an array of
path segments. Returning the route it was about to hit anyway (`ctx.path`) lets the
navigation proceed; returning any other route answers the request with a **302 redirect**
there instead (bare path, prefixed with `base`). Guards attach to routes; a parent's guards
protect its whole subtree.

```ts
import { defineRoutes, type Guard, inject } from "@mrg-keystone/sprig";
import { Session } from "./services/session.ts";

const requireAuth: Guard = (ctx) => {
  const session = inject(Session);       // DI — the same route injector resolve() gets
  if (!session.user) return ["login"];   // → 302 /login
  return ctx.path;                       // same route → proceed
};

export const routes = defineRoutes([
  { path: "login", load: "./pages/login" },
  {
    path: "admin",
    load: "./pages/admin",
    guards: [requireAuth],               // protects /admin AND /admin/users
    children: [{ path: "users", load: "./pages/users" }],
  },
]);
```

- **Contract:** `(ctx: GuardCtx) => string[] | Promise<string[]>` with `ctx = { path, params,
  url, headers }`. `ctx.path` is the target's post-base segments exactly as they appear in the
  URL (undecoded, so returning it round-trips); `ctx.params` are the decoded `:param` captures;
  `ctx.headers` are the incoming request's headers — page navigations carry the browser's
  cookies there, which is what a server-side login guard checks (a marker cookie; an
  `Authorization` header never accompanies a document navigation).
- **Normalization:** returned elements may carry `/` separators and empty segments are
  dropped — `["admin","users"]` ≡ `["admin/users"]`; `[]` means the root route.
- **Order:** the matched chain's guards run **parent-first** (a route's own guards last),
  each awaited; the first guard whose route differs from the target wins. All-pass → the
  page renders.
- **Before `resolve`:** guards run first, so a denied page does no data work.
- **DI:** call `inject()` synchronously (before any `await`), exactly like in `resolve` —
  guards run on the request's route injector, so a service a guard instantiates is the SAME
  instance the page's `resolve` later injects.
- **Failure:** a throwing guard is a controlled **500** (fails closed).
- **Client:** a soft-nav that hits a guard redirect falls back to a full navigation
  (redirected responses are deliberately not soft-swapped), so the browser lands on the
  redirect target normally — no client-side guard wiring needed.
- **Complete example:** [`fixtures/guarded-app`](../../fixtures/guarded-app/) — a login
  flow, subtree inheritance, an async admin check, and guard-only "action" routes.

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
- **Guards:** the matched chain's guards run next (parent-first, before `resolve`); the first
  guard returning a route other than the target → **302** to it (on-base). A throwing
  guard → 500.
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
