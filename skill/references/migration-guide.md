# Migration Guide — Fresh 1 → Fresh 2

> Source: https://fresh.deno.dev/docs/migration-guide

## TL;DR
Run the auto-migrator first: `deno run -Ar jsr:@fresh/update`. Then hand-fix the rest. Major themes: Vite replaces `dev.ts`, manifest is gone, handler signatures are unified to `(ctx)`, error pages merge into `_error.tsx`.

## Auto-migration
```
deno run -Ar jsr:@fresh/update
```

## Project structure changes
**Removed:** `dev.ts`, `fresh.gen.ts`, `fresh.config.ts`.
**Added:** `vite.config.ts`, `client.ts`, single `_error.tsx` (replaces `_404.tsx` + `_500.tsx`).

## New files

`vite.config.ts`:
```ts
import { defineConfig } from "vite";
import { fresh } from "@fresh/plugin-vite";
export default defineConfig({ plugins: [fresh()] });
```

`main.ts`:
```ts
import { App, staticFiles } from "fresh";
export const app = new App()
  .use(staticFiles())
  .fsRoutes();
```

`client.ts`:
```ts
import "./assets/styles.css";
```

## Task command changes
| Fresh 1 | Fresh 2 |
|---|---|
| `deno run -A dev.ts` | `vite` |
| `deno run -A dev.ts build` | `vite build` |
| `deno run -A main.ts` | `deno serve -A _fresh/server.js` |

## Handler / middleware signature unification
Before:
```ts
const middleware = (req, ctx) => new Response("ok");
export const handler = { GET(req, ctx) { /* */ } };
export default async function Page(req: Request, ctx: RouteContext) {}
```
After:
```ts
const middleware = (ctx) => new Response("ok");
export const handler = { GET(ctx) { /* */ } };
export default function Page(props: PageProps) {}
```
Access request via `ctx.req`.

## Context property renames
| 1.x | 2.x |
|---|---|
| `ctx.basePath` | `ctx.config.basePath` |
| `ctx.remoteAddr` | `ctx.info.remoteAddr` |
| `ctx.renderNotFound()` | `throw new HttpError(404)` |

## `ctx.render()` removed (data form)
Handlers now return data objects:
```ts
// Before
export const handler = {
  async GET(req, ctx) {
    const data = await Query();
    await ctx.render({ value: data });
  }
};
// After
export const handler = {
  async GET(ctx) {
    const data = await Query();
    return { data: { value: data } };
  }
};
```
(New `ctx.render()` exists but renders JSX: `ctx.render(<h1>hello</h1>)`.)

## Type consolidation
`AppContext`, `LayoutContext`, `RouteContext` → single `Context` type.

## Error pages → `_error.tsx`
```ts
import { HttpError } from "fresh";

export default function ErrorPage(props: PageProps) {
  const error = props.error;
  if (error instanceof HttpError && error.status === 404) {
    return <h1>404 - Page not found</h1>;
  }
  return <h1>Error occurred</h1>;
}
```

## Dependencies
```
deno install npm:vite jsr:@fresh/plugin-vite
```
Drop `jsr:@fresh/plugin-tailwindcss`; use `npm:@tailwindcss/vite` instead.

## Deployment behavior change
Fresh 2 builds assets ahead-of-time; Fresh 1 could build on-demand. Always run `deno task build` in deploy pipelines.

## Optional middleware
```ts
import { trailingSlashes } from "fresh";
export const app = new App().use(staticFiles()).use(trailingSlashes("never"));
```

## See also
- `quickstart.md` for the new clean-slate layout
- `advanced/error-handling.md` for `_error.tsx` patterns
- `advanced/define.md` for `define.handlers`/`define.page` (recommended way to type handlers/pages in 2.x)
