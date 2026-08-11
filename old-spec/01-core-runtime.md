# 01 — Core runtime: signals, DI, routing, bootstrap SSR, state, auth

> Subject: `framework/.sprig/core.ts` (~43KB — THE public API of `@mrg-keystone/sprig`;
> `deno.json` maps both the import alias and the JSR `"."` export to it), plus `auth.ts`
> (re-exported through core) and `spec-root.ts`. Version at time of writing:
> `0.20.36-beta.1`. Decorators: `experimentalDecorators` + `emitDecoratorMetadata` are ON;
> the lib set includes both `deno.ns` and `dom` — core.ts compiles against BOTH runtimes
> and reaches browser APIs via `globalThis` casts only.

## 1. Public API surface (all of `@mrg-keystone/sprig`)

### Reactivity (core.ts:17-56)
Signals are **wrapped `@preact/signals-core`**, not custom:

| symbol | shape | notes |
|---|---|---|
| `signal<T>(initial)` | → `WritableAccessor<T>` | callable read `count()`, plus `.value` (get/set), `.set(v)`, `.update(fn)`, `.signal` (raw preact Signal) — core.ts:33-41 |
| `computed<T>(fn)` | → `Accessor<T>` | callable read-only + `.value` + `.signal` — core.ts:42-48 |
| `effect` | re-export | verbatim from @preact/signals-core (core.ts:18) |
| `Signal` (type) | re-export | raw preact type |
| `isSignal(v)` | guard | function with `.set` and `.signal` ⇒ writable accessor (excludes computeds) — core.ts:54-56. Used by the isolate harness to find editable signals in an island scope |

The callable-accessor wrapper exists because templates read `name()`. There is **no**
`batch`/`untracked` re-export. The only sprig-specific reactive extension is persisted
state (§5).

### DI (core.ts:58-101, 189-339)
- `type Scope = "server" | "client" | "both"`, `type Side = "server" | "client"`.
- `Injectable(config?: { scope?: Scope /*default "both"*/; providedIn?: "root" })` — class
  decorator, registers into a module-global `REGISTRY` with factory `() => new target()`.
- `token<T>(name, { factory, scope?, providedIn? })` — value/interface tokens
  (`Token<T> = { key: symbol; name: string }`).
- `class Injector` — see §2.
- `inject<T>(tokenOrCtor)` — resolves from the module-level `current` injector;
  **synchronous-only** (any `await` clears `current`); throws with the message naming the
  valid call sites: setup(), resolve(), a guard, or a service constructor (core.ts:297-302).
- `currentInjector()` — capture the active injector (e.g. in a service constructor) for
  later use.
- `setResponseStatus(injector, status)` — writes `injector.root.status`; bootstrap reads
  it as the HTTP status (the resolve→status side-channel).
- `runInInjector(injector, fn)` — set/restore `current` around `fn`.
- `clientRoot()` — the browser's document-singleton root injector, cached at
  `globalThis.__sprig_root` (core.ts:259-262).
- `detectDualRuntime()` — see §7.

### Backend bridge (core.ts:341-384)
- `interface BackendClient { fetch: typeof fetch; get<T>(path, init?): Promise<{ok; status; data?}> }` —
  `status` is always a plain number, never absent: a genuine HTTP response yields its real
  status code, and a network-level failure (the wrapped `fetchImpl` call itself rejects —
  DNS, connection refused, timeout, abort) is caught and reported as `status: 0`, a
  reserved sentinel meaning "no HTTP response was ever received," distinct from any real
  status code.
- `const Backend: Token<BackendClient>` — server-scoped, `providedIn:"root"`, name
  `"sprig:Backend"`. Its default factory **throws** ("Backend is not bound") — the host
  (keep's `serveSprig`) must `.provide()` it per request. Client-side inject throws on the
  scope guard. "DI never crosses the wire."
- `backendClient(fetchImpl)` — wraps a fetch; `get<T>` never throws and never leaks the
  body stream: non-2xx or non-JSON 2xx → `{ok:false,status}` (core.ts:364-384); a rejected
  `fetchImpl` call is caught and mapped to `{ok:false,status:0}` so `get<T>`'s "never
  throws" guarantee holds for network failures too.

### Components / resolve (core.ts:386-437)
- `interface ResolveCtx { params: Record<string,string>; url: URL }` — **deliberately no
  session/headers** (see §4 leak note).
- `type Resolve = (ctx) => Record<string,unknown> | Promise<...>`.
- `interface RouteCtx { url; params; session: SessionProfile | null }` — the richer
  context a page's `logic.ts` `onServerLoad` receives (threaded via render options).
- `interface ComponentCtx { input<T>(name, fallback?): Accessor<T>; output<T>(name): (v:T)=>void; model<T>(name, fallback?): WritableAccessor<T> }`.
- `type IslandTrigger = "load" | "idle" | "visible" | "interaction"`.
- `interface ComponentDef<T> { inputs: string[]; setup: (ctx)=>T; trigger: IslandTrigger }`.
  `inputs` is declared (default `[]`) but INERT — no runtime/compiler/build code reads
  it (mod.ts consumes only `setup`/`trigger`; `computeInputs` turns component-tag
  attrs into the child's `@inputs` unconditionally, spec 02 §1; `ctx.input()` reads
  any bridged key). It filters nothing; vestigial surface to drop or implement.
- `defineComponent(setupOrOptions)` — bare fn ⇒ `{inputs:[], trigger:"load"}` defaults.
- `interface ComponentModule { resolve?: Resolve; default?: ComponentDef }`.

### Routing (core.ts:439-644) — see §3
- `interface SessionProfile { name?; email?; grants?: string[] }` (core.ts:452-456).
- `interface GuardCtx { path: string[] /* post-base URL segments, raw/undecoded */;
  params: Record<string,string> /* decoded :param captures */; url: URL;
  headers: Headers; session?: SessionProfile | null /* set in session mode */ }`
  (core.ts:457-465) — no other members.
- `Guard` (see §3), `RouteMeta { nav?: string; icon?: string; title?: string;
  [key: string]: unknown }` (`nav`'s PRESENCE opts the route into the generated nav, and
  its STRING VALUE supplies `NavItem.label` verbatim — `meta.title` plays no part in nav
  generation), `Route` (shape in §3), `defineRoutes` (identity, typing anchor), `isLayoutLoad`.
- `interface NavItem { href: string; label: string; icon?: string; active: boolean }`;
  `buildNav`.
- `interface MatchedLevel { load: string; meta?: RouteMeta }`;
  `interface MatchedRoute { chain: MatchedLevel[] /* OUTER→INNER */;
  load? /* leaf convenience */; params: Record<string,string>;
  guards? /* parent-first */; grants?: string[] /* parent-first */ }`; `matchRoute`.

### Bootstrap (core.ts:653-850) — see §4
`AppRenderer`, `AppConfig`, `SprigApp`, `bootstrap`.

### State (core.ts:103-187) — see §5
`StateService`, `persistState()`, `restoreState()`.

### Auth re-exports (core.ts:884-894) — see §6
`apiPost, authFetch, AuthError, getUserData, login, loginWithGoogle, logout,
SESSION_COOKIE, warmAuth` from `auth.ts`.

### Internal but load-bearing
Module-level singletons: `REGISTRY` (core.ts:78), `LIVE_STATES` (:107), `current`
injector (:294), `CTOR_KEYS` WeakMap (:327), `SSR_ALLOW = "GET, HEAD, OPTIONS"` (:692),
`ssrHeaders()` (:694-707), placeholder `renderDocument` `<pre>` fallback (:855-872).

## 2. Injector semantics (core.ts:190-256)

- Constructor: `(side: Side, kind: "root"|"route"|"component" = "root", parent?)`.
  Public mutable `status?: number` on the request root.
- `provide(token, value)` — per-request concrete binding (how `Backend` is wired).
- `resolve(token)` — `keyOf` → `REGISTRY` lookup (throws `No provider for <name>` if
  unregistered); `providedIn:"root"` dispatches to `this.root`, else instantiates here.
- `child(kind)` — child injector inheriting `side`.
- `#instantiate` ordering — **contract, pinned by tests**:
  1. **Scope guard FIRST**, before cache: wrong-side resolution throws
     `Cannot inject <name> (scope="…") on the <side>. Pass its data in as an @input
     instead — DI does not cross the SSR/island boundary.` (bug #92).
  2. **Presence-based cache** walk up the parent chain (`{has, value}`) — a cached
     `undefined` is a HIT (bugs #59/#60).
  3. Miss → set `current = this`, run factory (so service constructors can `inject()`),
     cache on `this`, restore `current` in `finally`.
- Hierarchy in practice: SSR request = `root("server")` → `child("route")` — guards +
  resolve run on the route child, so request-root bindings (`provide(Backend, …)`)
  are visible to them. Island server hooks do NOT join this hierarchy: per island,
  `withServerInjector` (island.ts:13-15) runs setup/constructor/`onServerInit` inside
  a FRESH `new Injector("server","root").child("component")` — the request root's
  `Backend` binding is invisible there, so `inject(Backend)` in an island server hook
  dispatches to the fresh root and throws the unbound factory ("Backend is not bound …
  server data reaches islands as serialized @inputs", core.ts:352-361). Client = one
  document root via `clientRoot()`; island class setup constructs inside it.

## 3. Routing semantics (core.ts:486-644)

Route shape: `{ path, load?, children?, guards?, meta?, requiredGrant? }`.

- **Layouts:** `isLayoutLoad(load)` ⇔ `load.startsWith("routers/")`. A `routers/*` load
  wraps children in its own `<router-outlet>` and joins the matched `chain`
  (OUTER→INNER); a plain page-parent renders itself at its base and does **not** wrap
  children (back-compat, pinned routing-chain.test.ts:92-100).
- **Matching (`matchRoute`):** static segments exact; `:param` captures one
  percent-decoded segment; rest params `:name+` (≥1 seg) / `:name*` (≥0) capture the
  remainder incl. slashes and are terminal. Params are stored decoded; `ctx.path`
  segments stay raw. Guard/grant chains collected **parent-first with fresh arrays per
  level** (no sibling leak — guards.test.ts:233-258). Layout with fully-consumed path
  descends into its index child (`path:""`). Pure container with nothing renderable →
  `null`.
- **Guards:** `(ctx: GuardCtx) => string[] | Promise<string[]>` — return the target route
  as path segments. Comparison is by VALUE, never array identity (core.ts:748-752): the
  returned array is normalized (each element split on `/`, empties dropped; `[]` ≡ root),
  joined with `/`, and string-compared against the request path's own segments joined the
  same way — so any equal-valued route (a rebuilt `[...ctx.path]`, `["a/b"]` ≡ `["a","b"]`)
  proceeds; anything else → 302 to `${base}/${out.join("/")}` (+`cache-control: no-store`),
  the SAME normalized segments feeding both the comparison and the Location header.
  Guards run parent-first, each in its **own**
  `runInInjector(routeInjector, …)` so every guard has a synchronous `inject()` window
  even after a prior guard awaited; the same route injector is later shared with resolve
  (same service instance — guards.test.ts:110-127). First divergent guard wins. A
  throwing guard fails CLOSED → a **controlled 500**: body `"Internal Server Error"`,
  headers `ssrHeaders()` (core.ts:761) — no `Location`, no extra headers. This is the
  SAME response shape every controlled-500 site in this document produces (a throwing
  grant check, §3 Grants; a throwing `resolve`/`loadResolve`, §4 step 7; a throwing
  buffered-branch render, §4 step 10 — the streaming branch has no controlled-500 path,
  see §4 step 10). Guards see request `headers` (cookie auth) and `session` (from
  `env.session`).
- **Grants:** `requiredGrant` collected parent-first; verified in bootstrap AFTER guards,
  BEFORE resolve via `config.verifyGrant(grant, gctx)` — `verifyGrant?: (grant: string,
  ctx: GuardCtx) => boolean | Promise<boolean>` (core.ts:679), `gctx` being the SAME
  GuardCtx object the guards received, each call in its own
  `runInInjector(routeInjector, …)` (core.ts:769-784). Falsy return (sync or awaited) →
  302 to `config.grantDenied ?? ["login"]` (normalized like a guard's return,
  base-prefixed Location, +`cache-control: no-store` — the SAME two headers as the
  guard redirect above); throw → fails CLOSED, controlled 500 (same shape as a throwing
  guard's, §3 Guards). `config.verifyGrant`
  ABSENT → the whole step is SKIPPED: `requiredGrant` routes render unverified
  (core.ts:769). Must stay in bootstrap because ResolveCtx has no headers.
- **Nav:** `buildNav(routes, activePath, base)` derives `NavItem[]` from `meta.nav` —
  "the nav IS the router". A route with `meta.nav` set becomes one `NavItem`: its
  `label` is `meta.nav`'s string value verbatim, `icon` is `meta.icon`. Active = exact or
  prefix-with-`/` match; index href collapses to `base + "/"`.

## 4. bootstrap() request pipeline (core.ts:709-850)

`bootstrap(config) → { fetch(req, info?, env?) }` where
`env = { backend?, assetsVersion?, session? }` is supplied per request by the host
(keep's `serveSprig`).

The §1 bootstrap surface, in full (core.ts:657-689):
- `AppRenderer { renderDocument(chain: string | readonly MatchedLevel[], inputs:
  Record<string,unknown>, ropts?: { assetsVersion?: string; reqCtx?: RouteCtx },
  chrome?: Record<string,unknown>): Promise<string>;
  renderStream?(…same params): ReadableStream<Uint8Array>;
  loadResolve?(pageLoad: string): Promise<Resolve | undefined> }`.
- `AppConfig { routes: Route[]; base?: string; renderer?: AppRenderer;
  modules?: Record<string, ComponentModule>; render?: (chain: string | readonly
  MatchedLevel[], inputs: Record<string,unknown>, ropts?: { assetsVersion?: string;
  reqCtx?: RouteCtx }, chrome?: Record<string,unknown>) => Promise<string>;
  renderStream?: (...same params as render) => ReadableStream<Uint8Array> /* the legacy
  trio (with `modules`) — §10.1; `render`/`renderStream` share `AppRenderer.
  renderDocument`/`renderStream`'s signature, since they substitute for those methods */;
  verifyGrant?; grantDenied?: string[] /* §3 Grants */ }`.
- `SprigApp { fetch(req: Request, info?: Deno.ServeHandlerInfo, env?: { backend?:
  BackendClient; assetsVersion?: string; session?: SessionProfile | null }):
  Promise<Response> }`.

Pipeline order (each step's position is contract):
1. Base handling (core.ts:714-719): with a NON-empty `config.base`, an on-base path is
   stripped (`slice(base.length) || "/"`) and any off-base path — incl. bare `/` —
   404s: `new Response("Not Found", { status: 404 })` — body `"Not Found"`, NO headers
   at all (not `ssrHeaders()`: an off-base path is outside the app entirely, so none of
   the app's response-hardening headers apply — core.ts:719). With base `""` (the
   default) nothing is stripped and NOTHING is off-base: the raw path (incl. bare `/`)
   goes straight to matchRoute (`""` is a legitimate value, never "unset" — spec 03
   §10.6; the workbench serves `/` at base `""`).
2. `matchRoute` → 404 if null: the SAME response as step 1's — `new Response("Not
   Found", { status: 404 })`, body `"Not Found"`, no headers (core.ts:722).
3. Method gate: OPTIONS → 204 `allow: GET, HEAD, OPTIONS`; other non-GET/HEAD → 405
   `allow: GET, HEAD, OPTIONS` (body `"Method Not Allowed"`; same header/value as the
   OPTIONS 204). (Method gate runs BEFORE guards — guards.test.ts:199-212.)
4. Injectors: `root = new Injector("server","root")`; `env.backend` ⇒
   `root.provide(Backend, env.backend)`; `routeInjector = root.child("route")`.
5. Guards (see §3). 6. Grants (see §3).
7. Resolve: `resolveFn` starts as `config.modules?.[matched.load]?.resolve` (the legacy
   override, §10.1). If that's absent, `matched.load` is set, and `renderer.loadResolve`
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
   `ropts = { assetsVersion, reqCtx }`, `chrome = { nav: buildNav(routes, url.pathname,
   base) }` (the renderer feeds `chrome` to layouts + the shell as their inputs — spec 02
   §5). `activePath` is `url.pathname` — the FULL request path, base still included, NOT
   the base-stripped path produced in step 1 — since nav hrefs are themselves
   base-prefixed (§3 Nav) and matching a stripped path against them would never find an
   active item under a non-empty `config.base`.
10. Render: if `method !== "HEAD"` and the matched chain is non-empty, the request
    streams, resolving its source by a fixed priority that is independent of whether a
    `renderer` is configured at all: legacy `config.renderStream(matched.load, inputs,
    ropts)` FIRST if present, else `renderer.renderStream(matched.chain, inputs, ropts,
    chrome)` if present — a `config.renderStream` supplied with no `renderer` (or with a
    `renderer` lacking its own `renderStream`) still streams; it is never routed to dead
    code or discarded. If NEITHER source is present — or the request is HEAD, or the
    chain is empty — the request falls through to the buffered branch, resolved by the
    same legacy-first priority: `config.render(matched.load, inputs, ropts)` (legacy, same
    signature as `AppRenderer.renderDocument`) if present, else `renderer.renderDocument(
    matched.chain, inputs, ropts, chrome)` if present (legacy override path — but NOT
    dead: the isolate workbench's generated `manifest.gen.ts` is a live `config.modules`
    consumer, spec 07 §2; see §10.1). `config.modules` plays no part in this render step —
    per step 7 it supplies only `resolve` and is never invoked to produce a render.
    Buffered-branch render throw → a controlled 500 (same shape as §3 Guards'; the
    internal placeholder below never throws) — this branch alone is wrapped in a
    try/catch (core.ts:836-846).
    The streaming branch has NO such try/catch (core.ts:826-833): a synchronous throw
    from `config.renderStream(...)`/`renderer.renderStream(...)` while constructing the
    `ReadableStream` is never caught here — it propagates out of `fetch()` uncaught,
    which is a host-level concern (how the caller of `SprigApp.fetch` handles a
    rejected/thrown `fetch`) outside this document's scope. A throw from inside the
    stream itself, after emission has begun, is a distinct and strictly worse case: the
    200/streaming status and `ssrHeaders()` have already been sent as the `Response`'s
    head, so it can never become a 500 — the stream simply errors and the transfer
    terminates abnormally. Neither streaming failure mode produces the controlled-500
    body/headers described above; that shape is exclusive to the buffered branch.
    If `config` supplies NEITHER a legacy `render` callback NOR a `renderer` with
    `renderDocument`, the buffered branch falls to the internal placeholder
    `renderDocument()` (core.ts:855-872, §1) — a real HTML document that embeds the
    resolved `inputs` as `<pre>`-dumped JSON instead of the rendered folder-component
    tree. `{ routes }` alone is therefore a supported `AppConfig`: a renderer-less config
    never 500s at this step — it degrades to the placeholder on every matched route
    (useful before a renderer exists, e.g. early scaffolding/preview). HEAD always takes
    the buffered `renderDocument` branch (streaming is excluded by the "not HEAD"
    condition above) so
    status/headers are computed exactly as they would be for the equivalent GET, but the
    resolved HTML string is discarded before constructing the `Response`: a HEAD response
    carries the same status and headers as GET with an empty body.
11. Response headers (`ssrHeaders()`): `content-type: text/html; charset=utf-8`,
    `cache-control: no-store`, `x-content-type-options: nosniff`,
    `x-frame-options: SAMEORIGIN` (SAMEORIGIN not DENY — the isolate preview frames its
    own pages), `referrer-policy: no-referrer`.

**The leak-surface invariant:** `ResolveCtx` is `{params, url}` ONLY. Auth is enforced in
guards/grants (which get headers/session) — never in resolve. Session reaches page logic
only via `RouteCtx` in render options.

## 5. StateService — persisted client state (core.ts:103-187)

- Subclass with serializable fields; mark `@Injectable({providedIn:"root", scope:"both"})`.
- Storage: `localStorage["sprig:state:" + (static key ?? constructor.name)]`. A **static
  `key` is required in practice** — the production minifier mangles class names
  (state.test.ts:82-96).
- Client-only: every browser instance registers into module-global `LIVE_STATES`;
  server-side persist/restore/tracking are no-ops (gated on `typeof localStorage`).
- `persistState()` — client calls on each navigation + pagehide. `restoreState()` —
  called synchronously on client bootstrap before first paint (state.test.ts:98-120);
  constructor also queues `queueMicrotask(restore)` so field initializers run first.
- **Restore-once guard:** `#restored` is set BEFORE the read, so even an
  empty-localStorage first call locks out later overlays. Rationale: `restoreState()`
  runs on EVERY island hydration (incl. deferred triggers); without the guard, a
  late-hydrating island would re-overlay stale localStorage onto the shared root
  singleton, reverting live mutations (restore-once-guard.test.ts:1-11).
- **Pollution guard:** restore overlays only data fields — skips `__proto__` and any key
  whose current value is a function (state.test.ts:126-151). Corrupt JSON → keep state.
- `reset()` — fresh-probe defaults, clears the entry, re-enables restore.

## 6. auth.ts — httpOnly cookie auth (framework/.sprig/auth.ts)

Model: the server manages an **httpOnly cookie** (`SESSION_COOKIE = "sprig_session"`);
the browser's JS holds NO credential (no bearer, no JS-readable cookie) — the httpOnly
cookie itself still rides automatically on every same-origin fetch, and it IS the
`/api/*` credential in session mode (keep resolves it server-side — spec 06 §4). All
`document`/`location` access typeof-guarded (SSR-inert).

- `login(token?)` — the single intake: non-empty token → magic-link `POST /auth/exchange`;
  else Google popup flow.
- `loginWithGoogle()` — Google popup → Firebase idToken → `POST /auth/login`; server
  mints session + sets cookie; 401 → `AuthError("not-authorized")`; popup closed →
  `AuthError("cancelled")`.
- `getUserData()` — `GET /auth/me`; 401/unreachable → null; grants sanitized to strings.
  **Grants are UX-only, never a trust boundary** (auth.ts:16-18).
- `logout()` — `POST /auth/logout`, idempotent, swallows unreachable.
- `apiPost<T>(path, body)` — JSON POST to `/api${path}`, throws on non-2xx.
- `authFetch` — now plain fetch (cookie rides automatically); back-compat.
- `warmAuth()` — pre-warms Firebase SDK/config (Safari transient-activation window).
- **Module-load side effect:** `seedTokenFromUrl()` runs on import in a browser — reads
  `?token=`, strips it via `history.replaceState`, exchanges in background
  (auth.ts:107-109). Firebase is imported from the gstatic CDN via
  `new Function("u","return import(u)")` to hide the URL from the island bundler.

## 7. Dual-runtime detection (core.ts:273-292)

Two copies of the runtime in one document silently break all DI (registry/symbol
identity). `detectDualRuntime()` runs as a module-init side effect: server (no document)
→ false, never marks; browser first copy stamps `globalThis.__sprig_runtime`; a second
copy returns true, stamps `__sprig_runtime_dual`, and logs ONCE (message names "two
copies" / "stale cached bundle"). The hydrate loop uses the flag for a one-shot recovery
reload. Pinned by dual-runtime.test.ts.

## 8. spec-root.ts

`specRootOf(startDir)` (spec-root.ts:27-36) walks up to the nearest ancestor containing a
`.git` entry (**dir OR file** — worktrees) and returns it, else the start dir. Must stay
byte-identical in behavior to rune's walk (see 09-ecosystem-contracts.md §2). Published
as its own module, not re-exported from core.

## 9. Behavioral contracts pinned by tests (must survive a refactor)

- guards.test.ts: proceed/redirect semantics, async guards, parent-first order,
  first-redirect-wins, guard/resolve injector sharing, segment normalization, `[]`≡root,
  base-prefixed Location, throwing guard → 500, decoded params vs raw path, 405 before
  guards, cookie headers reach guards, no sibling guard leak.
- routing-chain.test.ts: layout chain assembly, index-child descent, page-parent
  back-compat, rest params, session threading, buildNav derivation.
- state.test.ts + restore-once-guard.test.ts: everything in §5.
- dual-runtime.test.ts: everything in §7.

## 10. Refactor targets / tensions observed

1. Legacy `AppConfig` members (`modules`, `render`, `renderStream`) interleave with the
   modern `renderer` — `render`/`renderStream` win over `renderer.renderDocument`/
   `renderStream` where present, and `modules` wins over `renderer.loadResolve` for step
   7's resolve — remove or formalize. `modules` has a LIVE consumer: the isolate
   workbench's generated `manifest.gen.ts` is exactly `{ routes, modules: {load:
   {resolve}} }` (spec 07 §2) — removal requires migrating that generator in the same
   change.
2. `status` as mutable injector-root state is a side-channel; consider a return value.
3. `inject()`'s sync-only global-`current` model is subtle (guards individually wrapped
   as a workaround); an explicit context-passing design would remove a failure class.
4. Module-init side effects (`detectDualRuntime()`, auth's `seedTokenFromUrl()`) make
   importing the module non-neutral.
5. The `Backend` throwing-factory landmine is intentional but only documented in the
   throw message.
