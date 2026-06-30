// The whole app, three declarations. `routes` drive everything: a route's `load`
// names a page folder (template.html + optional logic.ts class for its data/behavior)
// — no per-page imports, no module map. Add a page = add a route.
import {
  bootstrap,
  defineRoutes,
  type Route,
  type SprigApp,
} from "@sprig/core";
import { createRenderer } from "@sprig/keep";
import { dirname, fromFileUrl } from "@std/path";

export const routes: Route[] = defineRoutes([
  { path: "", load: "pages/home" },
  { path: "widget/:id", load: "pages/widget" },
]);

export const renderer = await createRenderer(
  dirname(fromFileUrl(import.meta.url)), // src/ root
  "/ui",
  { dev: !!Deno.env.get("SPRIG_DEV") },
);

export const sprigApp: SprigApp = bootstrap({ routes, base: "/ui", renderer });
