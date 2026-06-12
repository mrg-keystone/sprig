# trailingSlashes

> Source: https://fresh.deno.dev/docs/plugins/trailing-slashes

## TL;DR
Normalizes URL trailing slashes. Two modes: `"never"` (strip) and `"always"` (add). Mismatches redirect to the canonical form.

## Usage
```ts
import { App, trailingSlashes, staticFiles } from "fresh";

const app = new App()
  .use(staticFiles())
  .use(trailingSlashes("never"));
```

## Effect
- `"never"` → `/path/` → 30x redirect → `/path`
- `"always"` → `/path` → 30x redirect → `/path/`

## Why
- SEO: avoid duplicate-content penalties.
- Org-level URL consistency.
- Prevents broken links from inconsistent linking.

## Place where in the chain
Before route handlers (typically right after `staticFiles()`).

## See also
- `concepts/app.md`
