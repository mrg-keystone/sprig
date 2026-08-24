## 4. bootstrap() request pipeline (core.ts:709-850)

`bootstrap(config) → { fetch(req, info?, env?) }` where
`env = { backend?, assetsVersion?, session? }` is supplied per request by the host
(keep's `serveSprig`).

The [§1](01-1-public-api-surface-all-of-mrg-keystone-sprig.md) bootstrap surface, in full
(core.ts:657-689):

```ts
interface AppRenderer {
  renderDocument(
    chain: string | readonly MatchedLevel[],
    inputs: Record<string, unknown>,
    ropts?: { assetsVersion?: string; reqCtx?: RouteCtx },
    chrome?: Record<string, unknown>,
  ): Promise<string>;
  renderStream?(
    chain: string | readonly MatchedLevel[],
    inputs: Record<string, unknown>,
    ropts?: { assetsVersion?: string; reqCtx?: RouteCtx },
    chrome?: Record<string, unknown>,
  ): ReadableStream<Uint8Array>;
  loadResolve?(pageLoad: string): Promise<Resolve | undefined>;
}

interface AppConfig {
  routes: Route[];
  base?: string;
  renderer?: AppRenderer;
  modules?: Record<string, ComponentModule>;
  render?: (
    pageLoad: string,
    inputs: Record<string, unknown>,
    ropts?: { assetsVersion?: string; reqCtx?: RouteCtx },
  ) => Promise<string>;
  renderStream?: (
    pageLoad: string,
    inputs: Record<string, unknown>,
    ropts?: { assetsVersion?: string; reqCtx?: RouteCtx },
  ) => ReadableStream<Uint8Array>;
  verifyGrant?: (grant: string, gctx: GuardCtx) => boolean | Promise<boolean>;
  grantDenied?: string[];
}

interface SprigApp {
  fetch(
    req: Request,
    info?: Deno.ServeHandlerInfo,
    env?: { backend?: BackendClient; assetsVersion?: string; session?: SessionProfile | null },
  ): Promise<Response>;
}
```

`AppConfig.render`/`renderStream`, together with `modules`, are the legacy trio —
[§10](10-10-refactor-targets-tensions-observed.md).1. They substitute for
`AppRenderer.renderDocument`/`renderStream` but take a single leaf `pageLoad` string
(`matched.load`) instead of the matched `chain`, and no `chrome` param — see step 10
below for how the two sources are prioritized against each other. `verifyGrant`/
`grantDenied` are specced in full at [§3](03-3-routing-semantics-core-ts-486-644.md)
Guards vs. Grants.

Pipeline order (each step's position is contract):
1. Base handling (core.ts:714-719): with a NON-empty `config.base`, an on-base path is
   stripped (`slice(base.length) || "/"`) and any off-base path — incl. bare `/` —
   404s: `new Response("Not Found", { status: 404 })` — body `"Not Found"`, NO headers
   at all (not `ssrHeaders()`: an off-base path is outside the app entirely, so none of
   the app's response-hardening headers apply — core.ts:719). With base `""` (the
   default) nothing is stripped and NOTHING is off-base: the raw path (incl. bare `/`)
   goes straight to matchRoute (`""` is a legitimate value, never "unset" — spec 03
   [§10](../03-islands-and-hydration/10-10-contract-checklist-for-a-refactor.md).15; the workbench serves `/` at base `""`).
2. `matchRoute` → 404 if null: the SAME response as step 1's — `new Response("Not
   Found", { status: 404 })`, body `"Not Found"`, no headers (core.ts:722).
3. Method gate: OPTIONS → 204 `allow: GET, HEAD, OPTIONS`; other non-GET/HEAD → 405
   `allow: GET, HEAD, OPTIONS` (body `"Method Not Allowed"`; same header/value as the
   OPTIONS 204). (Method gate runs BEFORE guards — guards.test.ts:199-212.)
4. Injectors: `root = new Injector("server","root")`; `env.backend` ⇒
   `root.provide(Backend, env.backend)`; `routeInjector = root.child("route")`.
5. Guards (see [§3](03-3-routing-semantics-core-ts-486-644.md)). 6. Grants (see [§3](03-3-routing-semantics-core-ts-486-644.md)).
7. Resolve: `resolveFn` starts as `config.modules?.[matched.load]?.resolve` (the legacy
   override, [§10](10-10-refactor-targets-tensions-observed.md).1). If that's absent, `matched.load` is set, and `renderer.loadResolve`
   is itself PRESENT, it is called: `resolveFn = await renderer.loadResolve(matched.load)`.
   If `renderer.loadResolve` is absent (it's optional on `AppRenderer`, §4 surface), this
   call is SKIPPED entirely — a missing `loadResolve` is never invoked and never throws.
   The two ways `resolveFn` can end up `undefined` — no `loadResolve` method, or a present
   `loadResolve` legitimately returning `undefined` for a page with no `resolve.ts` — are
   therefore indistinguishable and produce the SAME outcome: `if (resolveFn)` is skipped,
   `inputs` stays at its pre-initialized `{}`, and the request proceeds to render with
   empty inputs — no error, no 500. This is intentional and is the ONLY sanctioned
   contract for "this page has no resolve": a renderer's `loadResolve` returns `undefined`
   (never throws) for a resolve-less page, matching its `Promise<Resolve | undefined>`
   return type exactly. A controlled 500 happens only when something actually THROWS —
   `loadResolve` itself throwing (e.g. an import-time error loading `resolve.ts`), or the
   resolved `resolveFn` throwing during execution — both caught by the same
   controlled-500 handling. There is no other resolve-related failure mode.
8. Status: `root.status ?? 200` (the `setResponseStatus` channel).
9. Build `reqCtx: RouteCtx = { url, params, session: env?.session ?? null }`,
   `ropts = { assetsVersion, reqCtx }`, `chrome = { nav: buildNav(routes, path,
   base) }` (the renderer feeds `chrome` to layouts + the shell as their inputs — spec 02
   [§5](../02-template-compiler/06-5-mod-ts-registry-page-assembly-renderer.md)). `activePath` is `path` — the base-stripped path produced in
   step 1, NOT the full `url.pathname` — since `buildNav`'s internal `full` is built from
   route segments and is NOT itself base-prefixed ([§3](03-3-routing-semantics-core-ts-486-644.md) Nav); matching
   `url.pathname` against it would never find an active item under a non-empty
   `config.base`.
10. Render — the branch and its render source are both resolved by fixed priority,
    independent of whether a `renderer` is configured at all:

    | branch | entry condition | 1st match | 2nd match | 3rd match (floor) |
    |---|---|---|---|---|
    | streaming | `method !== "HEAD"` and the matched chain is non-empty | legacy `config.renderStream(matched.load, inputs, ropts)` | `renderer.renderStream(matched.chain, inputs, ropts, chrome)` | — (no floor; falls through to the buffered branch) |
    | buffered | `method === "HEAD"`, or the chain is empty, or neither streaming source above is present | legacy `config.render(matched.load, inputs, ropts)` | `renderer.renderDocument(matched.chain, inputs, ropts, chrome)` | internal placeholder `renderDocument()` (core.ts:855-872, [§1](01-1-public-api-surface-all-of-mrg-keystone-sprig.md)) — always present, never absent |

    A `config.renderStream`/`config.render` supplied with no `renderer` (or with a
    `renderer` lacking its own `renderStream`/`renderDocument`) still renders through that
    legacy branch; it is never routed to dead code or discarded — the isolate workbench's
    generated `manifest.gen.ts` is a live `config.modules` consumer, spec 07
    [§2](../07-isolate-workbench/02-2-the-isolate-cli-cli.md); see
    [§10](10-10-refactor-targets-tensions-observed.md).1. `config.modules` plays no part
    in this render step — per step 7 it supplies only `resolve` and is never invoked to
    produce a render.

    Buffered-branch render throw → a controlled 500 (shape in [Terminal
    outcomes](#terminal-outcomes) below; the internal placeholder never throws) — this
    branch alone is wrapped in a try/catch (core.ts:836-846). The streaming branch has NO
    such try/catch (core.ts:826-833): a synchronous throw from
    `config.renderStream(...)`/`renderer.renderStream(...)` while constructing the
    `ReadableStream` is never caught here — it propagates out of `fetch()` uncaught, which
    is a host-level concern (how the caller of `SprigApp.fetch` handles a rejected/thrown
    `fetch`) outside this document's scope. A throw from inside the stream itself, after
    emission has begun, is a distinct and strictly worse case: the streaming `Response`'s
    head is built from the SAME `root.status ?? 200` computed in step 8 (a custom
    `setResponseStatus` is honored on the streaming branch exactly as on the buffered one)
    plus `ssrHeaders()`, and both have already been sent as the `Response`'s head by the
    time the stream itself throws, so it can never become a 500 — the stream simply errors
    and the transfer terminates abnormally. Neither streaming failure mode produces the
    controlled-500 body/headers described above; that shape is exclusive to the buffered
    branch.

    The placeholder floor is a real HTML document that embeds the resolved `inputs` as
    `<pre>`-dumped JSON instead of the rendered folder-component tree. `{ routes }` alone
    is therefore a supported `AppConfig`: a renderer-less config never 500s at this step —
    it degrades to the placeholder on every matched route (useful before a renderer
    exists, e.g. early scaffolding/preview). HEAD always takes the buffered
    `renderDocument` branch (streaming is excluded by the "not HEAD" entry condition
    above) so status/headers are computed exactly as they would be for the equivalent GET,
    but the resolved HTML string is discarded before constructing the `Response`: a HEAD
    response carries the same status and headers as GET with an empty body.
11. Response headers (`ssrHeaders()`): `content-type: text/html; charset=utf-8`,
    `cache-control: no-store`, `x-content-type-options: nosniff`,
    `x-frame-options: SAMEORIGIN` (SAMEORIGIN not DENY — the isolate preview frames its
    own pages), `referrer-policy: no-referrer`.

**The leak-surface invariant:** `ResolveCtx` is `{params, url}` ONLY. Auth is enforced in
guards/grants (which get headers/session) — never in resolve. Session reaches page logic
only via `RouteCtx` in render options.

### A worked trace

A request for `GET /app/projects/42`, `config.base = ""`, a configured `renderer`, and
`env = { backend, assetsVersion: "abc123", session: { name: "Ada", grants: ["member"] } }` —
the same request [§3](03-3-routing-semantics-core-ts-486-644.md)'s worked trace matches —
moves through the pipeline as:

1. Base `""` → nothing is stripped and nothing is off-base (step 1); the raw path
   `/app/projects/42` goes straight to `matchRoute`.
2. `matchRoute` returns the `MatchedRoute` from [§3](03-3-routing-semantics-core-ts-486-644.md)'s
   trace: `chain: [{load:"routers/app"}, {load:"pages/project"}]`, `load:"pages/project"`,
   `params: {id:"42"}`, `guards: [requireSession]`, `grants: []` (step 2).
3. Method is `GET` — neither `OPTIONS` nor non-GET/HEAD — the method gate passes through
   (step 3).
4. `root = new Injector("server","root")`; `env.backend` is present, so
   `root.provide(Backend, env.backend)`; `routeInjector = root.child("route")` (step 4).
5. Guards `[requireSession]` run parent-first in `routeInjector`; the request carries
   `env.session`, so `requireSession` passes (step 5, mechanism in
   [§3](03-3-routing-semantics-core-ts-486-644.md)).
6. `grants` is `[]` — no `requiredGrant` was collected on this chain — so step 6 is a
   no-op (nothing to verify).
7. `matched.load` is `"pages/project"`; no `config.modules["pages/project"]?.resolve`
   override is configured, so `renderer.loadResolve("pages/project")` is called and
   returns a `Resolve`, which runs and produces
   `inputs = { project: { id: "42", name: "Demo" } }` (step 7).
8. `root.status` was never set → status stays `200` (step 8).
9. `reqCtx = { url, params: {id:"42"}, session: env.session }`;
   `ropts = { assetsVersion: "abc123", reqCtx }`;
   `chrome = { nav: buildNav(config.routes, "/app/projects/42", "") }` (step 9).
10. Method is `GET` (not HEAD) and the chain is non-empty, so the request streams; no
    legacy `config.renderStream` is configured, so `renderer.renderStream(matched.chain,
    inputs, ropts, chrome)` is called and produces the `ReadableStream` (step 10).
11. The response head is built from status `200` + `ssrHeaders()` (step 11).

### Terminal outcomes

Every response `fetch` can emit, one row per exit point. Guard/grant redirect shapes are
owned by [§3](03-3-routing-semantics-core-ts-486-644.md) (Guards vs. Grants) and only
cross-referenced here; every controlled-500 site, in contrast, is inventoried here in
full — [§3](03-3-routing-semantics-core-ts-486-644.md) itself defers to this table for
that inventory.

| exit point / step | trigger | status | body | headers | caught? |
|---|---|---|---|---|---|
| Step 1 — off-base path | non-empty `config.base`, path outside it (incl. bare `/`) | 404 | `"Not Found"` | none | n/a |
| Step 2 — no match | `matchRoute` returns `null` | 404 | `"Not Found"` | none | n/a |
| Step 3 — OPTIONS | method is `OPTIONS` | 204 | empty | `allow: GET, HEAD, OPTIONS` | n/a |
| Step 3 — method gate | method is neither GET, HEAD, nor OPTIONS | 405 | `"Method Not Allowed"` | `allow: GET, HEAD, OPTIONS` | n/a |
| Steps 5-6 — guard/grant deny | a guard's returned path diverges, or `verifyGrant` is falsy | 302 | shape owned by [§3](03-3-routing-semantics-core-ts-486-644.md) | shape owned by [§3](03-3-routing-semantics-core-ts-486-644.md) | n/a |
| Step 5 — guard throw | a guard throws | 500 (controlled) | `"Internal Server Error"` | `ssrHeaders()` | yes |
| Step 6 — grant throw | `verifyGrant` throws | 500 (controlled) | `"Internal Server Error"` | `ssrHeaders()` | yes |
| Step 7 — resolve throw | `loadResolve` or the resolved `resolveFn` throws | 500 (controlled) | `"Internal Server Error"` | `ssrHeaders()` | yes |
| Step 10 — render | method ≠ HEAD, chain non-empty, a render source succeeds (streaming or buffered) | `root.status ?? 200` | the rendered HTML (streamed or buffered) | `ssrHeaders()` | n/a |
| Step 10 — buffered render throw | the legacy `render` callback or `renderer.renderDocument` throws | 500 (controlled) | `"Internal Server Error"` | `ssrHeaders()` | yes (core.ts:836-846) |
| Step 10 — placeholder | neither a legacy `render` callback nor a `renderer.renderDocument` is configured | `root.status ?? 200` | internal placeholder HTML (`<pre>`-dumped `inputs`) | `ssrHeaders()` | n/a |
| Step 10 — HEAD | method is `HEAD` | `root.status ?? 200` (same as the equivalent GET) | empty | `ssrHeaders()` (same as the equivalent GET) | n/a |
| Step 10 — streaming sync throw | `config.renderStream`/`renderer.renderStream` throws synchronously while constructing the `ReadableStream` | — (no `Response` is ever built) | — | — | NO — propagates out of `fetch()` uncaught; a host-level concern outside this document's scope |
| Step 10 — streaming post-emission throw | the stream itself throws after its head (`root.status ?? 200` + `ssrHeaders()`) has already been sent | already-sent `root.status ?? 200` | partial — the transfer terminates abnormally | already-sent `ssrHeaders()` | NO — never becomes a controlled 500 |

