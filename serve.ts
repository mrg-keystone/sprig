// The single-origin composition root: one serveSprig() handler that mounts the
// isolate keep `server` backend (in-process Backend for SSR + the token-gated
// /api/* network channel) and the sprig `app` UI at /ui. Deno-Deploy ready.
//   deno serve -A --unstable-kv serve.ts
import { fromFileUrl } from "@std/path";
import { serveSprig } from "@mrg-keystone/sprig/keep";
import { api } from "./server/bootstrap/mod.ts"; // keep: bootstrapServer already awaited at module scope
import { app } from "./app/src/main.ts"; // sprig: bootstrap({ routes })

// base "" → the shell at / and component previews at /components/… (so the
// copied Playwright specs' `page.goto("/components/…")` resolve, and the stage
// iframe is same-origin with no prefix).
//
// assetsDir must be explicit: the workbench app builds into app/static, while
// deriveUiDir's entry anchor would resolve <repo>/static — which doesn't exist,
// so every /_assets/* request 404'd and preview pages rendered UNSTYLED
// (computed-style assertions in `isolate test` saw initial values, e.g.
// animationName "none").
export default serveSprig({
  keep: api,
  app,
  base: "",
  assetsDir: fromFileUrl(new URL("./app/static", import.meta.url)),
});
