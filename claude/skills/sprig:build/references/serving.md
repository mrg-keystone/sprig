# Serving & mounting the UI

`@mrg-keystone/sprig/keep` is the server glue. It exposes the SSR renderer (`createRenderer`) and two
ways to serve the app. In dev you don't write any of this — `sprig dev` serves the app with
HMR. For production the scaffold writes a `serve.ts` host file.

## `serveSprig` — the single-origin composition root (the scaffold default)

A sprig app runs **on** a keep backend (`@mrg-keystone/rune`), wired natively to its
in-process client — no HTTP between the UI and its own backend. `serveSprig({ keep, app,
base })` returns one `{ fetch }` default export that **`deno serve` drives** — there is no
`Deno.serve()` and no `app.listen()` of your own:

```ts
// serve.ts —  run it with:  deno serve -A --unstable-kv serve.ts
import { serveSprig } from "@mrg-keystone/sprig/keep";
import { api } from "./bootstrap/mod.ts"; // the keep backend: await bootstrapServer(...)
import { sprigApp } from "$";             // the sprig app: bootstrap({ routes, renderer })

export default serveSprig({ keep: api, app: sprigApp, base: "" });
```

Dispatch (you write none of it):

- `/api/*` → the keep backend's **token-gated network handler** (prefix stripped). This is
  the channel browser **islands** use (`fetch("/api/…")`) — the only HTTP hop, and it is
  unavoidable: a browser can't make in-process calls.
- `/docs*` → the backend's Swagger/emulator UI.
- `<base>/_assets/*` → the built client assets.
- everything else → the **sprig SSR app**, with keep's **in-process client bound to the
  `Backend` DI token**. So a page's `resolve.ts`/service reads data with `inject(Backend)` —
  no TCP, no token, straight through the backend pipeline.

This is what `sprig init` scaffolds (and what `rune init` scaffolds for a spec-driven
backend). The keep backend is `const api = await bootstrapServer("app", modules, {})`; it is
imported, **not** listened on — `deno serve serve.ts` owns the single socket.

## `sprigUi` — mount the UI inside an existing host

When you already have a host (Danet/Oak/Hono/bare `Deno.serve`) and want sprig to own only a
sub-path, `sprigUi({ app, base })` returns a function that handles anything under `base` (the
built assets at `<base>/_assets/*` + the SSR app) and returns **`null` to pass through** when
the request isn't ours.

```ts
// bare Deno.serve — host owns everything but /ui:
import { sprigUi } from "@mrg-keystone/sprig/keep";
const ui = sprigUi({ app, base: "/ui", backend: api.backend }); // backend → inject(Backend) for SSR
export default {
  fetch: (req: Request, info: Deno.ServeHandlerInfo) =>
    ui(req, info).then((r) => r ?? new Response("Not Found", { status: 404 })),
};
```

It composes the same way into Danet (`app.use(async (ctx, next) => (await ui(ctx.req.raw)) ?? next())`),
Oak (`ctx.request.source`), or Hono (`(await ui(c.req.raw)) ?? next()`). Pass `backend:
{ fetch }` (the host's in-process client) to thread `inject(Backend)` for SSR data loading;
`assetsDir` defaults to `"static"`. Prefer `serveSprig` unless you're embedding under a host
you don't control.

## The typed client — data across the waist (bridge 2)

When the backend is spec-driven (a ratified contract at the git root), the scaffold
generates a **typed client** from the rune OpenAPI (`spec/contract/openapi.json`) into
`spec/contract/client/` — via the `contract client` CLI (`@dev-tools/contract`) —
`dtos.ts` (one TS type per DTO) + `client.ts` (one wrapper per
endpoint: **queries** are reads, **commands** are intent writes — never an
edit-this-record call; the waist rule of the sprig repo's `contract.md`). Every wrapper
takes a `{ fetch }` backend, so both channels reuse it:

- **SSR** (`resolve.ts` / services) passes `inject(Backend)` — in-process, no HTTP.
- **Islands** pass a `/api/*`-prefixed `fetch` — the one unavoidable HTTP hop.

Import the generated DTO types — no hand-typed shapes, no bare string routes. When the
backend contract changes, regenerate the client (the OpenAPI is the source); type errors
at the import sites are the drift alarm doing its job.

## The build output

`sprig build` (or `deno task build`) writes `static/`: `client.js` (the hydration runtime),
`isl.<sel>.js` (one code-split chunk per island), shared `chunk-*.js`, scoped `app.css`, and
`templates.json` (the prebuilt serialized templates — so the runtime never parses HTML).
Assets are content-hash cache-busted via `?v=`. **Run the production path before shipping**:
`deno task build` then `deno task start`, and hit a real URL.
