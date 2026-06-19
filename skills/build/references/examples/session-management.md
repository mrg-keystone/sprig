# Session Management

> Source: https://fresh.deno.dev/docs/examples/session-management

## TL;DR
Read/write cookies via Deno std `getCookies` / `setCookie`. A middleware ensures every request has a `session` ID in `ctx.state` and writes the cookie on first contact. Production: store session-keyed data in a DB and set `secure: true`.

## Middleware
```ts
import { getCookies, setCookie } from "jsr:@std/http/cookie";
import { define } from "../utils.ts";

export interface SessionState { session: string }

export default define.middleware(async (ctx) => {
  const cookies = getCookies(ctx.req.headers);
  const existing = cookies["session"];
  const session = existing ?? crypto.randomUUID();
  ctx.state.session = session;

  const res = await ctx.next();
  if (!existing) {
    setCookie(res.headers, {
      name: "session",
      value: session,
      path: "/",
      httpOnly: true,
      sameSite: "Lax",
      // secure: true,   // enable in production
    });
  }
  return res;
});
```

## Login (sketch)
```ts
import { page } from "fresh";

async POST(ctx) {
  const form = await ctx.req.formData();
  const user = await authenticate(form.get("email"), form.get("password"));
  // page({...}), not ctx.render({...}) — in Fresh 2 ctx.render takes JSX and
  // crashes on a data object. Return data through page() to re-render with it.
  if (!user) return page({ error: "Bad creds" }, { status: 401 });

  await sessionStore.set(ctx.state.session, { userId: user.id });
  return new Response(null, { status: 303, headers: { Location: "/" } });
}
```

## Logout
```ts
async POST(ctx) {
  await sessionStore.delete(ctx.state.session);
  const res = new Response(null, { status: 303, headers: { Location: "/" } });
  setCookie(res.headers, { name: "session", value: "", path: "/", maxAge: 0 });
  return res;
}
```

## See also
- `concepts/middleware.md`
- `examples/common-patterns.md` — protected routes pattern
- `plugins/csrf.md`
