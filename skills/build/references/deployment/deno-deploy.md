# Deno Deploy

> Source: https://fresh.deno.dev/docs/deployment/deno-deploy

## TL;DR
Recommended host. Connect a GitHub repo → pick the "Fresh" preset → done. Deno Deploy auto-runs `deno task build` and serves `_fresh/server.js`. Branch previews + auto-deploy on merge to `main`.

## `deno.json` tasks (must include)
```json
{
  "tasks": {
    "build": "vite build",
    "start": "deno serve -A _fresh/server.js"
  }
}
```

## Steps
1. Log in to Deno Deploy.
2. New app → connect repo.
3. Pick the **Fresh** preset (auto-detected).
4. Push → preview deployment.
5. Merge to `main` → production.

## Env vars
Set in dashboard → **Settings → Environment Variables**. Read with `Deno.env.get()`. For browser-visible values use the `FRESH_PUBLIC_` prefix (see `advanced/environment-variables.md`).

## Custom domains
**Settings → Domains**. TLS is provisioned automatically.

## If deploy fails
- Verify Fresh preset is on, `deno task build` ran.
- Entry must be `_fresh/server.js`, not `main.ts`.
- Read the deployment log.

## See also
- `advanced/environment-variables.md`
- `advanced/troubleshooting.md`
