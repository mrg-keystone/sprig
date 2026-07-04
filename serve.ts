// The single-origin composition root: one serveSprig() handler that mounts the
// isolate keep `server` backend (in-process Backend for SSR + the token-gated
// /api/* network channel) and the sprig `app` UI at /ui. Deno-Deploy ready.
//   deno serve -A --unstable-kv serve.ts
import { serveSprig } from "@mrg-keystone/sprig/keep";
import { api } from "./server/bootstrap/mod.ts"; // keep: bootstrapServer already awaited at module scope
import { app } from "./app/src/main.ts"; // sprig: bootstrap({ routes })

// base "" → the shell at / and component previews at /components/… (so the
// copied Playwright specs' `page.goto("/components/…")` resolve, and the stage
// iframe is same-origin with no prefix).
export default serveSprig({ keep: api, app, base: "" });
