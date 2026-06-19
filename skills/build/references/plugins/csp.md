# csp

> Source: https://fresh.deno.dev/docs/plugins/csp

## TL;DR
Sets `Content-Security-Policy`. Enable `useNonce: true` to swap `'unsafe-inline'` for per-request nonces — Fresh injects matching nonce attributes onto inline `<script>`/`<style>` automatically.

## Basic
```ts
import { App, csp } from "fresh";

const app = new App().use(csp({
  useNonce: true,
  csp: {
    "default-src": ["'self'"],
    "img-src": ["'self'", "data:"],
  },
}));
```

## Options
| Option | Purpose |
|---|---|
| `csp` | Map of directives → sources (overrides defaults) |
| `useNonce` | Generate per-request nonce; replaces `'unsafe-inline'` for scripts/styles |
| `reportOnly` | Use `Content-Security-Policy-Report-Only` (test mode) |
| `reportTo` | Endpoint for violation reports (e.g. `/api/csp-reports`) |

## Nonce details
- Fresh generates a fresh nonce per request.
- Auto-injected onto inline `<script>` / `<style>` during SSR.
- If you manually set a `nonce` attr, Fresh's value still wins in the header — keep manual nonces in sync or omit them.

## See also
- `advanced/api-reference.md` — `CSPOptions`
- `advanced/head.md`
