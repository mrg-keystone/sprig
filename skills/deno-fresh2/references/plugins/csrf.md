# csrf

> Source: https://fresh.deno.dev/docs/plugins/csrf

## TL;DR
Protects state-changing requests (POST/PUT/DELETE) by checking `Sec-Fetch-Site` and `Origin` headers against an allowlist. No token generation/storage required — it's header-based.

## Basic
```ts
import { App, csrf } from "fresh";

const app = new App().use(csrf());
```

## Trusted origins
```ts
// single
app.use(csrf({ origin: "https://example.com" }));

// multiple
app.use(csrf({ origin: ["https://example.com", "https://trusted.example.com"] }));

// function
app.use(csrf({
  origin: (origin) => /^https:\/\/(foo|bar)\.example\.com$/.test(origin),
}));
```

## How it works
Compares incoming `Origin` (and `Sec-Fetch-Site`) header against the allowlist. Same-site requests pass; cross-origin POSTs from untrusted origins are rejected.

## See also
- `advanced/forms.md` — pair with CSRF in production
- `plugins/cors.md`
