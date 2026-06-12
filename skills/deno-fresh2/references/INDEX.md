# Fresh 2 Reference — INDEX

> Personal working notes. Source: https://fresh.deno.dev/docs/
> Each leaf doc is condensed. When a leaf isn't enough, fetch the canonical URL at the top of that file.

**How to use:** scan the decision matrix below first — it routes by task. Tier 1 = baseline shape of the framework, always load before touching code. Tier 2 = topic-specific, load when relevant. Tier 3 = recipes / API lookup.

---

## Decision Matrix — "If I'm about to do X, load these"

| Task | Files to load |
|---|---|
| Bootstrap a new project | `quickstart.md`, `concepts/architecture.md`, `concepts/file-routing.md` |
| Add a page / route | `concepts/routing.md`, `concepts/file-routing.md`, `concepts/data-fetching.md` |
| Add interactivity | `concepts/islands.md`, `concepts/signals.md`, `advanced/serialization.md` |
| Handle a form | `advanced/forms.md`, `concepts/data-fetching.md`, `advanced/define.md` |
| Add middleware / auth | `concepts/middleware.md`, `concepts/context.md`, `examples/session-management.md` |
| Layouts / nested layouts | `concepts/layouts.md`, `advanced/layouts.md`, `advanced/app-wrapper.md` |
| Error pages / 404 | `advanced/error-handling.md` |
| HTML `<head>` / SEO | `advanced/head.md` |
| Read env vars | `advanced/environment-variables.md` |
| Fast nav / no-reload updates | `advanced/partials.md`, `advanced/view-transitions.md` |
| WebSocket endpoint | `advanced/websockets.md` |
| Static asset / file in `static/` | `concepts/static-files.md` |
| Configure Vite | `advanced/vite.md` |
| Tracing / metrics | `advanced/opentelemetry.md` |
| Deploying | `deployment/{deno-deploy,deno-compile,docker,cloudflare-workers}.md` |
| Adding security headers | `plugins/{csp,csrf,cors,ip-filter,trailing-slashes}.md` |
| Writing tests | `testing.md` |
| Preview / test one component in isolation | `isolate.md` |
| Wire to a rune/keep backend / propose missing endpoints | `rune-backend.md` |
| Coming from Fresh 1 | `migration-guide.md` first, then everything |
| Stuck / weird error | `advanced/troubleshooting.md`, `advanced/api-reference.md` |

---

## Tier 1 — Read first (always load before touching Fresh code)

- [Quickstart](quickstart.md) — install, scaffold, dev server, project layout
- [Architecture](concepts/architecture.md) — how Fresh runs: server-rendered + selective hydration via islands
- [File routing](concepts/file-routing.md) — filesystem → URL conventions for `routes/`
- [Routing](concepts/routing.md) — route handlers, params, dynamic routes, route groups
- [Data fetching](concepts/data-fetching.md) — handler `GET`/`POST`, props, redirects
- [Islands](concepts/islands.md) — `islands/` directory, hydration boundary, prop serialization

## Tier 2 — Load when the task touches this area

### Concepts
- [App](concepts/app.md) — top-level `App` instance, plugin/route registration
- [Middleware](concepts/middleware.md) — `_middleware.ts`, request pipeline, `ctx.next()`
- [Context](concepts/context.md) — `ctx` shape, `ctx.state`, request info
- [Signals](concepts/signals.md) — Preact signals for island state
- [Layouts (concept)](concepts/layouts.md) — `_layout.tsx` composition
- [Static files](concepts/static-files.md) — `static/` dir, asset URLs, fingerprinting

### Advanced
- [App wrapper](advanced/app-wrapper.md) — `_app.tsx` for global HTML shell
- [Layouts (advanced)](advanced/layouts.md) — nested layouts, opting out, dynamic skipping
- [Error handling](advanced/error-handling.md) — `_404.tsx`, `_500.tsx`, error boundaries
- [Partials](advanced/partials.md) — partial page updates without full reloads
- [View transitions](advanced/view-transitions.md) — animated cross-page navigation
- [Forms](advanced/forms.md) — `<form>` POST handlers, progressive enhancement
- [Define helpers](advanced/define.md) — `define.handlers`, `define.page`, `define.middleware`
- [Serialization](advanced/serialization.md) — what can cross the island boundary
- [Environment variables](advanced/environment-variables.md) — `Deno.env` access patterns
- [`<head>` element](advanced/head.md) — `<Head>` component for title/meta/links
- [Vite plugin options](advanced/vite.md) — configuring the Fresh Vite plugin
- [WebSockets](advanced/websockets.md) — upgrading requests, `ctx.upgrade`
- [OpenTelemetry](advanced/opentelemetry.md) — tracing/metrics integration

### Deployment
- [Deno Deploy](deployment/deno-deploy.md) — recommended: `deployctl` / GitHub integration
- [`deno compile`](deployment/deno-compile.md) — single-binary deploy
- [Docker](deployment/docker.md) — container image
- [Cloudflare Workers](deployment/cloudflare-workers.md) — Workers-specific setup

### Plugins (security / hygiene)
- [cors](plugins/cors.md) — Cross-Origin Resource Sharing
- [csrf](plugins/csrf.md) — CSRF token middleware
- [csp](plugins/csp.md) — Content-Security-Policy headers
- [ipFilter](plugins/ip-filter.md) — allow/deny by IP
- [trailingSlashes](plugins/trailing-slashes.md) — URL normalization

### Testing
- [Testing](testing.md) — unit/integration patterns
- [isolate](isolate.md) — standalone component/island/page previews with live controls, an event log, and a one-click Playwright runner (bundled tool at `isolate/`)
- [rune backend](rune-backend.md) — consume a rune/keep backend (shared DTOs, in-process calls) and run the gap audit: emit suggested `.rune` specs + stub-and-TODO for operations the UI needs but the backend lacks

## Tier 3 — Reference only (load on demand)

- [API reference](advanced/api-reference.md) — public exports inventory for `"fresh"` and `"fresh/runtime"`
- [Troubleshooting](advanced/troubleshooting.md) — symptom → fix table for common errors
- [Builder (legacy)](advanced/builder.md) — skip unless maintaining a pre-Vite Fresh 2 alpha project
- [Migration guide](migration-guide.md) — Fresh 1 → 2 breaking changes + auto-migrator command

### Examples (recipes)
- [API routes](examples/api-routes.md) — `routes/api/` + `Response.json()` patterns
- [daisyUI](examples/daisyui.md) — install + Tailwind plugin wiring
- [Rendering Markdown](examples/markdown.md) — `@deno/gfm` + `dangerouslySetInnerHTML`
- [Rendering raw HTML](examples/rendering-raw-html.md) — `dangerouslySetInnerHTML` + XSS warnings
- [Sharing state between islands](examples/sharing-state-between-islands.md) — per-request signal in a parent (avoid module-level)
- [Active links](examples/active-links.md) — auto `aria-current` + CSS/Tailwind styling
- [Session management](examples/session-management.md) — cookie middleware, login/logout sketches
- [Common patterns](examples/common-patterns.md) — protected routes, redirects, content-negotiation, streaming, proxy, lazy, etc.

---

## Per-file format (every leaf doc follows this)

```
# Title
> Source: https://fresh.deno.dev/docs/...
## TL;DR
## Key APIs / Signatures
## Examples
## Gotchas
## See also
```
