# Context

> Source: https://fresh.deno.dev/docs/concepts/context

## TL;DR
`ctx` is the single object passed to every middleware and handler. Properties for reading the request; methods for advancing the chain or producing a response.

## Properties
| Property | Purpose |
|---|---|
| `ctx.req` | The incoming `Request` |
| `ctx.url` | `URL` for the request (use `.pathname`, `.searchParams`) |
| `ctx.params` | Object of route params (e.g. `:id` → `ctx.params.id`) |
| `ctx.state` | Per-request key/value store (typed by `App<State>`) |
| `ctx.config` | Resolved Fresh config (incl. `basePath`) |
| `ctx.route` | Matched route pattern string (or `null`) |
| `ctx.error` | Caught error during error handling (default `null`) |
| `ctx.info` | Connection info (e.g. `remoteAddr`) |

## Methods
| Method | Purpose |
|---|---|
| `ctx.next()` | Pass control to the next middleware/handler — `await` it |
| `ctx.render(jsx, opts?)` | Render JSX → `Response` (with optional `status`/`headers`) |
| `ctx.redirect(url, status = 302)` | Build a redirect `Response` |

## Typing state
```ts
interface State { user?: { id: string } }
const app = new App<State>();
// inside a middleware:
ctx.state.user = await loadUser(ctx.req);
```

## Migration note (Fresh 1 → 2)
- `ctx.basePath` → `ctx.config.basePath`
- `ctx.remoteAddr` → `ctx.info.remoteAddr`
- `ctx.renderNotFound()` → `throw new HttpError(404)`

## See also
- `concepts/middleware.md`
- `concepts/data-fetching.md`
- `advanced/error-handling.md`
