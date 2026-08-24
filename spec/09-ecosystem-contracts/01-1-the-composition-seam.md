## 1. The composition seam

Sprig's promise to whatever composes it — framework-agnostic, independent of
what that composer is — reduces to one seam point governed by four rules:

- **One seam point.** The entire composition surface is a single fetch-shaped
  third argument, `backend?: { fetch: typeof fetch }`, handed to sprig
  per request by whatever composes it.
- **Root, never `/api/*`.** sprig owns `/` and never claims the `/api/*`
  namespace — foreign to sprig by rule, not by convention.
- **Request-scoped, consumed as `fetch`.** sprig binds the third argument
  request-scoped — never a singleton — and consumes it exactly as `fetch`:
  cookies, redirects, streaming are the provider's guarantee; sprig does zero
  cookie plumbing.
- **Deny-by-default when absent.** No third argument, no bind — sprig fails
  loud, never silently. See below.
- **Structural-only, no imports either way.** The seam is a bare structural
  type, nothing more. See below.

This is sprig's half of the seam, restated on its own; as §2 restates sprig's
`spec/` obligations and §3 restates the waist rule, §1 doesn't own the
mechanism. The anchored handler contract — the `Frontend` type, these same
rules stated in full with their call-shape table — lives at 06
[§1](../06-keep-serving-composition/01-1-the-frontend-contract-sprig-s-simple-rules-target-not-yet-.md).
The as-built dispatch a composed app actually runs today lives at 06
[§3](../06-keep-serving-composition/03-3-the-servesprig-composition-current-as-built.md):
`serveSprig`/`KeepApi` run the full `base`-prefixed table (`/api/*`, `/docs*`,
`/auth/*`, everything-else→SSR); `sprigUi` runs the reduced dispatch — `_assets`
then the SSR app only, no `/api/*`, `/auth/*`, `/docs*`, no vendor map (06
§3.4).

**Today vs target, for context.** Today the seam is mediated by that
`base`-prefixed dispatch table (06 §3). The target it narrows to is the
`Frontend` handler (06 §1), not yet built: `(req: Request, info?, backend?: {
fetch: typeof fetch }) => Response | Promise<Response>`, directly servable.
Once landed, the seam point and four rules above are the whole of the seam —
nothing beyond them.

**Deny-by-default is a first-class promise, not an edge case.** Absent the
third argument, `inject(Backend)` fails loud with a located error naming the
call site (06 §1 Rule 3) — never silent partial success. That failure IS the
legible **UI-only deploy**: a UI-only app never injects `Backend`, and if it
tries, it finds out immediately, not from a blank screen in prod. This is the
exact shape [§4](04-4-locked-invariants-sprig-s-half.md) locks as
must-not-drift.

**No imports either direction is sprig's promise TO the ecosystem.** The whole
seam is a bare structural `{ fetch: typeof fetch }` — no shared types beyond
the platform's own `fetch`, no configuration naming the other side, no import
in either direction. Any backend that hands sprig a fetch-shaped client
composes with it; sprig neither knows nor cares what that backend is.

