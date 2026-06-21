// The sprig UI member: route table + app. Each page's resolve.ts reads data
// in-process via inject(Backend) (the isolate keep `server`); the wasm-backed
// template compiler renders the matched folder-component into the shell outlet.
import { bootstrap, defineRoutes, type Route, type SprigApp } from "@sprig/core";
import { dirname, fromFileUrl } from "@std/path";
import { createRenderer, type SsrRenderer } from "../../framework/.sprig/compiler/mod.ts";
import { resolve as workbenchResolve } from "./pages/workbench/resolve.ts";
import { resolve as galleryResolve } from "./pages/gallery/resolve.ts";

export const routes: Route[] = defineRoutes([
  { path: "", load: "./pages/workbench" },
  { path: "components", load: "./pages/gallery" },
  { path: "pages", load: "./pages/gallery" },
]);

// scan app/src for folder-components and build the SSR renderer (once, at boot).
export const renderer: SsrRenderer = await createRenderer(
  dirname(fromFileUrl(import.meta.url)),
  "/ui",
  { dev: !!Deno.env.get("SPRIG_DEV") },
);

export const app: SprigApp = bootstrap({
  routes,
  base: "/ui",
  modules: {
    "./pages/workbench": { resolve: workbenchResolve },
    "./pages/gallery": { resolve: galleryResolve },
  },
  render: (load, inputs) => renderer.renderDocument(load, inputs),
});
