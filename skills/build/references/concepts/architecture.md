# Architecture

> Source: https://fresh.deno.dev/docs/concepts/architecture

## TL;DR
Server-first rendering with selective client hydration. Pages are HTML by default; only components placed under `islands/` ship JS and hydrate. Vite handles bundling at build time.

## Request lifecycle
1. HTTP request arrives.
2. Middleware chain runs in registration order; each can `await ctx.next()`.
3. Route handler runs (if any), returns data or a `Response`.
4. Page component renders to HTML on the server (with layouts wrapping).
5. Response sent to browser.
6. Islands found in the HTML are hydrated client-side.

## Build process (`deno task build`)
- Vite discovers islands.
- Bundles client JS with code splitting.
- Generates server entry under `_fresh/server.js`.
- Hashes assets for cache busting.

## Why this is fast
- Most pages ship 0 JS.
- Islands are tiny, isolated bundles.
- Preact (not React) — small runtime.

## See also
- `concepts/islands.md` — what makes a component an island
- `concepts/middleware.md` — request pipeline details
