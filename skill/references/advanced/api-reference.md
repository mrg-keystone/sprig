# API Reference

> Source: https://fresh.deno.dev/docs/advanced/api-reference

## Public exports from `"fresh"`

### Classes
- `App` — main server builder (see `concepts/app.md`)
- `HttpError` — throw with status code/message

### Functions
- `staticFiles()` — middleware to serve `static/`
- `createDefine<State>()` — creates the `define.*` helpers
- `page(data, init?)` — wrap handler return so the renderer reads `props.data`
- `cors()`, `csrf()`, `csp()`, `trailingSlashes()` — built-in middlewares

### Types
| Name | Purpose |
|---|---|
| `Context` / `FreshContext` | request context object |
| `PageProps` | props passed to page components |
| `Middleware` / `MiddlewareFn` | middleware function shape |
| `HandlerFn` | single handler signature |
| `HandlerByMethod` | per-method handler object |
| `RouteHandler` | union of handler shapes |
| `PageResponse` | return type of `page()` |
| `RouteConfig` | route config object (e.g. `skipInheritedLayouts`) |
| `LayoutConfig` | layout config |
| `Define` | object returned by `createDefine` |
| `FreshConfig` / `ResolvedFreshConfig` | app-level config |
| `ListenOptions` | `app.listen()` opts |
| `Island` | island component type |
| `Method` | HTTP method union |
| `RouteData` | data shape from route handlers |
| `Lazy` / `MaybeLazy` | lazy-loaded route helpers |
| `CORSOptions`, `CsrfOptions`, `CSPOptions` | per-plugin options |

## Runtime exports — `"fresh/runtime"`
- `Head` — head-tag manager (see `advanced/head.md`)
- `Partial` — partial regions (see `advanced/partials.md`)
- `asset()`, `assetSrcSet()` — cache-busting URL helpers
