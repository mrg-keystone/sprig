# Cloudflare Workers

> Source: https://fresh.deno.dev/docs/deployment/cloudflare-workers

## TL;DR
Add `@cloudflare/vite-plugin` + `wrangler`, expose Fresh's server as a Worker `fetch` handler, point `wrangler.jsonc` at it.

## Install
```
deno install --allow-scripts npm:@cloudflare/vite-plugin npm:wrangler
```

## `vite.config.ts`
```ts
import { defineConfig } from "vite";
import { fresh } from "@fresh/plugin-vite";
import { cloudflare } from "@cloudflare/vite-plugin";

export default defineConfig({
  plugins: [fresh(), cloudflare()],
});
```

## `server.js` (worker entry)
```js
import server from "./_fresh/server.js";

export default {
  fetch: server.fetch,
};
```

## `wrangler.jsonc`
```jsonc
{
  "main": "./server.js"
  // …other Worker config
}
```

## Caveats
- Workers' execution-time and websocket limits apply. Long-lived sockets may need Durable Objects.
- File-system APIs in Deno aren't available in Workers; ensure code paths don't read the FS at runtime.

## See also
- Cloudflare's vite-plugin docs (canonical source for plugin options)
- `advanced/vite.md` — composing plugins
- `advanced/websockets.md`
