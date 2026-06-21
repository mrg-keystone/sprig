// THE deno-serve / Deno-Deploy entry. One single-origin handler; the whole
// composition is one call. Run:  deno serve -A --unstable-kv serve.ts
import { serveSprig } from "@sprig/keep";
import { api } from "@app/backend"; // keep: bootstrapServer already awaited at module scope
import { app } from "@app/ui"; // sprig: bootstrap({ routes })

export default serveSprig({ keep: api, app, base: "/ui" });
