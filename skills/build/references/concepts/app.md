# App

> Source: https://fresh.deno.dev/docs/concepts/app

## TL;DR
`App` is the root server builder. Fluent/chainable. Constructor takes config; methods register middleware, routes, layouts, error handlers; `.handler()` returns a `(Request) => Response` for tests/`deno serve`; `.listen()` starts a server directly.

## Constructor
```ts
const app = new App<State>({
  basePath: "/my-app",   // prefixes every route
  trustProxy: true,      // honor X-Forwarded-* headers
});
```

## Methods

| Method | Purpose |
|---|---|
| `.use(...mws)` | Register one or more middlewares (root or path-scoped, lazy supported) |
| `.appWrapper(C)` | Set outer HTML wrapper (replaces `_app.tsx` programmatically) |
| `.get/.post/.put/.delete/.head/.patch/.options/.all(path, ...mws, handler)` | Register HTTP handlers; HEAD falls back to GET if absent; unmatched method → 405 |
| `.fsRoutes()` / `.fsRoute()` | Inject filesystem-routed pages, middleware, layouts, errors |
| `.route(path, component, handlers?)` | Register a route programmatically |
| `.layout(path, C)` | Register a layout at a path |
| `.mountApp(path, otherApp)` | Mount a child `App` instance |
| `.onError(fn)` | Catch errors |
| `.notFound(fn)` | 404 handler |
| `.handler()` | Returns request handler (for tests / `deno serve`) |
| `.listen(opts?)` | Start server in-process (use with `deno run`) |

## Order matters
Items apply top-to-bottom. Middleware declared **after** a `.get()` does not apply to that route.

```ts
const app = new App()
  .use(staticFiles())
  .get("/", () => new Response("hello"))
  .fsRoutes();

app.listen({ port: 3000 });
```

## Generic State
```ts
interface State { user?: { id: string } }
const app = new App<State>();
```
`ctx.state` is typed as `State` everywhere.

## Production
For production, prefer `deno serve -A _fresh/server.js` (the build emits a server entry). `app.listen()` is the dev/in-process path.

## See also
- `concepts/middleware.md`
- `concepts/routing.md`, `concepts/file-routing.md`
- `advanced/error-handling.md`
