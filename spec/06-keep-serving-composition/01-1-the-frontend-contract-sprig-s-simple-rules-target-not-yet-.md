## 1. The Frontend contract — sprig's simple rules (TARGET, not yet built)

> **This section is a design target, not the current build.** Today sprig composes
> via `serveSprig`/`sprigUi`/`KeepApi` ([§2](02-2-the-keepapi-seam-session-types-current-as-built.md)–[§4](04-4-the-auth-gateway-api-body-gateway-current-as-built.md)) — that is the live contract. What
> follows is what [§10](10-10-refactor-notes.md).0 says to land as its replacement.

Under this design sprig would export **`Frontend`** — a complete, directly-servable app:

```ts
type Frontend = (req: Request, info?: Deno.ServeHandlerInfo,
                 backend?: { fetch: typeof fetch }) => Response | Promise<Response>
```

`Deno.serve(Frontend)` is valid as-is. Whatever composes sprig into a larger app wraps
this handler; sprig neither knows nor cares what that is. Four rules — self-contained,
no external references — are sprig's entire BACKEND-DATA composition surface (Rule 4).
The session/guard channel is a separate composed concern sprig still consumes from —
see Rule 4's note and the auth ruling below:

- **Rule 1 — sprig serves at root and NEVER claims `/api/*`.** The `/api/*` namespace
  is foreign to sprig by rule: sprig emits no routes under it and treats a request to
  it as not-mine (in a standalone deploy such a request is answered like any unknown
  route — no special-casing, no forwarding). The frontend owns `/` — there is no base
  prefix, and asset paths are root-relative (`/_assets/*`).
- **Rule 2 — the optional third argument is a fetch-shaped client; sprig binds it
  request-scoped and consumes it exactly as `fetch`, never a singleton.** When
  provided, sprig wraps it via `backendClient` (spec 01 §1; `core.ts:364-384`) onto
  the request-scoped `Backend` DI token (`core.ts:352-361`) on the request root
  (`root.provide(Backend, env.backend)`, `core.ts:737`). `inject(Backend)` in
  `resolve.ts`/services then reads through it EXACTLY as `fetch`: cookies, redirects,
  streaming are the provider's guarantee — sprig does zero cookie plumbing. Injecting
  it client-side throws by design — DI never crosses the wire.
- **Rule 3 — absent the third argument, the `Backend` token is unbound and
  `inject(Backend)` fails loud.** That is the expected, legible **UI-only deploy** —
  no silent partial success; a UI-only app never injects `Backend`.
- **Rule 4 — sprig imports no backend framework and knows nothing about what wraps
  it, for backend data.** The third argument — a structural `{ fetch: typeof fetch }` —
  is the ENTIRE BACKEND-DATA seam (how a resolve's `inject(Backend)` reaches the
  host's backend): no import in either direction, no shared types beyond the
  platform's, no configuration naming the other side. The SESSION/guard layer is a
  SEPARATE composed seam: sprig's route guards read a `SessionProfile` (spec 01 §1
  type) from whatever guard layer the app composes — a layer owned by neither sprig
  nor any backend (see the auth-collapse note below, §4, DX-IDEAL §3.6). `Frontend`'s
  signature carries no channel for this; the guard layer supplies `env.session`
  outside `Frontend`'s three arguments.

Rules 2–3 fork on exactly one thing — whether the third argument was given — which
reduces to two call shapes:

| Call shape | `Backend` bound? | `inject(Backend)` | Island `/api/*` calls | Deploy name |
| --- | --- | --- | --- | --- |
| `Frontend(req, info, { fetch })` (composed) | Yes — request-scoped, on the request root (`root.provide(Backend, env.backend)`, `core.ts:737`) | Reads through the bound client exactly as `fetch` | Served by whatever answers `/api/*` | Composed / full-stack deploy |
| `Deno.serve(Frontend)` (standalone, no third argument) | No — the token stays unbound | Throws a located error at `core.ts:352-361` | Unserved by any backend → falls through to the ordinary unknown-route response (`404 "Not Found"`, Rule 1) | UI-only deploy |

The standalone throw is the SAME unbound-factory throw spec 01 §1/[§2](../01-core-runtime/02-2-injector-semantics-core-ts-190-256.md) documents
(today's exact string: "Backend is not bound … server data reaches islands as
serialized @inputs"); this target does not propose changing that string, only that
it keep naming the call site, whatever its exact wording.

**A worked trace (composed deployment):**

1. A host calls `Frontend(req, info, { fetch })` for `GET /dashboard` —
   `fetch` is the host's own backend client, the third argument's ENTIRE
   backend-data seam (Rule 4).
2. Sprig owns root and matches the route: `Frontend` is the public wrapper
   around `bootstrap()`'s pipeline — pipeline order, guards, and resolve
   dispatch are all delegated to 01 [§4](../01-core-runtime/04-4-bootstrap-request-pipeline-core-ts-709-850.md)
   unmodified. The `{ fetch }` third argument lands on `env.backend`, and 01
   §4 step 4 does `root.provide(Backend, env.backend)` on the request-scoped
   root (Rule 2).
3. `/dashboard`'s resolve calls `inject(Backend)`, which returns the client
   wrapped in step 2 (`backendClient`, `core.ts:364-384`, Rule 2).
   `backend.get("/things")` issues the HOST-PROVIDED `fetch` in-process — no
   network hop; cookies, redirects, and streaming are the provider's
   guarantee, not sprig's concern. This is the in-process DI read-through
   channel.
4. Sprig renders `/dashboard` (01 §4 step 10) with an island that, once
   hydrated in the browser, fires `fetch("/api/things")` client-side. That
   request never reaches sprig: `/api/*` is foreign to sprig by Rule 1, and it
   is the host's own wrapper — outside sprig's scope — that routes it to
   whatever answers `/api/*`.

The two channels never overlap: server-side resolve reads through DI (step 3),
in-process and request-scoped; client-side islands reach the backend only over
the foreign `/api/*` network channel the host mounts and owns.

Grounding (what already exists to build this on): `bootstrap()`'s existing
per-request surface already gives `Frontend` its foundation — `app.fetch` already
accepts a third `env` argument (`core.ts:688`, threaded at `core.ts:712`) carrying
`{ backend, assetsVersion, session }`. `Frontend` would be the public wrapper that
accepts the bare `{ fetch }` third argument and lands it on `env.backend` via the
Rule-2 wrap. Once landed, everything sprig serves — assets, vendored libs, head
injection, routing, lazy derivation — would run inside `Frontend`, fronting the
already-current pipeline pieces in [§5](05-5-asset-serving-serveasset-hardening-contract.md)–[§9](09-9-zero-composition-derivation.md).

Landing `Frontend` is not an isolated addition — it is coupled to three
consequences, all triggered by the same change:

- **Does NOT retire the "sprig never `Deno.serve()`s directly" invariant** —
  that holds unchanged: `Frontend` is a `{ fetch }` handler, and it is always
  the CALLER that runs `Deno.serve(Frontend)`, never sprig-the-code. What
  changes is entrypoint count, not who binds the socket.
- **Subsumes both current entrypoints** ([§3](03-3-the-servesprig-composition-current-as-built.md)) — `serveSprig`/`sprigUi`,
  both `{ fetch }`/middleware handlers a caller serves today, collapse into
  composing `app` as the single `{ fetch }` handler `Frontend` (see "What
  collapses into `Frontend`" below).
- **Is the trigger for the largest coupled consequence: it removes built-in
  auth 100%.** The `/auth/*` gateway and the `auth.ts` client collapse into a
  pluggable guard layer neither sprig nor any backend owns. The ruling and
  its scope live at [§4](04-4-the-auth-gateway-api-body-gateway-current-as-built.md) and DX-IDEAL
  [§3.6](../DX-IDEAL/04-3-per-subsystem-ideal.md); this section only records the dependency.

**What collapses into `Frontend`:**

| Mechanism | Fate under `Frontend` | Detail |
| --- | --- | --- |
| `KeepApi` seam | Retires — its `backend` field becomes the third argument (Rule 2) | [§2](02-2-the-keepapi-seam-session-types-current-as-built.md) |
| `serveSprig` | Retires — survives only as a thin migration adapter (`serveSprig({keep, app})` ≡ composing `app` as `Frontend`), then goes | [§3](03-3-the-servesprig-composition-current-as-built.md) |
| `sprigUi` | Retires — subsumed by `Frontend` being directly servable; a host wanting middleware wraps `Frontend` directly | [§3](03-3-the-servesprig-composition-current-as-built.md).4 |
| `base`/`/ui` prefix + derived redirects | Dies — the frontend owns root; no base is left to carve room for `/api`+`/docs` | [§3](03-3-the-servesprig-composition-current-as-built.md).3 row 1 |
| `/docs*` forwarding | Dies — docs live wherever the backend serves them, a namespace foreign to sprig; sprig carries no forwarding rule | [§3](03-3-the-servesprig-composition-current-as-built.md).3 row 2 |
| `/api/*` network channel + body gateway | Becomes foreign, "not-mine" — sprig performs no dispatch, stripping, or gating for it (Rule 1) | [§3](03-3-the-servesprig-composition-current-as-built.md).3 row 4; [§4](04-4-the-auth-gateway-api-body-gateway-current-as-built.md) |
| `/auth/*` gateway | Retires per the auth ruling | [§4](04-4-the-auth-gateway-api-body-gateway-current-as-built.md) |
| vendor map | Survives — carries into `Frontend`, asset paths becoming root-relative (no base) | [§3](03-3-the-servesprig-composition-current-as-built.md).3 row 6; [§6](06-6-vendored-browser-libs.md) |

**Landed correctly when:**

- `Deno.serve(Frontend)` serves the UI at `/` with root-relative `/_assets/*` — no base.
- A `/api/*` request gets the ordinary unknown-route response — `404 "Not Found"`, no
  headers, the SAME response 01 [§4](../01-core-runtime/04-4-bootstrap-request-pipeline-core-ts-709-850.md)'s
  terminal-outcomes table gives any no-match request — no special-casing, no
  forwarding (Rule 1).
- With no third argument, `inject(Backend)` throws the located `core.ts:352-361` error
  naming the call site (Rule 3).
- A composed per-request call binds `Backend` on the request root — never a singleton
  (Rule 2).

