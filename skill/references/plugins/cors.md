# cors

> Source: https://fresh.deno.dev/docs/plugins/cors

## TL;DR
Adds CORS headers. Configure origins, methods, headers, credentials, preflight cache.

## Basic
```ts
import { App, cors } from "fresh";

const app = new App().use(cors({
  origin: "http://example.com",
  allowHeaders: ["X-Custom-Header"],
  allowMethods: ["GET", "POST", "OPTIONS"],
  credentials: true,
  maxAge: 600,
}));
```

## Options
| Option | Purpose |
|---|---|
| `origin` | Allowed origin(s) — string or function/array (varies; see jsr.io/@fresh/core) |
| `allowMethods` | Methods allowed in CORS requests |
| `allowHeaders` | Custom request headers permitted |
| `exposeHeaders` | Response headers exposed to client |
| `credentials` | Allow `Authorization` / cookies cross-origin |
| `maxAge` | Preflight cache TTL (seconds) |

## See also
- `plugins/csrf.md` — pair with CORS when allowing cross-site state-changing requests
- `advanced/api-reference.md` — `CORSOptions`
