# Routing

> Source: https://fresh.deno.dev/docs/concepts/routing

## TL;DR
Two ways to register routes: filesystem (`routes/`) and programmatic (`app.get/post/...`). Path syntax follows full `URLPattern` semantics. Static routes win over dynamic; among dynamic routes, registration order decides.

## Path syntax (programmatic)
- Static: `/about`
- Dynamic param: `/posts/:id` → `ctx.params.id`
- Catch-all: `/foo/*` matches `/foo/bar`, `/foo/bar/baz`
- Full `URLPattern` syntax is supported

## HTTP methods
`app.get`, `.post`, `.put`, `.delete`, `.patch`, `.head`, `.options`, `.all`.
- `HEAD` auto-falls back to `GET` when no HEAD handler exists.
- Unmatched methods on a matched path → `405 Method Not Allowed`.

## Priority
1. Static routes match before dynamic ones.
2. Among dynamic routes, the first registered wins. Register `/posts/featured` **before** `/posts/:id`.

## Programmatic example
```ts
app
  .get("/posts/featured", featuredHandler)
  .get("/posts/:id", postHandler)
  .post("/posts", createHandler);
```

## Filesystem routing
Covered fully in `concepts/file-routing.md`. Filenames map to URL patterns; `[id]` → `:id`, `[...path]` → catch-all, `[[optional]]` → optional segment.

## See also
- `concepts/file-routing.md` — filename conventions
- `concepts/data-fetching.md` — handler shape and data flow
- `concepts/context.md` — what's in `ctx` (params, etc.)
