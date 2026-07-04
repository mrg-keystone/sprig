<sub>[← sprig docs](./README.md)</sub>

# Data & dependency injection

sprig loads data on the **server** through a small hierarchical injector (root → route →
component). Pages declare a `resolve.ts`; services are `@Injectable` classes; the built-in
`Backend` token is the in-process bridge to your keep API.

## resolve.ts — a page's data loader

A page's `resolve.ts` exports `resolve`. It runs on the server inside a **route-scoped**
injector and returns the page's `@inputs`:

```ts
// pages/workbench/resolve.ts
import { inject, type Resolve } from "@mrg-keystone/sprig";
import { DiscoveryService } from "../../services/discovery/mod.ts";

export const resolve: Resolve = async (ctx) => {
  const disc = inject(DiscoveryService);          // sync DI — call BEFORE the first await
  const { cases, problems, count } = await disc.manifest("fixtures/fresh-app");
  return { cases, problems, count, previewBase: "" };
};
```

`resolve` receives `{ params, url }` (`ctx.params` are the URL-decoded route `:params`,
`ctx.url` is the request `URL`). Its returned object becomes the template scope and the
serialized `@inputs` for any islands the page mounts.

> **`inject()` is synchronous-only.** Call it (capture deps into locals) *before* the first
> `await` — the active injector is cleared across async boundaries. The same contract holds
> inside a route guard ([routing.md](./routing.md)): guards run on the same route-scoped
> injector as `resolve`, so a service a guard instantiates is the instance `resolve` sees.

Wire the resolver into the app in `main.ts`:

```ts
modules: { "./pages/workbench": { resolve: workbenchResolve } },
```

## Services: `@Injectable` + scope

A service is a class decorated with `@Injectable`. The `scope` controls which side may resolve
it:

```ts
import { Backend, inject, Injectable } from "@mrg-keystone/sprig";

@Injectable({ scope: "server" })   // "server" | "client" | "both" (default "both")
export class DiscoveryService {
  #be = inject(Backend);           // resolved at construction, in the active injector

  async manifest(projectRoot: string) {
    const { ok, data } = await this.#be.get<RawManifest>("/http/get-manifest", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ projectRoot }),
    });
    return ok && data ? data : {};
  }
}
```

`inject(TheClass)` resolves (and caches) an instance from the active injector. `providedIn:
"root"` caches on the request root instead of the local injector. **Scope is a hard boundary:**
injecting a token whose scope doesn't match the current side throws —
*"DI does not cross the SSR/island boundary."* Server data reaches islands only as serialized
`@inputs`.

For non-class providers (config objects, factories), use `token`:

```ts
import { token } from "@mrg-keystone/sprig";
export const ApiBase = token<string>("ApiBase", { scope: "both", factory: () => "/api" });
// inject(ApiBase) → "/api"
```

## The `Backend` token — in-process SSR vs the `/api` network channel

`Backend` is a built-in **server-scoped** token. There are two ways your UI reaches the keep
backend, and they are deliberately different:

| | from `resolve.ts` / a server service (SSR) | from a client **island** |
|---|---|---|
| how | `inject(Backend)` → `.get<T>(path)` / `.fetch(path, init)` | `fetch("/api/…")` |
| transport | **in-process** — no TCP, no token auth, bypasses the network gateway | real HTTP over `/api/*`, token-gated + hardened |
| paths | keep-relative (`/http/get-manifest`) | prefixed `/api/http/...` |

`serveSprig` binds `Backend` to keep's `backend.fetch` per request (see
[hosting.md](./hosting.md)); injecting it in island/client code **throws** (scope `"server"`).

`BackendClient.get<T>` is a typed convenience over `fetch`: it returns
`{ ok, status, data? }`, draining the body and reporting `ok: false` on a non-2xx **or** a
non-JSON body — so a bad upstream response never crashes your resolver or leaks a stream.

## Mapping "not found" to a 404

A resolver/service can set the response status for a matched route whose resource is missing.
Capture the request injector synchronously (at construction), then call `setResponseStatus`:

```ts
import { Backend, currentInjector, inject, Injectable, setResponseStatus } from "@mrg-keystone/sprig";

@Injectable({ scope: "server" })
export class IssueService {
  #be = inject(Backend);
  #req = currentInjector();                  // captured synchronously at construction

  async issue(id: string) {
    const { ok, data } = await this.#be.get(`/http/issue/${id}`);
    if (!ok || data == null) setResponseStatus(this.#req, 404);   // matched route, missing resource
    return data ?? null;
  }
}
```

`bootstrap.fetch` reads the request-root status and emits it on the response line (default
200). Any thrown error in `resolve`/`render` becomes a controlled **500** (no internal text
leaked).

---

**Next:** [routing.md](./routing.md) — routes & params.
**See also:** [islands.md](./islands.md) · [hosting.md](./hosting.md)
