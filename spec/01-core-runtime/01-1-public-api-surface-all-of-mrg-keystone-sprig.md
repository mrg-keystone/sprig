## 1. Public API surface (all of `@mrg-keystone/sprig`)

> **Completeness & acceptance.** The public surface of `@mrg-keystone/sprig` is
> exactly the union of every symbol reachable through the package's three JSR
> **export-map entries** — `deno.json`'s `exports` field, not `publish.include`
> (per [00-overview §2](../00-overview/02-the-three-products-in-this-repo.md)):
>
> | export | module | import path | owning spec |
> |---|---|---|---|
> | `.` | `framework/.sprig/core.ts` | `@mrg-keystone/sprig` | this section |
> | `./keep` | `packages/keep/mod.ts` | `@mrg-keystone/sprig/keep` | spec 06 |
> | `./cli` | `framework/cli.ts` | `@mrg-keystone/sprig/cli` | spec 05 |
>
> The `.` entry is catalogued in full below; `./keep` and `./cli` are named and
> cross-referenced to their owning spec in
> [Sibling-owned public entry points](#sibling-owned-public-entry-points) —
> each specced there, not restated here. "Preserve the surface" means: a
> refactor keeps exactly these three export-map entries and every symbol on
> them — none added, none dropped, none re-signatured — and keeps every
> symbol under [Internal-but-must-survive](#internal-but-must-survive) (below)
> working even though it stays unexported. `publish.include` ships additional
> files (the compiler, `install.ts`, and other CLI-support modules) as bytes
> so those three entries can run; those bytes are transitive runtime
> dependencies, not importable exports, and are catalogued under
> Internal-but-must-survive too.

### Exported public surface
Every symbol below this heading, through
[Sibling-owned public entry points](#sibling-owned-public-entry-points), ships
on the JSR surface via one of the three export-map entries above. The
subsections through [Auth re-exports](#auth-re-exports-core-ts-884-894) are
the `.` entry (core.ts); [Sibling-owned public entry
points](#sibling-owned-public-entry-points) covers the `./keep` and `./cli`
entries. What follows after that — under
[Internal-but-must-survive](#internal-but-must-survive) — is deliberately NOT
exported, whether because it never sat on the export map or because it ships
only as `publish.include` bytes; it is catalogued because a refactor must
keep it working anyway.

#### Reactivity (core.ts:17-56)
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
state ([§5](05-5-stateservice-persisted-client-state-core-ts-103-187.md)).

#### DI (core.ts:58-101, 189-339)
- `type Scope = "server" | "client" | "both"`, `type Side = "server" | "client"`.
- `Injectable(config?: { scope?: Scope /*default "both"*/; providedIn?: "root" })` — class
  decorator, registers into a module-global `REGISTRY` with factory `() => new target()`.
- `token<T>(name, { factory, scope?, providedIn? })` — value/interface tokens
  (`Token<T> = { key: symbol; name: string }`).
- `class Injector` — see [§2](02-2-injector-semantics-core-ts-190-256.md).
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
- `detectDualRuntime()` — see [§7](07-7-dual-runtime-detection-core-ts-273-292.md).

#### Backend bridge (core.ts:341-384)
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

#### Components / resolve (core.ts:386-437)
- `interface ResolveCtx { params: Record<string,string>; url: URL }` — **deliberately no
  session/headers** (see [§4](04-4-bootstrap-request-pipeline-core-ts-709-850.md) leak note).
- `type Resolve = (ctx) => Record<string,unknown> | Promise<...>`.
- `interface RouteCtx { url; params; session: SessionProfile | null }` — the richer
  context a page's `logic.ts` `onServerLoad` receives (threaded via render options).
- `interface ComponentCtx { input<T>(name, fallback?): Accessor<T>; output<T>(name): (v:T)=>void; model<T>(name, fallback?): WritableAccessor<T> }`.
- `type IslandTrigger = "load" | "idle" | "visible" | "interaction"`.
- `interface ComponentDef<T> { inputs: string[]; setup: (ctx)=>T; trigger: IslandTrigger }`.
  `inputs` is declared (default `[]`) but INERT — no runtime/compiler/build code reads
  it (mod.ts consumes only `setup`/`trigger`; `computeInputs` turns component-tag
  attrs into the child's `@inputs` unconditionally, spec 02 §1; `ctx.input()` reads
  any bridged key). It filters nothing.

  > **[DECIDE]** `ComponentDef.inputs` is exported but dead — an inert field on
  > the public surface has nothing real for the preservation contract (above)
  > to pin, and either fork (drop it or make it filter) is a product choice
  > this doc hasn't made. Recommended default: drop `inputs` from
  > `ComponentDef`'s public surface unless a concrete consumer needs it — an
  > exported-but-inert field should not be carried forward by a contract that
  > exists to stop exactly this kind of drift.
- `defineComponent(setupOrOptions)` — bare fn ⇒ `{inputs:[], trigger:"load"}` defaults.
- `interface ComponentModule { resolve?: Resolve; default?: ComponentDef }`.

#### Routing (core.ts:439-644) — see [§3](03-3-routing-semantics-core-ts-486-644.md)
- `interface SessionProfile { name?; email?; grants?: string[] }` (core.ts:452-456).
- `interface GuardCtx { path: string[] /* post-base URL segments, raw/undecoded */;
  params: Record<string,string> /* decoded :param captures */; url: URL;
  headers: Headers; session?: SessionProfile | null /* set in session mode */ }`
  (core.ts:457-465) — no other members.
- `Guard` (see [§3](03-3-routing-semantics-core-ts-486-644.md)), `RouteMeta { nav?: string; icon?: string; title?: string;
  [key: string]: unknown }` (`nav`'s PRESENCE opts the route into the generated nav, and
  its STRING VALUE supplies `NavItem.label` verbatim — `meta.title` plays no part in nav
  generation), `Route` (shape in [§3](03-3-routing-semantics-core-ts-486-644.md)), `defineRoutes` (identity, typing anchor), `isLayoutLoad`.
- `interface NavItem { href: string; label: string; icon?: string; active: boolean }`;
  `buildNav`.
- `interface MatchedLevel { load: string; meta?: RouteMeta }`;
  `interface MatchedRoute { chain: MatchedLevel[] /* OUTER→INNER */;
  load? /* leaf convenience */; params: Record<string,string>;
  guards? /* parent-first */; grants?: string[] /* parent-first */ }`; `matchRoute`.

#### Bootstrap (core.ts:653-850) — see [§4](04-4-bootstrap-request-pipeline-core-ts-709-850.md)
`AppRenderer`, `AppConfig`, `SprigApp`, `bootstrap`.

#### State (core.ts:103-187) — see [§5](05-5-stateservice-persisted-client-state-core-ts-103-187.md)
`StateService`, `persistState()`, `restoreState()`.

#### Auth re-exports (core.ts:884-894) — see [§6](06-6-auth-ts-httponly-cookie-auth-framework-sprig-auth-ts.md)
`apiPost, authFetch, AuthError, getUserData, login, loginWithGoogle, logout,
SESSION_COOKIE, warmAuth` from `auth.ts`.

#### Sibling-owned public entry points
core.ts is not the whole package: the JSR export map also ships two other
public entry points, `./keep` and `./cli`, whose contracts belong to other
subsystem specs. Named here for completeness (per the acceptance statement
above); each one's shape, options, and behavior are specced at the
cross-reference, not repeated here.

| export | symbol(s) | what they are | owning spec |
|---|---|---|---|
| `./keep` | `serveSprig`, `sprigUi` | one-origin serving composition | spec 06 [§3](../06-keep-serving-composition/03-3-the-servesprig-composition-current-as-built.md) |
| `./keep` | `sprigAuth` | the auth gateway / `/api` body gateway | spec 06 [§4](../06-keep-serving-composition/04-4-the-auth-gateway-api-body-gateway-current-as-built.md) |
| `./keep` | `loadRoutes` | JSON folder-routing loader | spec 06 [§8](../06-keep-serving-composition/08-8-json-folder-routing.md) |
| `./keep` | `derivedRedirect` | zero-composition redirect derivation | spec 06 [§9](../06-keep-serving-composition/09-9-zero-composition-derivation.md) |
| `./keep` | `assetExt` | asset-serving extension helper | spec 06 [§5](../06-keep-serving-composition/05-5-asset-serving-serveasset-hardening-contract.md) |
| `./keep` | `createRenderer` (→ `SsrRenderer`, whose members include `loadResolve`) | re-exported from the template compiler's `mod.ts` so `serveSprig` can render pages | spec 06 [§3](../06-keep-serving-composition/03-3-the-servesprig-composition-current-as-built.md) (mechanism: spec 02 [§5](../02-template-compiler/06-5-mod-ts-registry-page-assembly-renderer.md)) |
| `./keep` | `KeepApi`, `ServeSprigConfig`, `SprigUiConfig`, `ServeDefaultExport`, `SessionIntake`, `SessionMinted`, `SessionProfile` | interfaces for the `serveSprig`/`sprigUi` seam | spec 06 [§2](../06-keep-serving-composition/02-2-the-keepapi-seam-session-types-current-as-built.md) |
| `./cli` | the CLI's command surface (`install`, `dev`, `build`, `serve`, `isolate`, …) | the `sprig` CLI entry (`framework/cli.ts`), run as `deno run -A jsr:@mrg-keystone/sprig/cli <command>` | spec 05 |

No other symbols are exported from `./keep` or `./cli`; a refactor that adds
one updates this table.

### Internal-but-must-survive
NOT on the JSR export map — a refactor is free to rename or restructure these
internally — but each one is load-bearing behavior a refactor must preserve
under some name. Two kinds land here:

- **core.ts-local internals**, never their own file: `REGISTRY` (core.ts:78),
  `LIVE_STATES` (:107), `current` injector (:294), `CTOR_KEYS` WeakMap (:327),
  `SSR_ALLOW = "GET, HEAD, OPTIONS"` (:692), `ssrHeaders()` (:694-707),
  placeholder `renderDocument` `<pre>` fallback (:855-872).
- **Published as bytes, not export-map targets**: `deno.json`'s
  `publish.include` ships whole files — the template compiler (`build.ts`,
  `parse.ts`, `render.ts`, `hydrate.ts`, `island.ts`, and more) plus
  `install.ts`, `skills.ts`, `spec-root.ts`, `annotate.ts` — as bytes so the
  three export-map entries above have something to run against. Being in
  `publish.include` makes a file *reachable*, not *importable*: none of it
  has an `exports` entry, so an app author cannot `import` from it directly.
  `buildClient` and `appName` (`build.ts`, spec 04 §1) and `parseTemplate`
  (`parse.ts`, spec 02 §1) are the notable symbols here — CLI-only per
  `packages/keep/mod.ts`'s own comment that the compiler's build/parse
  tooling ("buildClient + the tree-sitter parser") "is CLI-only and is NOT
  re-exported." That scoping excludes the compiler's rendering subset:
  `createRenderer`/`SsrRenderer` (`mod.ts`) ARE re-exported, on `./keep`
  (see [Sibling-owned public entry
  points](#sibling-owned-public-entry-points)) — only the build/parse
  tooling stays unexported bytes.

