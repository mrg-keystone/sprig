# Error Handling

> Source: https://fresh.deno.dev/docs/advanced/error-handling

## TL;DR
Throw `HttpError(status, message?)` from a handler/middleware to short-circuit. Render error pages with `routes/_error.tsx` (Fresh 2 unified — replaces `_404.tsx` + `_500.tsx`). Programmatic: `app.onError()` for generic errors, `app.notFound()` for 404 specifically.

## HttpError
```ts
import { HttpError } from "fresh";

throw new HttpError(404);
throw new HttpError(403, "Admin access required");
```

## `_error.tsx`
```tsx
import { HttpError } from "fresh";
import { define } from "../utils.ts";

export default define.page(({ error, url }) => {
  if (error instanceof HttpError && error.status === 404) {
    return <h1>Not found: {url.pathname}</h1>;
  }
  return <h1>Server error</h1>;
});
```
Place at `routes/_error.tsx` for the root, or in subdirectories for scoped error pages.

## Programmatic
```ts
app.onError((ctx) => {
  console.error(ctx.error);
  return new Response("Boom", { status: 500 });
});

app.notFound((ctx) => new Response("Nope", { status: 404 }));
```
- `onError` can be nested per route subtree.
- `notFound` cannot be nested — it's app-global.

## Inside an error handler
- `ctx.error` holds the thrown value.
- Check `instanceof HttpError` to read the intended status.
- Always set the matching status on the `Response`.

## See also
- `concepts/middleware.md` — throwing from middleware
- `migration-guide.md` — Fresh 1 split error pages → 2 unified
