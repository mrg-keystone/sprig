# Common Patterns (Cheatsheet)

> Source: https://fresh.deno.dev/docs/examples/common-patterns

## Protected route
```ts
export default define.middleware(async (ctx) => {
  const session = await getSession(ctx.req);
  if (!session) return ctx.redirect("/login");
  ctx.state.user = session.user;
  return ctx.next();
});
```

## Permanent redirects (URL migration)
```ts
const REDIRECTS: Record<string, string> = { "/old-page": "/new-page" };
const target = REDIRECTS[ctx.url.pathname];
if (target) return ctx.redirect(target, 301);
```

## Content negotiation (HTML vs JSON)
```ts
const accept = ctx.req.headers.get("Accept") ?? "";
if (accept.includes("text/html")) return ctx.render(<UserProfile user={user} />);
return Response.json(user);
```

## Setting cookies
```ts
setCookie(response.headers, {
  name: "theme", value: "light", httpOnly: true, sameSite: "Lax",
});
```

## Reading query params
```ts
const q = ctx.url.searchParams.get("q") ?? "";
const page = Number(ctx.url.searchParams.get("page") ?? "1");
```

## Setting response headers
```ts
response.headers.set("X-Frame-Options", "DENY");
response.headers.set("Cache-Control", "public, max-age=3600");
```

## Streaming
```ts
const body = new ReadableStream({
  start(c) { c.enqueue(new TextEncoder().encode("Hello ")); /* … */ },
});
return new Response(body, { headers: { "Content-Type": "text/plain" } });
```

## WebSockets
See `advanced/websockets.md`.

## Subdomain routing
```ts
const PAT = new URLPattern({ hostname: ":sub.example.com" });
const m = PAT.exec(ctx.req.url);
const sub = m?.hostname.groups.sub;
```

## Proxying
```ts
const url = new URL(ctx.params.path, "https://api.example.com");
return await fetch(url, { headers: ctx.req.headers });
```

## Lazy-loaded island content
```ts
import { lazy, Suspense } from "preact/compat";
const Chart = lazy(() => import("../components/Chart.tsx"));
<Suspense fallback={<p>Loading…</p>}><Chart /></Suspense>
```

## Server-Timing middleware
```ts
const start = performance.now();
const res = await ctx.next();
res.headers.set("Server-Timing", `total;dur=${(performance.now()-start).toFixed(1)}`);
return res;
```

## See also
- `examples/session-management.md`
- `concepts/middleware.md`, `concepts/context.md`
- `advanced/websockets.md`
