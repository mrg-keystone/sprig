// Minimal sprig app for the guard/SSR data-leak repro: a PUBLIC `login` page and a
// PROTECTED subtree (guarded by requireLogin) whose `overview` page loads real
// records through the in-process Backend. Mirrors the alfred route shape:
// login is reachable anonymously; everything else sits behind the login guard.
import {
  backendClient,
  bootstrap,
  type BackendClient,
  defineRoutes,
  type SprigApp,
} from "@sprig/core";
import { createRenderer } from "@sprig/keep";
import { dirname, fromFileUrl, join } from "@std/path";
import { requireLogin } from "./src/guards.ts";

/** The "protected" records. Each phone carries a unique marker the repro greps for
 *  in the SSR HTML — if it appears in an anonymous response, the data leaked. */
export const SECRET_CALLS = [
  { phone: "+1 555 0100 LEAK-MARKER-A", reason: "Refund outside cancellation window" },
  { phone: "+1 555 0101 LEAK-MARKER-B", reason: "Pricing the AI could not answer" },
];
export const LEAK_MARKER = "LEAK-MARKER-A";

/** A fake in-process Backend — stands in for keep's `backend.fetch`, which needs no
 *  auth (in-process is trusted). serveSprig binds the real one per request; here the
 *  repro binds this via `app.fetch(req, info, { backend })`. */
export function makeBackend(): BackendClient {
  return backendClient(() =>
    Promise.resolve(
      new Response(JSON.stringify({ calls: SECRET_CALLS }), {
        headers: { "content-type": "application/json" },
      }),
    )
  );
}

export async function makeApp(): Promise<SprigApp> {
  const srcDir = join(dirname(fromFileUrl(import.meta.url)), "src");
  const renderer = await createRenderer(srcDir, "/app", {});
  return bootstrap({
    routes: defineRoutes([
      { path: "login", load: "pages/login" },
      // The whole subtree sits behind requireLogin (a parent's guards protect its
      // children), exactly like alfred's mod.ts.
      {
        path: "",
        load: "pages/overview",
        guards: [requireLogin],
        children: [
          { path: "overview", load: "pages/overview" },
        ],
      },
    ]),
    base: "/app",
    renderer,
  });
}
