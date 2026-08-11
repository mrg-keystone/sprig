# 06 — Serving & composition: `serveSprig`/`KeepApi` (current) + the `Frontend` target

> Subject: sprig's serving & composition surface. **§1 describes the `Frontend`
> handler — the refactor TARGET for this surface (§10.0: "Land it"), NOT YET BUILT.**
> No `mod.ts:N` anchor exists for `Frontend` itself — every other claim in this spec
> cites one. **§2–§4 are the CURRENT, as-built record** of the `serveSprig`-era
> composition (the `KeepApi` seam, the dispatch table, the auth gateway) — this is
> what every composed app's actual `serve.ts` runs today (07 §1 step 6, 08 §5), not
> legacy history; it stays the live contract until §1 lands. **§5–§9 are current** —
> sprig's own serving pipeline, unaffected either way. Source file:
> `packages/keep/mod.ts` (~990 lines, the `@mrg-keystone/sprig/keep` export); every bare
> `mod.ts:N` cite in this spec points into it (the package name is historical — §2).
> Pinned by nine test files: `sprig-ui`, `auth-exchange`, `session-thread`,
> `asset-cache-addressing`, `asset-percent-decode`, `asset-traversal`, `body-byte-cap`,
> `json-routing`, `framework-logging`.

## 1. The Frontend contract — sprig's simple rules (TARGET, not yet built)

> **This section is a design target, not the current build.** Today sprig composes
> via `serveSprig`/`sprigUi`/`KeepApi` (§2–§4) — that is the live contract. What
> follows is what §10.0 says to land as its replacement.

Under this design sprig would export **`Frontend`** — a complete, directly-servable app:

```ts
type Frontend = (req: Request, info?: Deno.ServeHandlerInfo,
                 backend?: { fetch: typeof fetch }) => Response | Promise<Response>
```

`Deno.serve(Frontend)` is valid as-is. Whatever composes sprig into a larger app wraps
this handler; sprig neither knows nor cares what that is. Four rules — self-contained,
no external references — are sprig's entire composition surface:

- **Rule 1 — sprig serves at root and NEVER claims `/api/*`.** The `/api/*` namespace
  is foreign to sprig by rule: sprig emits no routes under it and treats a request to
  it as not-mine (in a standalone deploy such a request is answered like any unknown
  route — no special-casing, no forwarding). The frontend owns `/` — there is no base
  prefix, and asset paths are root-relative (`/_assets/*`).
- **Rule 2 — the optional third argument is a fetch-shaped client; sprig binds it
  request-scoped and consumes it exactly as `fetch`.** When whatever composes sprig
  provides the third argument (per request), sprig wraps it via `backendClient`
  (spec 01 §1; `core.ts:364-384`) and binds it to the **request-scoped** `Backend` DI
  token (`core.ts:352-361`) on the request root (`root.provide(Backend, env.backend)`,
  `core.ts:737`) — **never a singleton**. `inject(Backend)` in `resolve.ts`/services
  then reads through it EXACTLY as `fetch`: cookies, redirects, streaming are the
  provider's guarantee — sprig does zero cookie plumbing. Injecting it client-side
  throws by design — DI never crosses the wire.
- **Rule 3 — absent the third argument, the `Backend` token is unbound and
  `inject(Backend)` fails loud.** `Deno.serve(Frontend)` passes no third argument; the
  token stays unbound and injection throws a located error — the SAME unbound-factory
  throw spec 01 §1/§2 documents at `core.ts:352-361` (today's exact string: "Backend is
  not bound … server data reaches islands as serialized @inputs"). This target does not
  propose changing that string; it must keep naming the call site, whatever its exact
  wording. Islands' `/api/*` calls are simply unserved. That is the
  expected, legible **UI-only deploy** — no silent partial success; a UI-only app never
  injects `Backend`.
- **Rule 4 — sprig imports no backend framework and knows nothing about what wraps
  it.** The third argument — a structural `{ fetch: typeof fetch }` — is the ENTIRE
  seam: no import in either direction, no shared types beyond the platform's, no
  configuration naming the other side.

Grounding (what already exists to build this on): `bootstrap()`'s existing
per-request surface already gives `Frontend` its foundation — `app.fetch` already
accepts a third `env` argument (`core.ts:688`, threaded at `core.ts:712`) carrying
`{ backend, assetsVersion, session }`. `Frontend` would be the public wrapper that
accepts the bare `{ fetch }` third argument and lands it on `env.backend` via the
Rule-2 wrap. Once landed, everything sprig serves — assets, vendored libs, head
injection, routing, lazy derivation — would run inside `Frontend`, fronting the
already-current pipeline pieces in §5–§9. Landing `Frontend` as directly servable
would retire the "sprig never `Deno.serve()`s directly" invariant and subsume both
current entrypoints (§3).

## 2. The `KeepApi` seam + session types (current, as built)

> **CURRENT.** §2–§4 are the as-built factual record of today's `serveSprig`-era
> composition — this is what ships now, anchors intact; it is not history. §1's
> `Frontend` contract (where the whole seam narrows to the third argument's
> `{ fetch }`) is the target that would replace this section once §10.0 lands it.

Naming, for the record: a **keep** was the generated backend this package composed
around (00 glossary) — hence this package's historical name, `packages/keep/mod.ts`.
`KeepApi` is the structural cross-framework interface `serveSprig` consumes today:

```ts
interface KeepApi {
  backend: { fetch: typeof fetch };   // in-process client (SSR channel)
  handler: (req, info?) => Response | Promise<Response>;  // the /api/* network surface
  intakeSession?; destroySession?; sessions?: { read(id) };  // only with KEEP_SESSION_KV
}
```

`SessionIntake { credential, credentialKind: "firebase"|"opaque", email? }`,
`SessionMinted { id, creator, email?, grants[] }` — `id` is the opaque session id (goes
into the httpOnly cookie only, never serialized to the client); `creator` is the
identity the backend resolved the credential to, and is serialized back to the client
as `name` in `/auth/login`/`/auth/exchange`'s success body (§4) — its only consumer,
`SessionProfile { name?, email?, grants? }`.
Absent session members ⇒ **legacy bearer mode** (gateway proxies infra and returns the
bearer verbatim; `env.session` stays null).

Under the target model (§1, not yet landed) the in-process client would reach sprig
as the third argument (§1 Rule 2) and the `/api/*` network surface would become
foreign to sprig (§1 Rule 1) — `KeepApi` as a sprig-consumed interface would retire
once that lands; today it is the live seam.

## 3. The `serveSprig` composition (current, as built)

`serveSprig({keep, app})` IS the composition ROOT today, but it does this by
RETURNING the composed `{ fetch }` handler (the dispatch below) — it never binds the
socket itself, consistent with §1's "sprig never `Deno.serve()`s directly" invariant
holding today, not just once the target lands. Whatever runs the returned handler owns
the process listener: the generated `serve.ts` is a bare `export default
serveSprig({...})` (§9; 05 §5's `writeRuneServe`; 08 §5), and it is `deno serve -A
serve.ts` — the workspace `start` task — that binds the socket and consumes that
default export; `serveSprig` itself contributes only the handler. `sprigUi` is the
framework-agnostic middleware variant — same shape, also handler-returning, never a
socket owner. Both would be subsumed by the `Frontend` contract once §1 lands: sprig
would export the handler directly instead of through `serveSprig`'s wrapping, and
whatever composes sprig would still own the root exactly as it does today. Each would
survive, at most, as a thin migration adapter over the new seam (`serveSprig({keep,
app})` ≡ composing `app` as the `Frontend`), then retire — that transition is §10.0's
refactor note, not yet done.

### 3.1 The `serveSprig` dispatch table (`mod.ts:824-929`) — and where each piece would go

1. **The `base`/`/ui` prefix + its derived redirects — live today; WOULD DIE under the
   target model.** `base` defaults to `/ui` (`mod.ts:778`); `derivedRedirect` sends
   bare `/`→base (307) and `/favicon.ico`→`<base>/_assets/favicon.svg` (307), skipped
   only on a root mount (`mod.ts:761-768`, `838-841`). The base exists ONLY to carve
   room for the `/api`+`/docs` backend routes at one origin; under the target the
   frontend would own root `/` instead (§1 Rule 1) — no base, no
   `base===apiPrefix` compose throw (`mod.ts:794-796`), no bare-root redirect.
2. **The separate `/docs*` forwarding — live today; WOULD DIE under the target.**
   `/docs`+`/docs/*`→`keep.handler` **unstripped** (`mod.ts:902-904`), while the
   `/api` channel REFUSES `/api/docs*` (→404, `mod.ts:867-868`) so Swagger is
   reachable only via unstripped `/docs*` today. Under the target, docs would live
   wherever the backend serves them, under a namespace foreign to sprig (Rule 1) —
   sprig would carry no forwarding rule at all.
3. **The `apiPrefix`/`docsPrefix` options — live today; WOULD DIE** (`mod.ts:779-780`):
   under the target sprig would have no prefix knobs left; `/api/*` would simply not
   be sprig's (Rule 1).
4. **The `/api/*` network channel — sprig's today; WOULD LEAVE sprig under the
   target.** `/api`+`/api/*`→`keep.handler` with the prefix **stripped**, `info`
   forwarded, headers (incl. the httpOnly `sprig_session` cookie) passed through
   unchanged (`mod.ts:864-900`); the body-validation gateway runs here today (§4).
   Under the target that channel would never be sprig content — the namespace would
   belong to whatever serves it, and sprig would perform no dispatch, stripping, or
   gating for it.
5. **Everything-else → SSR — survives; would front as the `Frontend`.** The
   fall-through today threads `env = { backend: backendClient(config.keep.backend.fetch),
   assetsVersion, session }` as `app.fetch`'s third argument (`mod.ts:816`, `926-927`)
   — `backendClient` is spec 01 §1's `BackendClient` factory (`core.ts:364-384`)
   wrapping the raw `{ fetch }` into the `{ fetch, get<T> }` shape `env.backend`
   exposes to `resolve.ts`. This exact threading is what §1 Rule 2 would specify
   through the third argument once landed; `session` is `env.session` (§4); the
   response is wrapped by `injectHeadMeta` (§7), which `Frontend` would continue to do.
6. **`FORBIDDEN_METHODS` (TRACE/TRACK/CONNECT)→405** (`mod.ts:831-836`), the vendor map
   (`<base>/_assets/vendor/*`, §6), `serveAsset` (`<base>/_assets/*`, §5) — all run
   today under the base prefix, and would carry over into `Frontend`, asset paths
   becoming root-relative (`/_assets/*`, no base) once landed. The `/auth/*` gateway
   (§4) is live today; it WOULD RETIRE per the auth ruling once §1 lands. `assetsGuard`
   still warns loudly once on an
   empty assets dir in prod; one `assetsVersioner(assetsDir)` still drives both the
   renderer's `?v=` and the immutable check.

### 3.2 `sprigUi` (`mod.ts:958-987`)

`sprigUi({app?, base?="/ui", assetsDir?, backend?})` returns middleware today —
`Response` under `base`, `null` to pass through — for hosts that own their own
`Deno.serve`. Its job would be subsumed by `Frontend` being directly servable once §1
lands: a UI-only deploy would become `Deno.serve(Frontend)`, and a host that wants
middleware would wrap `Frontend` directly. As-built facts the record keeps: `backend?`
is the SAME raw `{ fetch: typeof fetch }` shape `KeepApi.backend` is (§2), NOT a
pre-wrapped `BackendClient`; sprigUi wraps it with `backendClient` (`mod.ts:964`)
identically to `serveSprig`'s SSR fall-through (§3.1 item 5) — exactly the wrap the
third argument would get under §1 Rule 2. It serves `_assets` then the SSR app
(wrapped backend + assetsVersion, **no session**), respecting the prefix boundary
(`/uixyz`→null). Two behaviors it does NOT parallel from `serveSprig`, which would
become moot under a root-owning `Frontend` with no base: no vendor-map step (a
`<base>/_assets/vendor/*` falls straight to `serveAsset` on disk today, 404ing a
vendor lib unless the host copied it into `assetsDir/vendor` — §6's "every app gets
it without bundling" guarantee is scoped to `serveSprig`); it DOES wrap SSR responses
with `injectHeadMeta` (§7), which `Frontend` would continue to do.

## 4. The `/auth` gateway + `/api` body gateway (current, as built)

> **[RESOLVED — the user ruled (2026-07-18; recorded in the cross-repo coordination
> thread `tooling/coms.md`): once the `Frontend` contract (§1) lands, built-in auth is
> removed, 100%.]** Under the target model, neither sprig nor the composition seam
> would ship any built-in auth. Two DISTINCT things are on the table, to land together
> with §1:
> - **The in-process trust key would be dropped.** The `x-danet-internal` /
>   localhost-trust marking of "this call is in-process" would go away: the third
>   argument (§1 Rule 2) binds the in-process client STRUCTURALLY, so no token would
>   need to mark a call in-process. sprig would stop expecting a trusted-vs-network
>   split baked into any handler.
> - **Built-in app-level auth would be removed entirely.** App auth would become a
>   pluggable guard layer the app composes around its handlers — owned by neither
>   sprig nor any backend. Cookie fidelity would be the provider's guarantee on the
>   third-argument client (§1 Rule 2), and an island's same-origin fetch carries
>   cookies natively — so an app's own session-cookie guard would work identically
>   in-process and over `/api/*`; that substrate is what would remain.
>
> **Until §1 lands, everything below is the CURRENT, live `/auth` + `/api` body
> gateway** — this is what `serveSprig`'s composition actually runs today: 00's
> request-path diagram's `/auth/*` leg, 01 §6's live `auth.ts` client (`login`,
> `logout`, `getUserData`, …), 05 §4's `sprigAuth()` in the pure-UI dev fallthrough,
> and 08 §1's `auth` entry in the JSR publish set all describe this same live surface.
> Once the target lands, sprig's surface would shrink to *consuming* a session (route
> guards reading grants) from whatever guard layer the app composes, and this section
> becomes the as-built legacy record. The `[DECIDE]` Secure-cookie marker below
> transfers with the gateway to the auth module's design at that point — it is a live
> sprig decision until then.

Auth endpoints (session mode minted an **httpOnly `sprig_session` cookie**; the
browser never held a bearer):
- `GET /auth/firebase-config` — proxies `<infra>/firebase-config.json`, 5-min cache. A
  failed or non-OK infra config fetch → `502 "firebase config unavailable"` (mod.ts:471).
- `POST /auth/login` — request body is JSON `{ idToken: string, email?: string }` (`email`
  is optional and passed through only to `intakeSession`/the legacy proxy, never used to
  gate the request). Unlike the `/api` body gateway (this section, below), there is NO
  `application/json`-or-415 content-type check here: the raw body is parsed as JSON
  regardless of the declared content-type. The 64,000 byte cap (below) is checked first;
  a body under that cap with a missing/non-string `idToken` — including an unparseable
  body — is then `400 { message: "idToken required" }`. Valid `idToken` → `intakeSession`;
  SESSION MODE success is `200` with `content-type: application/json`,
  `cache-control: no-store`, `set-cookie` (`Path=/; HttpOnly; SameSite=Lax; Max-Age=7d; [Secure]`)
  — `Path=/` is set explicitly (never left to the request-URI-derived default, which here would be
  `/auth`), so the cookie rides every same-origin request: both the `/api/*` token-gating credential
  and the SSR `env.session` resolution (below) depend on the cookie reaching `/api/*` and `/ui/*`,
  not just `/auth/*` — and body `{ name, email, grants }` — `SessionMinted`'s `creator`/`email`/`grants` (its
  `id` stays server-side, folded into the cookie only; never serialized to the client),
  the same shape `GET /auth/me` returns. A rejected credential → `401 { message }` (no
  cookie). Body cap 64,000 bytes → 413. Legacy fallback: proxy `<infra>/api/session/login`,
  return bearer verbatim — an unreachable upstream → `502 "auth upstream unreachable"`
  (mod.ts:507).

  > **[DECIDE]** What triggers emitting `Secure` on the `sprig_session` cookie. Recommended
  > default: emit `Secure` whenever the incoming request's resolved scheme is `https`
  > (checked against `req.url`, falling back to an `X-Forwarded-Proto: https` header
  > behind a TLS-terminating proxy) — ties the flag to the actual transport instead of
  > an environment guess, so local plaintext dev servers still receive the cookie.
  > *(Transfers with this gateway to the auth module's design — see the ruling note above.)*
- `POST /auth/exchange` — opaque `?token=` → session; same SESSION MODE success/rejection
  contract as `/auth/login` above (`200 { name, email, grants }` + cookie, or `401`);
  legacy fallback path default `/api/authz/exchange` — same `502 "auth upstream unreachable"`
  on an unreachable upstream (mod.ts:542).
- `GET /auth/me` — cookie → `keep.sessions.read` → `{name,email,grants}` else 401
  (grants are UX-only; enforcement is server-side). Neither the cookie nor the read is
  conditioned on infra: in LEGACY bearer mode (`keep.sessions` absent — §2), there is no
  server-side session store to read, so `/auth/me` unconditionally answers 401 regardless
  of infra resolving; a legacy client's only source for its `{name,email,grants}` is the
  body `/auth/login`/`/auth/exchange` already returned when it minted the bearer, not a
  later `/auth/me` call.
- `POST /auth/logout` — destroy + clear cookie (`Path=/; HttpOnly; SameSite=Lax; Max-Age=0; [Secure]`
  — same `Path=/` and attributes the cookie was set with, so the clear actually overwrites it rather
  than leaving the original live under a mismatched Path), idempotent 204. In LEGACY bearer mode
  (`keep.destroySession` absent) there is nothing server-side to destroy; the endpoint
  still clears the (unset) cookie and answers 204 — a harmless no-op, since a legacy
  client discards its own bearer client-side.
- "Session store is disabled" from keep → treated as legacy fallback, not an error;
  real rejections → 401. `sprigAuth(config: { infraUrl?: string; exchangePath?: string;
  keep?: SessionEngine })` is the standalone gateway for hosts with NO keep backend
  (pure-UI dev, e.g. `sprig dev`'s fallthrough — spec 05 §4); it returns
  `(req) => Promise<Response | null>` — a Response for one of
  the same five `/auth/*` paths above, `null` for anything else, mountable as one
  middleware step ahead of the host's own routing. There is no `base` option: `/auth/*`
  is not base-relative, so it always answers the literal `/auth/firebase-config`,
  `/auth/login`, `/auth/exchange`, `/auth/me`, `/auth/logout` paths regardless of where
  the host mounts its own UI. `config.keep` is the optional `SessionEngine` slice
  (`intakeSession?`/`destroySession?`/`sessions?`, §2); omitted (the pure-UI-dev case),
  all three are absent, so the gateway runs entirely in LEGACY mode: `/auth/login` and
  `/auth/exchange` proxy to infra and return the bearer verbatim (never minting a
  cookie), `/auth/me` unconditionally answers 401 (no session store to read — same rule
  as serveSprig's own legacy mode, above), and `/auth/logout` is a no-op 204 that
  clears the (unset) cookie. Passing `config.keep` opts sprigAuth into the same
  SESSION MODE serveSprig uses when that engine is present. Infra URL: config →
  `INFRA_URL` env → `DEFAULT_INFRA_URL` (`https://infra.mrg-keystone.deno.net`) — a
  NULLISH chain (mod.ts:791): an explicit `""` at either step resolves to `""` and
  disables the infra-backed endpoints (the `/auth/*` gateway, §3.1 item 6). Exchange
  path resolves on a PARALLEL nullish chain: config `exchangePath` →
  `INFRA_EXCHANGE_PATH` env → `DEFAULT_EXCHANGE_PATH` (`/api/authz/exchange`) —
  sprigAuth at mod.ts:595, serveSprig at mod.ts:792 — the env override sitting between
  the `exchangePath` config option and the baked-in default, exactly as `INFRA_URL`
  sits between `auth.infraUrl` and `DEFAULT_INFRA_URL`.

Session threading on the SSR path: cookie resolved via `keep.sessions.read` into
`env.session` (§3.1 item 5's threaded `session` field). The app's own guard-execution
layer — bootstrap/rendering, outside this package (spec 02) — surfaces that same value
to guards as `ctx.session`; the gateway only ever needed to land the value on
`env.session`, never `ctx.session` directly (session-thread.test.ts: valid/invalid/
absent; legacy stays null).

**What gates an island's `/api/*` call** ("token-gated", precisely): the `/api/*`
channel forwards headers unchanged (§3.1 item 4) and the composed backend's network
handler enforces its deny-by-default credential guard. In SESSION mode the credential
IS the httpOnly `sprig_session` cookie: an island's same-origin `fetch("/api/…")`
sends it automatically (auth.ts — plain fetch, no wrapper, no JS-held credential), and
the RUNE-side keep backend — the code behind `keep.handler`, in the rune repo, NOT
this package — resolves it server-side to the stored bearer with silent refresh.
mod.ts:353-358 is this package's comment block RECORDING that cross-repo behavior
(and mod.ts:369-370 pins the exact cookie name the guard resolves), not an
implementation site. In LEGACY mode the browser holds the bearer and attaches it
itself. There is no cookie→header translation anywhere in serveSprig — this package
only ever passes the credential through.

`/api` body gateway (mod.ts:873-899): body-bearing requests had to be
`application/json` → else 415; UTF-8 **byteLength** > 4MiB (`TextEncoder`, not
`.length` — emoji regression pinned in body-byte-cap.test.ts) or `jsonDepth` > 200 →
400; unparseable → 400. `jsonDepth` is an O(n) non-recursive brace scan that ignores
string literals (rejects stack-exhausting bodies without recursing). Under the
target model any such gateway would belong to whatever serves `/api/*` — foreign to
sprig by Rule 1; the record stays here because the tests that pinned it live in this
repo.

## 5. Asset serving (`serveAsset`) — hardening contract

sprig's serving pipeline serves `/_assets/*` via `serveAsset` (as built in
`packages/keep/mod.ts`; runs today inside `serveSprig`/`sprigUi`'s dispatch, and
would continue inside the target `Frontend` once landed — §1):

- GET/HEAD only → 405 with `allow`.
- **Content-type**: derived from the requested file's extension via a fixed table —
  `.js` → `text/javascript; charset=utf-8`, `.css` → `text/css; charset=utf-8`, `.map` →
  `application/json; charset=utf-8`, `.svg` → `image/svg+xml`, `.json` →
  `application/json; charset=utf-8`; any other extension (or none) →
  `application/octet-stream`. The extension is read from the basename only (never across
  a `/`).
- Percent-decode the file segment BEFORE disk lookup; malformed escape → 400.
- Traversal: after decoding, reject any real `..` segment split on BOTH `/` and `\`
  (catches `..%5c`) → 403.
- **Cache addressing**: `public, max-age=31536000, immutable` ONLY when the request is
  content-addressed — `?v=` equals the dir's CURRENT content hash, or the filename
  matches `^chunk-[A-Z0-9]{8}\.js$`. Everything else (`?v=dev`, missing, stale) →
  `no-cache` + ETag (`W/"<size>-<mtime>"`) with 304 revalidation. The
  asset-cache-addressing test matrix pins: both 304 branches, redeploy inversion
  (old hash instantly stops being immutable), in-place rebuild tracking, degraded
  empty dir.

## 6. Vendored browser libs

Third-party browser libs are vendored into the package source and loaded as TEXT
(`Deno.readTextFile` for file:, `fetch` for a published JSR module). Each `VENDOR` entry
carries its own hardcoded `content-type` alongside its body — `apexcharts.js` →
`text/javascript; charset=utf-8` (the same mapping `serveAsset`'s `.js` case uses, §5) —
served at `<base>/_assets/vendor/apexcharts.js` today, under the current base-prefixed
`serveSprig`/`sprigUi` dispatch (§3.1); once the target `Frontend` model lands it
would move to `/_assets/vendor/apexcharts.js`, root-relative (no base) — with that
`content-type` and `cache-control: public, max-age=86400` either way. A vendor path
not in the map is a plain `404` —
sprig's vendor-map step (as built, §3.1 item 6) answers it directly and never consults
`assetsDir`. Apps declare it in deno.json only for typecheck; the vendored copy is what
runs (every app + the isolate workbench get it without bundling it).

## 7. Head-meta provenance + logging

- `buildMetaReader(assetsDir)` reads `build-info.json` once → escaped
  `<meta name="git-repo|git-commit|git-branch|build-time">`; `injectHeadMeta` splices
  them right after `<head>` via a streaming TransformStream (passes through non-HTML;
  drops content-length).
- `FRAMEWORK_LOGGING` env: opt-in scope-tagged stderr tracing (`compose`, `auth`,
  `session`, `guard`); `fwWarnOnce` is always-on once-per-key (notably the
  "LEGACY bearer mode" warning that diagnoses silent fallback). Never logs secrets.
  Pinned by framework-logging.test.ts including a subprocess asserting the exact
  fallback lines.

## 8. JSON folder routing

`loadRoutes(srcDir)` (mod.ts:101-109): entry `<srcDir>/routers/root/routes.json`;
legacy flat fallback `<srcDir>/root.json` (the source comment's "src/root.json" reads
`src` AS the srcDir — there is no extra `src/` segment).
`RawRoute` (mod.ts:41-48) is the FULL JSON surface: `{ path, load?, guards?: string[],
requiredGrant?: string, meta?: RouteMeta, children?: RawRoute[] }`. Mapping →
`Route` (mod.ts:75-96): `path`/`load`/`requiredGrant`/`meta` copy verbatim;
`guards: ["<name>"]` resolve from `<srcDir>/guards/<name>/mod.ts` (legacy `guard.ts`) —
the SAME `srcDir` `loadRoutes`/`mapRouteTable` were called with, never cwd or the
enclosing router's own dir — accepting `default`/`guard`/first function export;
`children` map recursively, and a layout `load` (one whose value STARTS WITH `routers/` —
`isLayoutLoad`; e.g. `"routers/main"`, never a `pages/*` leaf) additionally pulls children
from `<srcDir>/<load>/routes.json` — the SAME `srcDir` anchor `guards` resolves against
(above), never cwd or the enclosing router's own dir. Only for a layout `load` is the
value treated as a directory; a non-layout `load` (e.g. `"pages/overview"`) is copied
verbatim as a plain module reference — no `routes.json` lookup is attempted under it. Any
OTHER key is silently ignored — `mapRouteTable` reads exactly these six. TS `defineRoutes`
produces the same `Route[]` (json-routing.test.ts).

## 9. Zero-composition derivation

`entryRoot()` = dir of `Deno.mainModule` (the git-root serve.ts); null for a non-file
entry (jsr:/https:/test harness) — then paths must be passed explicitly.
`deriveUiDir(sub)` = `<entryRoot>/ui/<sub>` (bare cwd-relative `sub` only when there is
no file anchor). The derived `srcDir` (used when `app` is omitted) is
`deriveUiDir("src")` = `<entryRoot>/ui/src`. When `app` is omitted, sprig's serving
pipeline composes it LAZILY on the first request (memoized) via
`composeApp(srcDir, base)` (as built in `packages/keep/mod.ts:727-730` — both current
entrypoints, `serveSprig` and `sprigUi`, do this; the target `Frontend` handler would
too) =
`createRenderer(srcDir, base, { dev: !!SPRIG_DEV })` + `bootstrap({routes, base,
renderer})` — the file-local import alias `makeRenderer` IS spec 02 §5's
`createRenderer`. Separately from that file-internal alias, the serving package's
public entry RE-EXPORTS `createRenderer` and the `SsrRenderer` type verbatim from the
compiler (mod.ts:33: `export { createRenderer, type SsrRenderer } from
"…/compiler/mod.ts"`), so `@mrg-keystone/sprig/keep` is the public import site for
both. `buildClient` is CLI-only and not re-exported here. The tree-sitter parser is
NOT build-only — it still ships in the SSR runtime as the live-parse fallback
`createRenderer` reaches via its own lazy `import()` when `templates.json` is missing
(spec 02 §0/§5) — but that reach-in is internal to the compiler package; this
package's public entry re-exports neither `buildClient` nor the parser directly. Routes come from `resolveAppRoutes(srcDir)` (mod.ts:708-722),
the same resolution `sprig dev`'s `appRoutes` runs:
`<srcDir>/routers/root/routes.json` or legacy `<srcDir>/root.json` present → §8's
`loadRoutes`; else import `<srcDir>/mod.ts` and use its exported `routes` array — this
is how the scaffold's TS routes (`ui/src/mod.ts` `export const routes =
defineRoutes([...])`, spec 05 §3) reach a derived prod composition; neither source →
throw naming both options. Net, once §1 lands: a composed app's serve entry (the
app's OWN repo — spec 09 §2) would wrap `Frontend` instead — whatever composes sprig
would own the listener and hand `Frontend` the third argument per request (§1 Rule 2)
— and `Deno.serve(Frontend)` would be the UI-only shape, with app/srcDir/assetsDir
still all derived on the sprig side. The lazy composition above is what the target
`Frontend` handler would do on first request, with **`base = ""`** since the
frontend would then own root `/` (the `/ui` base would retire — §3.1). Today, the
`serveSprig` one-liner (§3) is what actually composes an app; it would become the
thin migration adapter only once `Frontend` lands.
**Caveat pinned by the workbench:** the derived assets dir is
`<root>/ui/static` — any layout deviating from that (e.g. the workbench building into
`$SPRIG_WB_ROOT/static`) MUST pass `assetsDir` explicitly or every `/_assets/*` 404s.

## 10. Refactor notes

0. **The `Frontend` contract (§1) is the primary reframe.** Land it as sprig's only
   composition surface: sprig would export the directly-servable `Frontend` owning
   root; today's dispatch — `base`/`/ui`, the `/docs*` forwarding, `apiPrefix`/
   `docsPrefix`, the `/api/*` channel — retires per §3.1's where-each-piece-would-go map;
   `serveSprig`/`sprigUi` become thin adapters or retire (§3). Keep the
   dispatch-order tests green against whichever composer performs the routing. Auth
   per §4's resolved ruling: built-in auth removed; sprig consumes a session from
   whatever guard layer the app composes.
1. The dispatch table + its order is the de-facto public gateway spec — extract it as
   data, keep the order tests.
2. Legacy bearer mode doubles every auth path; once infra fully migrates to session
   KV, delete it (the fwWarnOnce lines mark every fallback seam).
3. `serveAsset` + `assetsVersioner` + build hashing form one cache-addressing
   subsystem spread across two packages — unify.
4. The vendor map is a one-entry bespoke CDN; decide whether it grows or dies.
