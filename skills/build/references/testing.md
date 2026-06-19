# Testing

> Source: https://fresh.deno.dev/docs/testing

## TL;DR
Use Deno's built-in test runner. Build a tiny `App`, register the route/middleware under test, get a request handler via `.handler()`, and `await` it on a synthetic `Request`. Server-side coverage is usually enough; only spin up a real browser when island interactivity is non-trivial.

## Testing a route handler
```ts
import { App } from "fresh";

Deno.test("API route returns name", async () => {
  const app = new App<State>()
    .get("/api/:name", apiHandler.GET)
    .handler();

  const response = await app(new Request("http://localhost/api/joe"));
  expect(await response.text()).toEqual("Hello, Joe!");
});
```

## Testing middleware
Mount the middleware, then a dummy route that exposes the state it touched:
```ts
Deno.test("middleware sets ctx.state.text", async () => {
  const handler = new App<State>()
    .use(middleware)
    .get("/", (ctx) => new Response(ctx.state.text || ""))
    .handler();

  const res = await handler(new Request("http://localhost"));
  expect(await res.text()).toEqual("middleware text");
});
```

## Testing islands
- **SSR side:** assert against the rendered HTML using the `App` pattern above.
- **Client-side interactivity:** requires a real build + browser. Helpers like `buildFreshApp()` and `startTestServer()` are suggested patterns (not built-in). Only do this when island logic is complex.

## Gotchas
- `App<State>` generic must match your real `State` type or middleware-typed access will fail.
- `app.handler()` is a function — call it with a `Request`, don't pass it to `serve`.
- Tests share global state if you use top-level singletons; instantiate per-test.

## See also
- `concepts/middleware.md`, `concepts/context.md` for `State` typing
- `concepts/app.md` for the `App` builder API
