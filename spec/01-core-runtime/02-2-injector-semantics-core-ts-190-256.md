## 2. Injector semantics (core.ts:190-256)

This is the home of **invariant 2: DI never crosses the wire.** Crossing the
SSR/island boundary would leak server-only bindings (DB clients, secrets) toward the
client. Two legs enforce it: the scope guard in `#instantiate` (below — the SSR/island
half) and `inject()` being synchronous-only (any `await` clears the module-level
`current` pointer — owned by [§1](01-1-public-api-surface-all-of-mrg-keystone-sprig.md)'s DI section, not restated here).

- Constructor: `(side: Side, kind: "root"|"route"|"component" = "root", parent?)`.
  Public mutable `status?: number` on the request root.
- `provide(token, value)` — per-request concrete binding (how `Backend` is wired).
- `resolve(token)` — `keyOf` → `REGISTRY` lookup (throws `No provider for <name>` if
  unregistered); `providedIn:"root"` dispatches to `this.root`, else instantiates here.
- `child(kind)` — child injector inheriting `side`.
- `#instantiate` ordering — **contract, pinned by tests**, stated as observable
  acceptance criteria (mechanism follows each):
  1. **A wrong-side `inject` throws even when a cached value is already present** —
     the scope guard runs strictly *before* the presence-cache check, not after (bug
     #92): `Cannot inject <name> (scope="…") on the <side>. Pass its data in as an
     @input instead — DI does not cross the SSR/island boundary.`
  2. **A factory returning `undefined` is invoked exactly once** across repeated
     resolves of the same token on the same injector — the cache is presence-based
     (`{has, value}`, walked up the parent chain), so a cached `undefined` is a HIT,
     never a re-run (bugs #59/#60).
  3. **`current` is restored to its prior value after `resolve` returns, including
     when the factory throws** — miss path: set `current = this`, run the factory (so
     service constructors can `inject()`), cache the result on `this`, restore
     `current` in `finally` regardless of outcome.

  These three are the acceptance criteria `injector.test.ts` pins ([§9](09-9-behavioral-contracts-pinned-by-tests-must-survive-a-refact.md) names the file; this is the checkable contract it must assert).
- Golden path — a request resolving `Backend`, contrasted with the island hook's failure:
  1. Request in → the bootstrap `fetch` pipeline ([§4](04-4-bootstrap-request-pipeline-core-ts-709-850.md)
     step 4) builds `root("server")`, then `provide(Backend, impl)` binds the real client for
     this request. (`serveSprig` supplies `env.backend` per request; it does not construct
     the root.)
  2. `child("route")` — the matched route's guards/`resolve` run on this route child.
  3. The route's `resolve` hook calls `inject(Backend)`.
  4. `keyOf(Backend)` → `REGISTRY` lookup finds `providedIn:"root"` → dispatch to `this.root`
     (the request root from step 1, where `impl` was provided).
  5. Scope guard passes — token scope is `"server"`, injector `side` is `"server"`.
  6. Presence cache on the root is a miss (first resolve this request) → per-request bound
     factory runs and returns `impl`.
  7. `impl` is cached on the root; `inject(Backend)` returns it to `resolve`.

  Contrast: an island server hook resolving the same token gets no such binding. Per the
  table below, `withServerInjector` builds a *fresh* `root("server").child("component")`
  that never saw step 1's `provide(Backend, impl)`. Its `REGISTRY` dispatch lands on that
  fresh root, whose `Backend` factory is still the default — `inject(Backend)` throws
  "Backend is not bound" (core.ts:352-361), not a resolved client.
- Hierarchy in practice — the three injector contexts:

  | context | constructed by | parent chain | side | request-root `provide(Backend,…)` visible? | `inject(Backend)` result |
  |---|---|---|---|---|---|
  | SSR route child | `root("server")` → `child("route")` | route child → server root | server | **yes** — guards + resolve run on the route child, so request-root bindings are in scope | resolves to the bound `impl` |
  | island server hook | `withServerInjector` (island.ts:13-15) → `new Injector("server","root").child("component")` | fresh island root → *(none — isolated)* | server | **no** | throws the unbound factory ("Backend is not bound … server data reaches islands as serialized @inputs", core.ts:352-361) |
  | client document root | `clientRoot()` (browser document singleton) | *(none — single root)*; island class setup constructs inside it | client | **no** | scope-guard throw (server-scoped token on the client) |

  The island server hook's injector is a **fresh, isolated tree** built per island —
  it must NOT join the request hierarchy, which is exactly why request-root bindings
  never reach it: server data must reach islands as serialized `@input`s, not via DI.

