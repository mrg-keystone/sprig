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

If this Fresh app embeds or consumes a **separate backend** that picks its datastore (or any
config) from env **at module load**, note that the `vite` dev task loads **no** env — the
backend silently falls back to its default (often empty) store, and every read looks like
"the database is broken" when it's fine. Two fixes, one works:

- ❌ `loadSync(new URL("../server/.env", import.meta.url))` in code — works in dev, breaks in
  the production build (`import.meta.url` resolves against the *bundled* file, so the `.env`
  path is wrong). Static `import`s also hoist above your `loadSync`, so a module that reads
  env at load runs first.
- ✅ Put `--env-file` on the **tasks** so the runtime sets env before any module loads —
  identical in dev and prod:
  ```jsonc
  "dev":   "deno run -A --env-file=../server/.env npm:vite",
  "start": "deno serve -A --env-file=../server/.env _fresh/server.js"
  ```

Full consumed-backend playbook (workspace, decorators, literal imports, production build):
`rune-backend.md`.

## See also
- `quickstart.md` — `client.ts` runs in the browser
