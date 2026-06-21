// The sprig UI member: the route table + the app. Each page's resolve.ts reads
// data in-process via inject(Backend); the wasm-backed template compiler renders
// the matched folder-component into the shell's <router-outlet>.
import { bootstrap, defineRoutes, type Route, type SprigApp } from "@sprig/core";
import { dirname, fromFileUrl } from "@std/path";
import { createRenderer, type SsrRenderer } from "../.sprig/compiler/mod.ts";
import { resolve as dashboardResolve } from "./pages/dashboard/resolve.ts";
import { resolve as boardResolve } from "./pages/board/resolve.ts";
import { resolve as issueResolve } from "./pages/issue/resolve.ts";
import { resolve as userResolve } from "./pages/user/resolve.ts";

// src/ layout: pages/ (routed, static) · shared-components/ · services/ (@Injectable
// data layer). A route's `load` resolves to a page by its folder name (basename).
export const routes: Route[] = defineRoutes([
  { path: "", load: "./pages/dashboard" },
  { path: "board", load: "./pages/board" },
  { path: "issues/:id", load: "./pages/issue" },
  { path: "users/:id", load: "./pages/user" },
]);

// scan src/ for folder-components and build the SSR renderer (once, at boot).
// `sprig dev` sets SPRIG_DEV=1 → the renderer re-parses templates live for HMR.
export const renderer: SsrRenderer = await createRenderer(
  dirname(fromFileUrl(import.meta.url)),
  "/ui",
  { dev: !!Deno.env.get("SPRIG_DEV") },
);

export const app: SprigApp = bootstrap({
  routes,
  base: "/ui",
  modules: {
    "./pages/dashboard": { resolve: dashboardResolve },
    "./pages/board": { resolve: boardResolve },
    "./pages/issue": { resolve: issueResolve },
    "./pages/user": { resolve: userResolve },
  },
  render: (load, inputs) => renderer.renderDocument(load, inputs),
});
