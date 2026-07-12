# Routing & data loading

Routes are an explicit table, not filesystem magic. Each route's `load` names a **page
folder** under `src`; the framework renders that folder's `template.html` and auto-loads
its data.

```ts
// src/main.ts
import { bootstrap, defineRoutes } from "@mrg-keystone/sprig";
import { createRenderer } from "@mrg-keystone/sprig/keep";
import { dirname, fromFileUrl } from "@std/path";

export const routes = defineRoutes([
  { path: "", load: "pages/home" },           // /ui
  { path: "users/:id", load: "pages/user" },  // /ui/users/:id
]);

export const renderer = await createRenderer(dirname(fromFileUrl(import.meta.url)), "/ui", {
  dev: !!Deno.env.get("SPRIG_DEV"),
});
export const app = bootstrap({ routes, base: "/ui", renderer });
```

- `path` is relative to the app `base` (`"/ui"` here). `:param` segments are dynamic.
- `load` is the page folder path (relative to `src`): `"pages/home"`. Its basename is the
  page selector; its `template.html` is the view.
- **`bootstrap({ routes, base, renderer })` is the only wiring.** The `renderer` (from
  `createRenderer`) provides rendering AND auto-loads each page's data — there is **no
  `modules: {}` map and no per-page import**.

## Loading a page's data

Two ways, both auto-discovered by the route's `load` — you don't register either:

1. **The page's `logic.ts` class** (preferred). `onServerInit` runs on the server before
   render; set fields and the template binds to them. It's also the page's client behavior
   (the page hydrates as a root island). See `references/component-model.md`.

   ```ts
   // pages/user/logic.ts
   import { inject, Backend } from "@mrg-keystone/sprig";
   export default class User {
     user: { name: string } | null = null;
     async onServerInit() {
       // route params + the in-process Backend are available here
       this.user = await inject(Backend).fetch("/users/123").then((r) => r.json());
     }
   }
   ```

2. **A `resolve.ts`** — a function returning the page's data (a lighter alternative when the
   page needs no client behavior):

   ```ts
   // pages/home/resolve.ts
   import type { Resolve } from "@mrg-keystone/sprig";
   export const resolve: Resolve = ({ params, url }) => ({ name: "sprig" });
   ```

   **The full `ResolveCtx` contract** (this is everything — never excavate the framework
   source or the Deno cache for more; a measured fleet burned 112 tool calls doing that):
   - `ctx.params: Record<string, string>` — the matched route params (`:id` → `params.id`).
   - `ctx.url: URL` — the request URL; query via `url.searchParams`.
   - **Deliberately NO `headers` and NO `session`.** Cookies/session are unreadable inside
     `resolve` — that's the documented SSR-data-leak guard. Auth checks belong in guards /
     per-route `grants`; a page whose DATA needs the session profile uses
     `logic.ts onServerLoad(ctx: RouteCtx)` instead, where
     `RouteCtx = { url, params, session: SessionProfile | null }` — the resolve twin
     widened with the session.
   - **Return** `Record<string, unknown>` (sync or a Promise). The returned object becomes
     the template's inputs, exactly like `logic.ts` fields; values crossing into an island
     must be serializable.
   - **DI:** `resolve` runs inside the request's route injector (shared with the guard
     chain) — `inject(Backend)` etc. work, but only SYNCHRONOUSLY (before any `await`),
     the same rule as components.
   - **Errors:** a throwing `resolve` → controlled **500** (fails closed). A matched route
     whose RESOURCE is missing is not a throw: capture the injector synchronously and set
     the status —
     ```ts
     import { currentInjector, setResponseStatus } from "@mrg-keystone/sprig";
     export const resolve: Resolve = async ({ params }) => {
       const inj = currentInjector();            // capture BEFORE any await
       const org = await inject(Backend).fetch(`/orgs/${params.id}`).then(r => r.ok ? r.json() : null);
       if (!org) setResponseStatus(inj, 404);    // SSR response line carries the 404
       return { org };
     };
     ```

A page folder with neither just renders its `template.html` statically.

## Guards

A guard returns **the route the navigation should go to** as path segments: return `ctx.path`
(the target route) to proceed, any other route to answer with a **302** there (on-base bare
path). Attach via `guards: [...]` on a route — a parent's guards protect its whole subtree
(chain runs parent-first, before `resolve`, so a denied page does no data work).

```ts
import { type Guard, inject } from "@mrg-keystone/sprig";

const requireAuth: Guard = (ctx) => {
  if (!inject(Session).user) return ["login"];  // → 302 /login
  return ctx.path;                              // same route → proceed
};

export const routes = defineRoutes([
  { path: "login", load: "pages/login" },
  { path: "admin", load: "pages/admin", guards: [requireAuth], // + all children
    children: [{ path: "users", load: "pages/users" }] },
]);
```

- `ctx = { path, params, url, headers }` (headers = the request’s — cookies live there, the
  basis for a login guard); async guards fine; call `inject()` synchronously (before any
  `await`) — guards share the request's route injector with `resolve`.
- Returned segments normalize (`["admin/users"]` ≡ `["admin","users"]`; `[]` = root). First
  divergent guard wins; a throwing guard → controlled 500 (fails closed).
- Returned routes are APP-RELATIVE (`["login"]`, never `["ui","login"]`) — the framework
  prefixes `base` onto the redirect Location.
- Client soft-nav falls back to a full navigation on redirects — no client wiring needed.
- Complete runnable example: `fixtures/guarded-app` in the sprig repo (login flow, subtree
  inheritance, async admin check, guard-only "action" routes).

## The render output

`createRenderer(srcRoot, base, opts)` scans `srcRoot` for every folder-component (registers
them by selector), reads the prebuilt template registry (`static/templates.json`, produced
by `sprig build` — so the production runtime never loads tree-sitter), and renders a matched
page into the shell's `<router-outlet>`. `bootstrap` returns a `SprigApp` with a
`fetch(req, info, env?)` handler.
