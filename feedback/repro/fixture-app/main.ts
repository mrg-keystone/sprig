// Minimal sprig app used by the repro scripts: one shell + one page island.
import { bootstrap, defineRoutes, type SprigApp } from "@sprig/core";
import { createRenderer } from "@sprig/keep";
import { dirname, fromFileUrl, join } from "@std/path";

export async function makeApp(): Promise<SprigApp> {
  const srcDir = join(dirname(fromFileUrl(import.meta.url)), "src");
  const renderer = await createRenderer(srcDir, "/ui", {});
  return bootstrap({
    routes: defineRoutes([{ path: "", load: "pages/home" }]),
    base: "/ui",
    renderer,
  });
}
