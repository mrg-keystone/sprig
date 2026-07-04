// The guards. A guard returns the route — as path segments — the navigation
// should go to: return `ctx.path` (the route it was going to hit anyway) to
// proceed, any other route to answer with a 302 there. `inject()` works
// synchronously inside a guard; it runs on the same route injector the page's
// resolve() gets, so a service instantiated here is the same instance there.
import { type Guard, inject } from "@mrg-keystone/sprig";
import { Session } from "./services/session.ts";

/** Anyone logged in may pass; anonymous → /login. Guards the whole /admin tree. */
export const requireAuth: Guard = (ctx) => {
  const session = inject(Session);
  if (!session.user) return ["login"];
  return ctx.path;
};

/** Only "admin" may pass; others → /denied. Async on purpose: a real role check
 *  would await a lookup. Capture injected deps BEFORE the first await. */
export const requireAdmin: Guard = async (ctx) => {
  const session = inject(Session);
  const role = await Promise.resolve(session.user); // stand-in for a permission lookup
  if (role !== "admin") return ["denied"];
  return ctx.path;
};

/** Action guard: /go/login/:user signs you in, then ALWAYS redirects to /admin.
 *  The route has no `load` — it never renders; the guard IS the behavior. */
export const loginAs: Guard = (ctx) => {
  inject(Session).login(ctx.params.user);
  return ["admin"];
};

/** Action guard: /go/logout clears the session and sends you home ([] = root). */
export const logout: Guard = () => {
  inject(Session).logout();
  return [];
};
