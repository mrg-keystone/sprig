# Serving & mounting the UI

`@sprig/keep` is the server glue. It exposes the SSR renderer (`createRenderer`) and two
ways to serve the app. In dev you don't write any of this — `sprig dev` serves the app with
HMR. For production the scaffold writes a host file.

## `sprigUi` — mount the UI as middleware (the scaffold default)

`sprigUi({ app, base })` returns a function that handles anything under `base` (the built
assets at `<base>/_assets/*` + the SSR app) and returns **`null` to pass through** when the
request isn't ours. That makes it host-agnostic — the host owns every other route; sprig
owns `/ui`.

```ts
import { sprigUi } from "@sprig/keep";
const ui = sprigUi({ app, base: "/ui" });

// bare Deno.serve:
export default {
  fetch: (req: Request, info: Deno.ServeHandlerInfo) =>
    ui(req, info).then((r) => r ?? new Response("Not Found", { status: 404 })),
};
```

The scaffold mounts it inside a **Danet** host via `app.use(ui)` (`jsr:@danet/core`):

```ts
import { DanetApplication, Module } from "@danet/core";
import { sprigUi } from "@sprig/keep";
import { app as sprigApp } from "./src/main.ts";

@Module({}) class AppModule {}
const ui = sprigUi({ app: sprigApp, base: "/ui" });

const app = new DanetApplication();
app.use(async (ctx, next) => {           // Danet runs on Hono → ctx.req.raw is the Request
  const res = await ui(ctx.req.raw);
  if (res) return res;                   // /ui → sprig
  await next();                          // else → your Danet controllers
});
await app.init(AppModule);
await app.listen(Number(Deno.env.get("PORT") ?? 3000));
```

It composes the same way into Oak (`ctx.request.source`) or Hono
(`app.use(async (c, next) => (await ui(c.req.raw)) ?? (await next()))`).

`sprigUi` optionally takes a `backend: { fetch }` (the host's in-process client, threaded
into `inject(Backend)` for SSR data loading) and `assetsDir` (default `"static"`).

## `serveSprig` — all-in-one single origin

When sprig owns the whole origin and fronts a "keep" backend, `serveSprig({ keep, app,
base })` returns one `{ fetch }` that routes `/api/*` to the backend (token-gated),
`/docs*` to its docs, `<base>/_assets/*` to the built assets, and everything else to the
SSR app with the in-process `Backend` threaded in.

## The build output

`sprig build` (or `deno task build`) writes `static/`: `client.js` (the hydration runtime),
`isl.<sel>.js` (one code-split chunk per island), shared `chunk-*.js`, scoped `app.css`, and
`templates.json` (the prebuilt serialized templates — so the runtime never parses HTML).
Assets are content-hash cache-busted via `?v=`. **Run the production path before shipping**:
`deno task build` then `deno task start`, and hit a real URL.
