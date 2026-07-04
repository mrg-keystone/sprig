// A tiny app whose point is the `guards:` column of the route table:
//   /admin, /admin/users  — requireAuth (users INHERITS it from the parent route)
//   /admin/danger         — requireAuth (inherited) THEN requireAdmin (own, async)
//   /go/login/:user, /go/logout — "action" routes: no `load`, their guard always
//                                 redirects, so the guard IS the whole behavior
import { bootstrap, defineRoutes, type Route, type SprigApp } from "@mrg-keystone/sprig";
import { createRenderer } from "@mrg-keystone/sprig/keep";
import { dirname, fromFileUrl } from "@std/path";
import { loginAs, logout, requireAdmin, requireAuth } from "./guards.ts";

export const routes: Route[] = defineRoutes([
  { path: "", load: "pages/home" },
  { path: "login", load: "pages/login" },
  { path: "denied", load: "pages/denied" },
  { path: "go/login/:user", guards: [loginAs] },
  { path: "go/logout", guards: [logout] },
  {
    path: "admin",
    load: "pages/admin",
    guards: [requireAuth], // protects /admin AND every child below
    children: [
      { path: "users", load: "pages/admin-users" }, // inherits requireAuth
      { path: "danger", load: "pages/admin-danger", guards: [requireAdmin] }, // chain: auth → admin
    ],
  },
]);

export const renderer = await createRenderer(
  dirname(fromFileUrl(import.meta.url)), // src/ root
  "/ui",
  { dev: !!Deno.env.get("SPRIG_DEV") },
);

// base "/ui" (the scaffold/dev-server convention). Note the guards still return
// APP-RELATIVE routes (["login"], not ["ui","login"]) — the framework prefixes
// the base onto the redirect Location.
export const sprigApp: SprigApp = bootstrap({ routes, base: "/ui", renderer });
