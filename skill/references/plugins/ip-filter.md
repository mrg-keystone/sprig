# ipFilter

> Source: https://fresh.deno.dev/docs/plugins/ip-filter

## TL;DR
Allow/deny by IP or CIDR. Deny rules win when both match. Returns `403` by default; customize via `onBlocked`. Supports IPv4 + IPv6.

## Basic
```ts
import { App, ipFilter } from "fresh";

const app = new App().use(ipFilter({
  denyList: ["192.168.1.10", "10.0.0.0/8"],
  allowList: ["192.168.1.0/24"],
}));
```

## Behavior
- **Deny list** → matching IPs get 403.
- **Allow list** (alone) → only matching IPs pass; everyone else blocked.
- **Both** → deny is checked first; an IP in both is blocked.

## Custom blocked response
```ts
app.use(ipFilter({
  denyList: ["…"],
  onBlocked: (ctx) => new Response("nope", { status: 401 }),
}));
```

## Behind a proxy
Pair with `App({ trustProxy: true })` so `ctx.info.remoteAddr` reflects `X-Forwarded-For` instead of the proxy IP.

## See also
- `concepts/app.md` — `trustProxy`
- `advanced/api-reference.md`
