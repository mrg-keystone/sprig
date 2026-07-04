<sub>[← sprig docs](./README.md)</sub>

# Hosting

`serveSprig` (from `@mrg-keystone/sprig/keep`) is the one-origin composition root: it folds a keep backend
and the sprig UI into a single `{ fetch }` handler (a `Deno.ServeDefaultExport`) and binds
keep's in-process client to the `Backend` token. The app author writes `serveSprig({...})`,
not a hand-rolled path dispatcher.

## Composition

```ts
// serve.ts
import { serveSprig } from "@mrg-keystone/sprig/keep";
import { api } from "./server/bootstrap/mod.ts";   // a keep backend: { backend, handler }
import { app } from "./app/src/main.ts";           // the sprig app from bootstrap()

export default serveSprig({ keep: api, app, base: "/ui" });
//   deno serve -A --unstable-kv serve.ts   →   http://localhost:8000/ui
```

`keep` is a `KeepApi`:

- `backend: { fetch }` — the **in-process** client (no TCP, **bypasses token auth**); bound to
  the `Backend` token for SSR. **SSR-only.**
- `handler: (req, info) => Response` — the **network** handler (token-gated); reachable at
  `/api/*`.

Config: `base` (default `"/ui"`), `apiPrefix` (`"/api"`), `docsPrefix` (`"/docs"`),
`assetsDir` (`"static"`). `serveSprig` throws if `base` collides with `apiPrefix`/`docsPrefix`.

## Dispatch table

| path | handler |
|---|---|
| `<base>/_assets/*` | built static files from `assetsDir`, with ETag (conditional GETs 304). `cache-control` is `public, max-age=31536000, immutable` **only for content-addressed requests** — a `?v=` equal to the served dir's current content hash, or a content-hash-named `chunk-*.js`; anything else (stale/missing `?v=`) gets `no-cache` so a browser can never pin an outdated bundle across redeploys |
| `/api/*` | keep network handler, **prefix stripped**, `info` forwarded — token-gated (never `backend.fetch`) |
| `/docs*` | keep handler, **unstripped** (Swagger UI references `/docs/*` absolutely) |
| everything else | the sprig SSR app, with the in-process `Backend` threaded in |

The `/api` channel is forbidden from aliasing the `/docs` surface (returns 404). Static assets
answer only `GET`/`HEAD`; a real `..` path **segment** is rejected (403).

## The `/api` hardening gateway

Before forwarding a body-bearing `/api/*` request, `serveSprig` validates it so malformed
input becomes a clean **4xx**, never a 500 leaking a parser/stack error:

- **Forbidden methods** `TRACE`/`TRACK`/`CONNECT` → **405** up front (they can't be carried by
  a re-wrapped `Request` at all).
- Non-`application/json` content-type on a non-empty body → **415**.
- Body over **4 MiB**, or JSON nesting deeper than **200** → **400** (the depth scan is
  iterative, so a deeply-nested body can't exhaust the stack while checking it).
- Malformed JSON → **400**.

Valid requests are rebuilt against the stripped path and passed to `keep.handler` with the
original `info`.

## No-backend starter

`sprig init` scaffolds a `serve.ts` with a **no-op keep** so the app runs with zero backend:

```ts
const keep = {
  backend: { fetch: () => Promise.resolve(new Response("null", { headers: { "content-type": "application/json" } })) },
  handler: () => new Response("Not Found", { status: 404 }),
};
export default serveSprig({ keep, app, base: "/ui" });
```

Swap in a real keep `api` (`serveSprig({ keep: api, app, base })`) to get an in-process
`Backend` for `resolve.ts` plus the live `/api/*` network channel.

The `?v=` cache-buster is the content hash of `assetsDir` (the `.js` files + `app.css`).
`serveSprig`/`sprigUi` compute it from the dir they **actually serve** and thread it into the
renderer via `env.assetsVersion`, so the rendered asset URLs, the immutable check, and the
served bytes can never disagree — a redeploy changes the hash, every returning browser fetches
the new bundle, and a stale `?v=` degrades to `no-cache` revalidation instead of a year-long
pin. A standalone renderer (no serveSprig/sprigUi) falls back to hashing
`SPRIG_ASSETS_DIR`/`<cwd>/static` and warns once if that fails (`?v=dev`, long-term caching off).

---

**Next:** [testing.md](./testing.md) — the three test seams.
**See also:** [data-and-di.md](./data-and-di.md) · [routing.md](./routing.md)
