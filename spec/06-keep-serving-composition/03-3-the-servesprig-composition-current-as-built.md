## 3. The `serveSprig` composition (current, as built)

> **CURRENT.** This section is the as-built factual record of `serveSprig`/`sprigUi`'s
> live composition — what ships now, anchors intact; it is not history.
> [§1](01-1-the-frontend-contract-sprig-s-simple-rules-target-not-yet-.md)'s `Frontend`
> contract is the target that would replace it once [§10](10-10-refactor-notes.md).0
> lands; §3.3 below maps each piece's fate.

`serveSprig({keep, app})` IS the composition ROOT today, but it does this by
RETURNING the composed `{ fetch }` handler (the dispatch below) — it never binds the
socket itself, consistent with [§1](01-1-the-frontend-contract-sprig-s-simple-rules-target-not-yet-.md)'s "sprig never `Deno.serve()`s directly" invariant
holding today, not just once the target lands. Whatever runs the returned handler owns
the process listener: the generated `serve.ts` is a bare `export default
serveSprig({...})` (§9; 05 §5's `writeRuneServe`; 08 §5), and it is `deno serve -A
serve.ts` — the workspace `start` task — that binds the socket and consumes that
default export; `serveSprig` itself contributes only the handler. `sprigUi` is the
framework-agnostic middleware variant — same shape, also handler-returning, never a
socket owner. Both entrypoints' fate under the §1 target is row 8 of the migration
table (§3.3).

### 3.1 Configuration surface — `serveSprig({keep, app, base?, apiPrefix?, docsPrefix?, assetsDir?, auth?})`

| option | type | default | effect | validation |
|---|---|---|---|---|
| `keep` | `KeepApi` ([§2](02-2-the-keepapi-seam-session-types-current-as-built.md)) | required | supplies the `backend`/`handler`/session functions the dispatch table (§3.2) consumes | — |
| `app` | bootstrapped SSR app (`{ fetch }`, [§9](09-9-zero-composition-derivation.md)) | omitted → lazily composed on first request via `composeApp(srcDir, base)` ([§9](09-9-zero-composition-derivation.md)) | the SSR fall-through target (§3.2 row 9) | — |
| `base?` | `string` | `/ui` (`mod.ts:778`) | the UI prefix — exists ONLY to carve room for the `/api`+`/docs` backend routes at one origin; root `/` and `/favicon.ico` redirect into it (§3.2 rows 2-3), skipped on a root mount | `base === apiPrefix` OR `base === docsPrefix` → throws at compose time (`mod.ts:794-796`) |
| `apiPrefix?` | `string` | `/api` | the stripped network-channel prefix (§3.2 row 7) | see `base` |
| `docsPrefix?` | `string` | `/docs` | the unstripped forwarding prefix (§3.2 row 8) | — |
| `assetsDir?` | `string` (path) | omitted → derived `<entryRoot>/ui/static` ([§9](09-9-zero-composition-derivation.md)) | directory `serveAsset` reads from ([§5](05-5-asset-serving-serveasset-hardening-contract.md)); `assetsGuard` warns loudly once if empty in prod; `assetsVersioner(assetsDir)` drives both the renderer's `?v=` and the immutable check | — |
| `auth?` | `{ infraUrl?: string; exchangePath?: string }` | `infraUrl`: `config.auth?.infraUrl` → `INFRA_URL` env → baked-in mrg-keystone control plane (`mod.ts:791`); `exchangePath`: `config.auth?.exchangePath` → `INFRA_EXCHANGE_PATH` env → `/api/authz/exchange` (`mod.ts:792`) | resolves the same-origin `/auth` gateway's infra target (§3.2 row 4, [§4](04-4-the-auth-gateway-api-body-gateway-current-as-built.md)) | `auth: { infraUrl: "" }` (config step, ahead of env) disables only the infra-dependent `/auth` endpoints — the gateway itself stays mounted whenever a keep session engine is present; per-endpoint gating is [§4](04-4-the-auth-gateway-api-body-gateway-current-as-built.md) |

### 3.2 The `serveSprig` dispatch table (`mod.ts:824-929`)

Evaluated top-to-bottom, first match wins:

| # | path pattern | method/guard | handler | strips prefix? | delegates to § | pinned by test |
|---|---|---|---|---|---|---|
| 1 | any | `FORBIDDEN_METHODS` (TRACE/TRACK/CONNECT) — fires before any route below | → `405` (`mod.ts:831-836`) | n/a | — | `sprig-ui` |
| 2 | `/` (bare root) | skipped on a root mount | → `307` to `base` (`mod.ts:761-768`, `838-841`) | n/a | — | `sprig-ui` |
| 3 | `/favicon.ico` | skipped on a root mount | → `307` to `<base>/_assets/favicon.svg` (`mod.ts:761-768`, `838-841`) | n/a | — | `sprig-ui` |
| 4 | `/auth`, `/auth/*` | mounted when `authInfraUrl \|\| keep.sessions \|\| keep.destroySession` (`mod.ts:846`) — `auth: { infraUrl: "" }` alone does NOT unmount this row if keep has a session engine; per-endpoint gating is [§4](04-4-the-auth-gateway-api-body-gateway-current-as-built.md) | sprig's `/auth` gateway, not base-relative (`mod.ts:846-849`) | n/a | [§4](04-4-the-auth-gateway-api-body-gateway-current-as-built.md) | `auth-exchange` (§4) |
| 5 | `<base>/_assets/vendor/*` | — | vendor map (`mod.ts:853-858`) | n/a | [§6](06-6-vendored-browser-libs.md) | `asset-cache-addressing`, `asset-percent-decode`, `asset-traversal` |
| 6 | `<base>/_assets/*` | GET/HEAD only (`serveAsset`'s own guard) | `serveAsset` (`mod.ts:860-862`) | n/a | [§5](05-5-asset-serving-serveasset-hardening-contract.md) | `asset-cache-addressing`, `asset-percent-decode`, `asset-traversal` |
| 7 | `/api`, `/api/*` | `/api/docs*` → `404` decided HERE (`mod.ts:867-868`), before `/docs*` (row 8) can ever match | `keep.handler` network surface + body gateway (`mod.ts:864-900`) | YES — strips `apiPrefix` | [§2](02-2-the-keepapi-seam-session-types-current-as-built.md), [§4](04-4-the-auth-gateway-api-body-gateway-current-as-built.md) | `body-byte-cap` |
| 8 | `/docs`, `/docs/*` | — | `keep.handler` (`mod.ts:902-904`) | NO — forwarded unstripped | [§2](02-2-the-keepapi-seam-session-types-current-as-built.md) | `sprig-ui` |
| 9 | everything else | — | SSR fall-through: `app.fetch(req, info, env)` (`mod.ts:816`, `926-927`) | n/a | [§1](01-1-the-frontend-contract-sprig-s-simple-rules-target-not-yet-.md) Rule 2, [§7](07-7-head-meta-provenance-logging.md) | `json-routing`, `framework-logging` |

Rows 5, 6, and 9 don't strip `base` off the path — the renderer/asset lookup is
constructed base-aware instead (`createRenderer(srcDir, base, …)`,
[§9](09-9-zero-composition-derivation.md)).

Row 9's `env = { backend: backendClient(config.keep.backend.fetch), assetsVersion,
session }` is what threads through as `app.fetch`'s third argument — `backendClient`
is spec 01 [§1](../01-core-runtime/01-1-public-api-surface-all-of-mrg-keystone-sprig.md)'s
`BackendClient` factory (`core.ts:364-384`) wrapping the raw `{ fetch }` into the
`{ fetch, get<T> }` shape `env.backend` exposes to `resolve.ts`; `session` is
`env.session` ([§4](04-4-the-auth-gateway-api-body-gateway-current-as-built.md)). This
exact threading is what [§1](01-1-the-frontend-contract-sprig-s-simple-rules-target-not-yet-.md) Rule 2 would specify through the third argument once
landed. The response is then wrapped by `injectHeadMeta` ([§7](07-7-head-meta-provenance-logging.md)).

**Three golden-path traces**, walked against the table above (`base = /ui`, the
default):

- **SSR — `GET /ui/x`.** Row 1 (method OK) → rows 2-3 (not `/` or `/favicon.ico`) →
  row 4 (not `/auth/*`) → row 5 (not `.../vendor/*`) → row 6 (not `.../_assets/*`) →
  row 7 (not `/api*`) → row 8 (not `/docs*`) → row 9 matches. `env = { backend:
  backendClient(config.keep.backend.fetch), assetsVersion, session }` is built and
  passed as `app.fetch(req, info, env)`'s third argument; the renderer (constructed
  with `base = "/ui"`) resolves `/x` against its routes. The returned `Response` is
  wrapped by `injectHeadMeta` before it goes out.
- **Island network call — `POST /api/things`.** Row 1 (method OK) → rows 2-6 no match
  → row 7 matches: the path starts with `apiPrefix` (`/api`) and is not
  `/api/docs*`, so no 404. The `/api` body gateway checks the POST body
  (`content-type: application/json` or `415`; size/depth caps,
  [§4](04-4-the-auth-gateway-api-body-gateway-current-as-built.md)). `apiPrefix` is
  stripped, so `keep.handler` receives `/things`; headers — including the httpOnly
  `sprig_session` cookie the island's same-origin `fetch("/api/things")` sent
  automatically — are forwarded unchanged.
- **Asset — `GET /ui/_assets/app-3f9a1c2b.js?v=3f9a1c2b`.** Rows 1-4 don't match (not
  root/favicon/auth); row 5 doesn't match (`app-3f9a1c2b.js` isn't under
  `.../vendor/`); row 6 matches — the request never reaches the `/api`/`/docs` rows at
  all. `serveAsset` derives `text/javascript; charset=utf-8` from the `.js` extension
  ([§5](05-5-asset-serving-serveasset-hardening-contract.md)); since `?v=` equals the
  assets dir's current content hash, the response carries
  `public, max-age=31536000, immutable`.

### 3.3 Migration fate under §1

| piece | as-built behavior | fate under §1 target | why |
|---|---|---|---|
| `base`/`/ui` prefix + derived redirects | `base` defaults `/ui` (`mod.ts:778`); bare `/`→`base` (307), `/favicon.ico`→`<base>/_assets/favicon.svg` (307), skipped on a root mount (§3.2 rows 2-3) | **DIE** | the frontend would own root `/` directly ([§1](01-1-the-frontend-contract-sprig-s-simple-rules-target-not-yet-.md) Rule 1) — no `base`, no `base===apiPrefix`/`base===docsPrefix` compose throw, no bare-root redirect |
| `/docs*` forwarding | `/docs`+`/docs/*`→`keep.handler` unstripped (§3.2 row 8); `/api` refuses `/api/docs*`→404 (§3.2 row 7), so Swagger is reachable only via unstripped `/docs*` today | **DIE** | docs would live wherever the backend serves them, under a namespace foreign to sprig (Rule 1) — sprig would carry no forwarding rule at all |
| `apiPrefix`/`docsPrefix` options | config knobs (`mod.ts:779-780`, §3.1) | **DIE** | under the target sprig would have no prefix knobs left; `/api/*` would simply not be sprig's (Rule 1) |
| the `/api/*` network channel | `/api`+`/api/*`→`keep.handler`, prefix stripped, `info` forwarded, headers (incl. the httpOnly `sprig_session` cookie) passed through unchanged (§3.2 row 7); the body-validation gateway runs here today ([§4](04-4-the-auth-gateway-api-body-gateway-current-as-built.md)) | **LEAVE sprig** | that channel would never be sprig content — the namespace would belong to whatever serves it, and sprig would perform no dispatch, stripping, or gating for it |
| everything-else → SSR | threads `env = { backend, assetsVersion, session }` as `app.fetch`'s third argument (§3.2 row 9) | **SURVIVE → Frontend** | this exact threading is what [§1](01-1-the-frontend-contract-sprig-s-simple-rules-target-not-yet-.md) Rule 2 would specify through the third argument once landed; the response would continue to be wrapped by `injectHeadMeta` ([§7](07-7-head-meta-provenance-logging.md)) |
| `FORBIDDEN_METHODS`→405, vendor map, `serveAsset` | run today under the base prefix (§3.2 rows 1, 5, 6) | **SURVIVE → Frontend** | carry over as-is; asset paths become root-relative (`/_assets/*`, no base) once landed |
| the `/auth/*` gateway | live today (§3.2 row 4, [§4](04-4-the-auth-gateway-api-body-gateway-current-as-built.md)) | **DIE** | built-in auth is removed 100% per the auth ruling once [§1](01-1-the-frontend-contract-sprig-s-simple-rules-target-not-yet-.md) lands ([§4](04-4-the-auth-gateway-api-body-gateway-current-as-built.md)) |
| `serveSprig`/`sprigUi` as entrypoints | both RETURN a handler and never bind the socket; whatever runs them owns the process listener | **SURVIVE → Frontend**, then retire | each would survive, at most, as a thin migration adapter over the new seam (`serveSprig({keep, app})` ≡ composing `app` as the `Frontend`; a UI-only deploy would become `Deno.serve(Frontend)`, a middleware host would wrap `Frontend` directly) — that transition is [§10](10-10-refactor-notes.md).0's refactor note, not yet done |

### 3.4 `sprigUi` (`mod.ts:958-987`)

`sprigUi({app?, base?="/ui", assetsDir?, backend?})` returns middleware today — for
hosts that own their own `Deno.serve`. `sprigUi` is the minimal, framework-agnostic
variant: assets + SSR only, for a host that already owns its own routing, backend, and
auth and just wants the sprig UI mounted under `base`. `serveSprig` is the
`keep`-integrated full composition — the dispatch table above, `/auth`/`/api`/`/docs`
included. The choose-between criterion is `KeepApi` versus a raw backend: reach for
`serveSprig` when a `KeepApi` ([§2](02-2-the-keepapi-seam-session-types-current-as-built.md))
is available and sprig should own the whole origin; reach for `sprigUi` when only a raw
`backend?: { fetch }` is available and the host is composing sprig into a
routing/auth setup it already owns. It does NOT parallel `serveSprig` everywhere;
the comparison:

| dimension | `serveSprig` | `sprigUi` |
|---|---|---|
| returns | the composed `{ fetch }` handler | middleware: `Response` under `base`, `null` to pass through |
| config | `{keep, app, base?, apiPrefix?, docsPrefix?, assetsDir?, auth?}` (§3.1) | `{app?, base?="/ui", assetsDir?, backend?}` |
| `base` default | `/ui` (`mod.ts:778`) | `/ui` |
| routes served | full dispatch — redirects, `/auth/*`, `/api/*`, `/docs/*`, vendor map, `serveAsset`, SSR (§3.2 rows 1-9) | still enforces the `FORBIDDEN_METHODS`→405 guard (`mod.ts:979-981`, same as §3.2 row 1) within `base`, then `_assets` and the SSR app only; no `/auth`, `/api`, `/docs`, or vendor-map routes; prefix boundary respected (`/uixyz`→`null`) |
| `backend` param shape | `keep.backend: { fetch }` ([§2](02-2-the-keepapi-seam-session-types-current-as-built.md)), wrapped by `backendClient` on the SSR fall-through (§3.2 row 9) | `backend?: { fetch: typeof fetch }` — the SAME raw shape `KeepApi.backend` is ([§2](02-2-the-keepapi-seam-session-types-current-as-built.md)), NOT a pre-wrapped `BackendClient`; wrapped identically with `backendClient` (`mod.ts:964`) — exactly the wrap the third argument would get under [§1](01-1-the-frontend-contract-sprig-s-simple-rules-target-not-yet-.md) Rule 2 |
| session (`env.session`) | threaded — cookie resolved via `keep.sessions.read` ([§4](04-4-the-auth-gateway-api-body-gateway-current-as-built.md)) | **NOT threaded — no session** |
| vendor map (`<base>/_assets/vendor/*`) | dedicated step — [§6](06-6-vendored-browser-libs.md)'s "every app gets it without bundling" guarantee | **NO vendor-map step** — falls straight to `serveAsset` on disk, 404ing a vendor lib unless the host copied it into `assetsDir/vendor` |
| `injectHeadMeta` wrap ([§7](07-7-head-meta-provenance-logging.md)) | yes | yes |

sprigUi's fate under §1 is the same as `serveSprig`'s — §3.3 row 8.

