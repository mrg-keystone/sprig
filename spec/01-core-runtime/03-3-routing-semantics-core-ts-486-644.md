## 3. Routing semantics (core.ts:486-644)

Route shape:

```ts
interface Route {
  path: string;            // segment pattern: static | :param | :name+ | :name* (below)
  load?: string;            // module id; routers/* ⇒ isLayoutLoad (see Layouts)
  children?: Route[];       // nested routes, matched against the remaining path
  guards?: Guard[];         // see Guards vs. Grants
  meta?: RouteMeta;         // { nav?; icon?; title?; [key: string]: unknown } — §1
  requiredGrant?: string;   // see Guards vs. Grants
}

type Guard = (ctx: GuardCtx) => string[] | Promise<string[]>;
```

- **Layouts:** `isLayoutLoad(load)` ⇔ `load.startsWith("routers/")`. A `routers/*` load
  wraps children in its own `<router-outlet>` and joins the matched `chain`
  (OUTER→INNER); a plain page-parent renders itself at its base and does **not** wrap
  children (back-compat, pinned routing-chain.test.ts:92-100). Authored `<router-outlet>`
  renders as `<sprig-outlet data-level>`, `data-level` set to the matched level's `load`
  string (soft-nav walks this chain by `data-level`, spec 03
  [§7](../03-islands-and-hydration/07-7-soft-navigation-hydrate-ts-500-727.md)).
- **Matching (`matchRoute`):** each path segment matches against one of four segment
  kinds:

  | kind | pattern | segments matched | capture | decoded? | terminal? |
  |---|---|---|---|---|---|
  | `static` | a literal segment (e.g. `admin`) | exactly 1, exact string match | none | n/a | no |
  | `:param` | `:name` | exactly 1 | that one segment → `params[name]` | **yes** — percent-decoded | no |
  | `:name+` | rest param | **≥1** (the remainder) | remaining segments, incl. slashes, → `params[name]` | yes | **yes** |
  | `:name*` | rest param | **0 or more** (the remainder — may match zero segments) | remaining segments, incl. slashes, → `params[name]` (`""` when it matches zero) | yes | **yes** |

  Params are stored decoded; `ctx.path` itself (the raw request segments a guard sees on
  `GuardCtx`) stays undecoded — the two never share a representation. "Terminal" means
  the segment consumes the rest of the path: nothing below a rest param can match.
  Guard/grant chains collected **parent-first with fresh arrays per level** (no sibling
  leak — guards.test.ts:233-258). Layout with fully-consumed path descends into its index
  child (`path:""`). Pure container with nothing renderable → `null`.

  **Sibling priority:** when more than one child could match the same remaining path,
  `walk` tries children **in declaration order and returns the first one whose subtree
  yields a renderable chain** — first-match-wins. There is no static-before-dynamic
  preference: a `:param` child declared before a static sibling matches first, full
  stop. The same rule resolves the index-child-vs-catch-all collision — when a layout's
  path is fully consumed and both a `path:""` index child and a `:rest*` child could
  match the (empty) remainder, whichever is declared first among the children wins.
  Route authors must order children deliberately; there is no other tiebreak.

  A worked trace — given the tree

  ```ts
  const routes: Route[] = [
    {
      path: "app",
      load: "routers/app",
      guards: [requireSession],
      children: [
        { path: "projects/:id", load: "pages/project" },
        {
          path: "admin",
          load: "routers/admin",
          requiredGrant: "admin",
          children: [{ path: "users", load: "pages/admin-users" }],
        },
      ],
    },
  ];
  ```

  a request for `/app/projects/42` matches the `routers/app` → `projects/:id` branch and
  `matchRoute` returns a `MatchedRoute` (`chain: MatchedLevel[]`, each level `{load,
  meta?}`; top-level `load` is the last chain level's `load`):

  ```ts
  {
    chain: [{ load: "routers/app" }, { load: "pages/project" }],  // OUTER → INNER
    load: "pages/project",                      // last chain level's load
    params: { id: "42" },                       // decoded
    guards: [requireSession],                   // parent-first; the leaf and the
                                                  // sibling admin branch contribute nothing
    grants: [],                                  // "admin" never enters this chain
  }
  ```

  A request for `/app/admin/users` instead yields `chain: [{load: "routers/app"},
  {load: "routers/admin"}, {load: "pages/admin-users"}]`, `load: "pages/admin-users"`,
  `guards: [requireSession]`, and `grants: ["admin"]` — the sibling `requiredGrant` only
  appears once the matched path actually descends through the route that declares it (no
  sibling leak, guards.test.ts:233-258).
- **Guards vs. Grants:**

  | | Guards | Grants |
  |---|---|---|
  | Signature | `(ctx: GuardCtx) => string[] \| Promise<string[]>` — returns the target route as path segments | `config.verifyGrant(grant, gctx): boolean \| Promise<boolean>` (core.ts:679) — verifies one collected `requiredGrant` string |
  | Runs when | Parent-first; bootstrap step 5 — before grants and resolve | Parent-first; bootstrap step 6 — AFTER guards, BEFORE resolve (must stay in bootstrap: `ResolveCtx` has no headers) |
  | Context object | `GuardCtx`, one own `runInInjector(routeInjector, …)` per guard | The SAME `GuardCtx` object (`gctx`) the guards received, one own `runInInjector(routeInjector, …)` per grant check (core.ts:769-784) |
  | Pass condition | Returned array is VALUE-equal to the request path (core.ts:748-752): each side normalized — split on `/`, empties dropped, `[]` ≡ root — then joined and string-compared; any equal-valued route (a rebuilt `[...ctx.path]`, `["a/b"]` ≡ `["a","b"]`) proceeds | Truthy return, sync or awaited |
  | Deny → redirect | 302 to `${base}/${out.join("/")}` — the SAME normalized segments that fed the comparison — + `cache-control: no-store` | 302 to `config.grantDenied ?? ["login"]` (normalized the same way, base-prefixed) + `cache-control: no-store` — the SAME two headers as the guard redirect |
  | Throw behavior | Fails CLOSED → controlled 500 (shape below) | Fails CLOSED → controlled 500, same shape as a throwing guard's |
  | Mechanism absent | N/A — a route with no `guards` simply proceeds | `config.verifyGrant` ABSENT → the whole step is SKIPPED: `requiredGrant` routes render **unverified** (core.ts:769). This is the highest-consequence divergence from guards: an absent guard set means nothing to enforce, but an absent `verifyGrant` silently drops enforcement for routes that declared one |

  Guards run parent-first with fresh arrays per level (no sibling leak —
  guards.test.ts:233-258); each guard's `runInInjector` gives it a synchronous
  `inject()` window even after a prior guard awaited, and the same route injector is
  later shared with resolve (same service instance — guards.test.ts:110-127). First
  divergent guard wins. A throwing guard's controlled 500: body `"Internal Server
  Error"`, headers `ssrHeaders()` (core.ts:761) — no `Location`, no extra headers; every
  other controlled-500 site in this document produces the same shape
  ([§4](04-4-bootstrap-request-pipeline-core-ts-709-850.md) owns the full inventory).
  Guards see request `headers` (cookie auth) and `session` (from `env.session`); `requiredGrant`
  is collected parent-first the same way guards are.
- **Nav:** `buildNav(routes, activePath, base)` derives `NavItem[]` from `meta.nav` —
  "the nav IS the router". A route with `meta.nav` set becomes one `NavItem`: its
  `label` is `meta.nav`'s string value verbatim, `icon` is `meta.icon`. Active = exact or
  prefix-with-`/` match; index href collapses to `base + "/"`.

