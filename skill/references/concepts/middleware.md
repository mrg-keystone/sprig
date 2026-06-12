# Middleware

> Source: https://fresh.deno.dev/docs/concepts/middleware

## TL;DR
Middleware = `(ctx) => Promise<Response>`. Call `await ctx.next()` to invoke the next handler in the chain. Drop a `_middleware.ts` in any `routes/` directory to scope it to that subtree, or register globally via `app.use()`.

## Signature
```ts
import { define } from "../utils.ts";

export default define.middleware(async (ctx) => {
  console.log("request:", ctx.url.pathname);
  return await ctx.next();
});
```

## Modifying state for downstream
```ts
export default define.middleware((ctx) => {
  ctx.state.greeting = "Hello world";
  return ctx.next();
});
```

## Modifying response on the way out
```ts
export default define.middleware(async (ctx) => {
  const res = await ctx.next();
  res.headers.set("server", "fresh");
  return res;
});
```

## Multiple middlewares per file
```ts
export default [auth, rateLimit, logger];
```
They run in array order.

## Scoping
- `routes/_middleware.ts` → applies to every route under `routes/`.
- `routes/admin/_middleware.ts` → only `routes/admin/**`.
- `app.use(mw)` in `main.ts` → applies globally before fs routes.

## Order
Definition order is execution order. A middleware declared after a `.get()` won't run for that GET.

## Gotchas
- **Forgetting `await ctx.next()`** silently breaks everything downstream.
- Don't mutate `ctx.req` (it's the original Request).
- For per-request data, use `ctx.state`, not module-level variables.

## See also
- `concepts/context.md` — `ctx.state`, `ctx.next`
- `concepts/app.md` — `app.use()` registration
- `examples/session-management.md`
