// A faithful copy of the real-world "magic-link handshake" auth guard (the shape
// alfred shipped, and the shape sprig's own GuardCtx invites — it hands the guard
// `url` incl. the query string, and documents cookies as the way server-side auth
// works). The guard is the ONLY layer that can see the auth cookie: ResolveCtx is
// `{ params, url }` with no headers, so once the guard passes there is no second
// gate before the page's data is rendered.
import type { Guard } from "@sprig/core";

export const AUTH_COOKIE = "app_auth";

/** Anonymous visitors are redirected to /login. A `?token=<bearer>` link is the
 *  login handshake — let it through so the CLIENT can seed the bearer + cookie and
 *  strip the query. This single line is the leak: the guard passes on the mere
 *  PRESENCE of a `token` param, and a guard-pass makes bootstrap() run resolve()
 *  against the trusted in-process Backend and embed the result in the SSR HTML —
 *  before the client has proven anything. */
export const requireLogin: Guard = (ctx) => {
  if (ctx.url.searchParams.has("token")) return ctx.path; // ← handshake pass-through
  const cookies = ctx.headers.get("cookie") ?? "";
  const authed = cookies.split(/;\s*/).some((c) => c.startsWith(`${AUTH_COOKIE}=`));
  return authed ? ctx.path : ["login"];
};
