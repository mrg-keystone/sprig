// Single-origin composition root: serveSprig folds the keep backend + the sprig UI
// into ONE { fetch } that `deno serve` drives — no Deno.serve()/app.listen() of your
// own:  deno serve -A --unstable-kv serve.ts
//   /api/* + /docs*  → the keep backend (token-gated; the channel browser islands use).
//   everything else  → the SSR app, with keep's in-process client bound to the Backend
//                      DI token — pages read data via inject(Backend), no TCP, no token.
import { serveSprig } from "@mrg-keystone/sprig/keep";
import { api } from "./bootstrap/mod.ts";
import { sprigApp } from "$";

export default serveSprig({ keep: api, app: sprigApp, base: "/ui" });
