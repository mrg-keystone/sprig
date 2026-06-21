# Environment Variables

> Source: https://fresh.deno.dev/docs/advanced/environment-variables

## TL;DR
Server: standard `Deno.env.get()` / `process.env.*` / `--env-file`. Islands: only `FRESH_PUBLIC_*` vars are exposed — they're inlined into the bundle at build time. Access must be a literal `Deno.env.get("FRESH_PUBLIC_FOO")` so Vite can statically replace it.

## Server (anything)
```ts
const dbUrl = Deno.env.get("DATABASE_URL");
```
Load `.env`:
```
deno run --env-file=.env -A main.ts
```

## Islands (FRESH_PUBLIC_ only)
```ts
// .env
FRESH_PUBLIC_API_URL=https://api.example.com

// island.tsx
const url = Deno.env.get("FRESH_PUBLIC_API_URL"); // → "https://api.example.com" inlined
```

## What breaks inlining
- Dynamic key: `Deno.env.get(name)` ❌
- Indirect: `Deno.env.toObject().FRESH_PUBLIC_FOO` ❌
- Destructuring: `const { get } = Deno.env; get("…")` ❌

Only literal `Deno.env.get("FRESH_PUBLIC_NAME")` is rewritten.

## Gotchas
- Anything without `FRESH_PUBLIC_` is treated as server-only and **stays undefined in islands**.
- Don't put secrets behind a `FRESH_PUBLIC_` name — they will land in browser bundles.

## Server-side env for a consumed backend (the dev/build trap)

If this Fresh app consumes a **separate backend** that reads env **at module load**, bare
`vite` loads no env, so the backend silently falls back to an empty store — every read looks
like "the database is broken" when it's fine. Set env via **`--env-file` on the tasks**
(`"dev": "deno run -A --env-file=../server/.env npm:vite"`), never `loadSync(import.meta.url)`
in code (it breaks in the production build). The full consumed-backend playbook — workspace
setup, decorators, literal imports, the production-build crash — lives in `rune-backend.md`
("Load the backend's env"); don't re-derive it here.

## See also
- `quickstart.md` — `client.ts` runs in the browser
