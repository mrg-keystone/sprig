// Minimal fixture demonstrating sprig's BUILT-IN auth (login(), getUserData(),
// logout() re-exported from @mrg-keystone/sprig). One route: the login page.
import { bootstrap, defineRoutes, type Route, type SprigApp } from "@mrg-keystone/sprig";
import { createRenderer } from "@mrg-keystone/sprig/keep";
import { dirname, fromFileUrl } from "@std/path";

export const routes: Route[] = defineRoutes([
  { path: "", load: "pages/login" },
]);

export const renderer = await createRenderer(
  dirname(fromFileUrl(import.meta.url)), // src/ root
  "/ui",
  { dev: !!Deno.env.get("SPRIG_DEV") },
);

export const sprigApp: SprigApp = bootstrap({ routes, base: "/ui", renderer });
