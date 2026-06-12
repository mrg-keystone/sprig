# API Routes

> Source: https://fresh.deno.dev/docs/examples/api-routes

## TL;DR
Files under `routes/api/` that export only `handlers` (no default page) become JSON endpoints. Use `Response.json()`. Undefined methods → 405. `routes/api/[id].ts` → `:id` via `ctx.params.id`.

## Per-method
```ts
// routes/api/users.ts
import { define } from "../../utils.ts";

export const handlers = define.handlers({
  GET(ctx) {
    return Response.json(users);
  },
  async POST(ctx) {
    const body = await ctx.req.json();
    const user = await db.users.create(body);
    return Response.json(user, { status: 201 });
  },
});
```

## With params
```ts
// routes/api/posts/[id].ts
async GET(ctx) {
  const post = await db.posts.find(ctx.params.id);
  if (!post) return Response.json({ error: "Not found" }, { status: 404 });
  return Response.json(post);
}
```

## Single function (any method)
```ts
export const handlers = define.handlers((ctx) => Response.json({ ok: true }));
```

## Programmatic
```ts
const app = new App()
  .get("/api/time", () => Response.json({ time: new Date().toISOString() }));
```

## See also
- `concepts/data-fetching.md`
- `concepts/file-routing.md`
