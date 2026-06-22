// The sprig UI member: route table + app. Each page's resolve.ts reads data
// in-process via inject(Backend) (the isolate keep `server`); the SSR renderer renders
// the matched folder-component (from the prebuilt template registry) into the shell.
import { bootstrap, defineRoutes, type Route, type SprigApp } from "@sprig/core";
import { createRenderer, type SsrRenderer } from "@sprig/keep";
import { dirname, fromFileUrl } from "@std/path";
import { resolve as workbenchResolve } from "./pages/workbench/resolve.ts";
import { resolve as galleryResolve } from "./pages/gallery/resolve.ts";

// Generated preview routes/resolvers (one per discovered case). Absent until
// `isolate` has generated them, so the import is best-effort.
// deno-lint-ignore no-explicit-any
let previewRoutes: Route[] = [];
// deno-lint-ignore no-explicit-any
let previewModules: Record<string, any> = {};
try {
  // variable path so `deno check` doesn't require the generated file to exist
  const genPath = "./pages/_preview/manifest.gen.ts";
  const gen = await import(genPath);
  previewRoutes = gen.routes;
  previewModules = gen.modules;
} catch { /* no previews generated yet */ }

export const routes: Route[] = defineRoutes([
  { path: "", load: "./pages/workbench" },
  { path: "components", load: "./pages/gallery" },
  { path: "pages", load: "./pages/gallery" },
  ...previewRoutes,
]);

// scan app/src for folder-components and build the SSR renderer (once, at boot).
export const renderer: SsrRenderer = await createRenderer(
  dirname(fromFileUrl(import.meta.url)),
  "",
  { dev: !!Deno.env.get("SPRIG_DEV") },
);

export const app: SprigApp = bootstrap({
  routes,
  base: "",
  modules: {
    "./pages/workbench": { resolve: workbenchResolve },
    "./pages/gallery": { resolve: galleryResolve },
    ...previewModules,
  },
  render: (load, inputs) => renderer.renderDocument(load, inputs),
  renderStream: (load, inputs) => renderer.renderStream(load, inputs),
});
