## 4. The `/auth` gateway + `/api` body gateway (current, as built)

> **Status: RESOLVED · CURRENT-LIVE today · removed 100% once [§1](01-1-the-frontend-contract-sprig-s-simple-rules-target-not-yet-.md)
> lands · this section then becomes the as-built legacy record.** The auth-collapse
> ruling (2026-07-18, `tooling/coms.md`) — what drops, why, and the target guard-layer
> shape — is narrated in [§1](01-1-the-frontend-contract-sprig-s-simple-rules-target-not-yet-.md) and DX-IDEAL
> [§3.6](../DX-IDEAL/04-3-per-subsystem-ideal.md); not restated here. Everything below
> is the CURRENT, live `/auth` + `/api` body gateway — the surface 00's request-path
> diagram's `/auth/*` leg, 01 [§6](../01-core-runtime/06-6-auth-ts-httponly-cookie-auth-framework-sprig-auth-ts.md)'s live `auth.ts` client, 05 §4's `sprigAuth()`
> pure-UI-dev fallthrough, and 08 [§1](../08-install-skills-annotate/01-1-why-a-local-install-exists-at-all.md)'s JSR publish set all describe. The
> Secure-cookie rule below transfers with the gateway to the auth module's design once
> the target lands — it is a live sprig decision until then.

Auth endpoints (session mode minted an **httpOnly `sprig_session` cookie**; the
browser never held a bearer). `Path=/` is set explicitly on both mint and clear
(never left to the request-URI-derived default, which here would be `/auth`), so the
cookie rides every same-origin request: both the `/api/*` token-gating credential and
the SSR `env.session` resolution (below) depend on it reaching `/api/*` and `/ui/*`,
not just `/auth/*`.

| Method + path | Request body | SESSION-mode success | LEGACY-mode behavior | Error codes |
|---|---|---|---|---|
| `GET /auth/firebase-config` | none | proxies `<infra>/firebase-config.json` through a 5-minute SERVER-side memo (`firebaseConfigCache`, mod.ts:469-472) — the RESPONSE itself still carries `cache-control: no-store` (mod.ts:475), so the browser/CDN never caches it; only this gateway's own in-memory copy is reused across requests — mode-independent, not session/legacy-gated | same as SESSION mode (proxy only) | `404 "auth not configured"` (resolved infra URL is `""` but the gateway is still mounted via a keep session engine — mod.ts:468); `502 "firebase config unavailable"` on a failed/non-OK infra fetch (mod.ts:471); `405 Method Not Allowed` + `Allow: GET` on any other method (mod.ts:467) |
| `POST /auth/login` | JSON `{ idToken: string, email?: string }` — `email` optional, passed through only to `intakeSession`/the legacy proxy, never used to gate the request. **NO `application/json`-or-415 check here** (unlike the `/api` body gateway below): the raw body is parsed as JSON regardless of declared content-type. The 64,000-code-unit cap (`raw.length`, UTF-16 code units — NOT bytes; contrast the `/api` gateway's byteLength cap below) is checked first; a body under that cap with a missing/non-string `idToken` — including an unparseable body — is `400`. | `200`, `content-type: application/json`, `cache-control: no-store`, `set-cookie` (`Path=/; HttpOnly; SameSite=Lax; Max-Age=7d; [Secure]¹`), body `{ name, email, grants }` — `SessionMinted`'s `creator`/`email`/`grants` (its `id` stays server-side, folded into the cookie only; never serialized to the client) — the same shape `GET /auth/me` returns | proxy `<infra>/api/session/login`, return bearer verbatim (no cookie minted) | `404 "auth not configured"` (resolved infra URL is `""` but the gateway is still mounted via a keep session engine — mod.ts:481); `400 { message: "idToken required" }` (missing/non-string/unparseable `idToken`); `401 { message }` (rejected credential, no cookie); `413` (body > 64,000 code units); `502 "auth upstream unreachable"` (legacy, unreachable upstream — mod.ts:507); `405 Method Not Allowed` + `Allow: POST` on any other method (mod.ts:480) |
| `POST /auth/exchange` | JSON `{ token: string }` — the opaque handle, in the BODY (not a `?token=` query param); same 64,000-code-unit cap and unparseable/missing-field handling as `/auth/login` above, `400 { message: "token required" }` on failure | same contract as `/auth/login` above: `200 { name, email, grants }` + cookie | proxy fallback path default `/api/authz/exchange`, return bearer verbatim | `404 "auth not configured"` (resolved infra URL is `""` but the gateway is still mounted via a keep session engine — mod.ts:516); `400 { message: "token required" }` (missing/non-string/unparseable `token`); `401` (rejected); `413` (body > 64,000 code units); `502 "auth upstream unreachable"` (legacy, unreachable upstream — mod.ts:542); `405 Method Not Allowed` + `Allow: POST` on any other method (mod.ts:515) |
| `GET /auth/me` | none (cookie-based) | cookie → `keep.sessions.read` → `{name,email,grants}` else `401` (grants are UX-only; enforcement is server-side) | for `GET` requests, **unconditionally `401`** — `keep.sessions` absent means there is no server-side session store to read, regardless of infra resolving; a legacy client's only source for `{name,email,grants}` is the body `/auth/login`/`/auth/exchange` already returned when it minted the bearer, not a later `/auth/me` call | `401` for `GET` (SESSION: rejected/absent cookie; LEGACY: always); `405 Method Not Allowed` + `Allow: GET` on any other method (mod.ts:550) |
| `POST /auth/logout` | none | destroy + clear cookie (`Path=/; HttpOnly; SameSite=Lax; Max-Age=0; [Secure]¹` — same `Path=/` and attributes the cookie was set with, so the clear actually overwrites it rather than leaving the original live under a mismatched Path), idempotent `204` | `keep.destroySession` absent → nothing server-side to destroy; still clears the (unset) cookie, `204` — a harmless no-op, since a legacy client discards its own bearer client-side | for `POST`, always `204`; `405 Method Not Allowed` + `Allow: POST` on any other method (mod.ts:571) |

> **Secure-cookie rule¹:** `Secure` is emitted whenever the request's resolved scheme is
> `https` — `new URL(req.url).protocol === "https:"` (mod.ts:387, the shared
> `sessionCookie()` helper both the `/auth/login`/`/auth/exchange` mint and the
> `/auth/logout` clear call) — ties the flag to the actual transport instead of an
> environment guess, so a local plaintext dev server still receives the cookie while an
> `https`-served deployment gets it. No forwarded-proto header is consulted today.
> *(Transfers with this gateway to the auth module's design — see the ruling note above.)*

Which `SessionEngine` member ([§2](02-2-the-keepapi-seam-session-types-current-as-built.md))
gates SESSION mode, per endpoint — absence of that one member is what drops the
endpoint to its LEGACY-mode column above (§2's capability table covers the fallback
behavior each member's absence causes; this just maps endpoint → member):

| Endpoint | Gating member |
|---|---|
| `GET /auth/firebase-config` | none — mode-independent (proxy-only either way) |
| `POST /auth/login` | `intakeSession` |
| `POST /auth/exchange` | `intakeSession` |
| `GET /auth/me` | `sessions.read` |
| `POST /auth/logout` | `destroySession` |

Under `serveSprig`, neither the cookie nor `/auth/me`'s read is conditioned on infra —
"session store is disabled" from keep → treated as legacy fallback, not an error; real
rejections → 401 (mod.ts:846 mounts the gateway on `authInfraUrl || config.keep.sessions
|| config.keep.destroySession`, so an empty infra URL alone doesn't take `/auth/me` or
`/auth/logout` down as long as keep's session engine is present). Under `sprigAuth` this
does NOT hold: the whole gateway is gated on `infraUrl` alone — `(req) => infraUrl ?
serveAuthGateway(...) : Promise.resolve(null)` (mod.ts:603) — so an explicit
`infraUrl: ""` makes every `/auth/*` path, `/auth/me` and `/auth/logout` included, pass
through as `null` (no response at all, not even a 404), regardless of whether
`config.keep` is supplied.
`sprigAuth(config: { infraUrl?: string; exchangePath?: string;
  keep?: SessionEngine })` is the standalone gateway for hosts with NO keep backend
  (pure-UI dev, e.g. `sprig dev`'s fallthrough — spec 05 §4); it returns
  `(req) => Promise<Response | null>`, mountable as one middleware step ahead of the
  host's own routing. There is no `base` option: `/auth/*` is not base-relative, so it
  always answers the literal five `/auth/*` paths above regardless of where the host
  mounts its own UI. `config.keep` is the optional `SessionEngine` slice
  (`intakeSession?`/`destroySession?`/`sessions?`, [§2](02-2-the-keepapi-seam-session-types-current-as-built.md)) — passing it opts sprigAuth
  into the same SESSION mode serveSprig uses when that engine is present; omitted (the
  pure-UI-dev case), the gateway runs entirely in LEGACY mode (the endpoints table
  above covers both modes per endpoint). Both settings resolve on sprigAuth's flat
  config → env → baked default chain (env sits between the config option and the
  default at every step) — the same chain `serveSprig`'s own config surface
  ([§3](03-3-the-servesprig-composition-current-as-built.md).1: `{keep, app, base?,
  apiPrefix?, docsPrefix?, assetsDir?, auth?}`) resolves through today via its
  `auth?: { infraUrl?, exchangePath? }` config option (mod.ts:791-792); the settings
  table below covers both call sites' config → env → default resolution — it does NOT
  mean the two call sites behave identically once resolved: see the empty-infra
  divergence noted above and in the Infra URL row's nullish-semantics column.

  | Setting | sprigAuth config key | Env var | Baked default | Nullish semantics | mod.ts anchor |
  |---|---|---|---|---|---|
  | Infra URL | `infraUrl` | `INFRA_URL` | `DEFAULT_INFRA_URL` (`https://infra.mrg-keystone.deno.net`) | an explicit `""` at either step resolves to `""`, but the two call sites diverge on what that disables: under `serveSprig` it disables only the infra-backed endpoints — login/exchange/firebase-config → 404 "auth not configured", while `/auth/me`/`/auth/logout` stay live whenever `config.keep.sessions`/`destroySession` is present (mod.ts:846); under `sprigAuth` it disables the ENTIRE gateway — all five `/auth/*` paths pass through as `null` (mod.ts:603), `config.keep` notwithstanding | sprigAuth: `config.infraUrl`; serveSprig: `config.auth?.infraUrl`, mod.ts:791 (both config → env → default) |
  | Exchange path | `exchangePath` | `INFRA_EXCHANGE_PATH` | `DEFAULT_EXCHANGE_PATH` (`/api/authz/exchange`) | same config → env → default chain, in parallel with Infra URL above | sprigAuth: `config.exchangePath`, mod.ts:595; serveSprig: `config.auth?.exchangePath`, mod.ts:792 (both config → env → default) |

Session threading on the SSR path: cookie resolved via `keep.sessions.read` into
`env.session` ([§3](03-3-the-servesprig-composition-current-as-built.md).2 row 9's threaded `session` field). The app's own guard-execution
layer — bootstrap/rendering, outside this package (spec 02) — surfaces that same value
to guards as `ctx.session`; the gateway only ever needed to land the value on
`env.session`, never `ctx.session` directly (session-thread.test.ts: valid/invalid/
absent; legacy stays null).

**What gates an island's `/api/*` call** ("token-gated", precisely): the `/api/*`
channel forwards headers unchanged ([§3](03-3-the-servesprig-composition-current-as-built.md).2 row 7) and the composed backend's network
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

**Golden path, SESSION mode:**
1. `POST /auth/login { idToken: "eyJhbGci..." }` →
   `200` + `set-cookie: sprig_session=<opaque>; Path=/; HttpOnly; SameSite=Lax; Max-Age=7d`
   + body `{ name: "Ada", email: "ada@example.com", grants: ["admin"] }`.
2. The browser stores the cookie (httpOnly — no JS ever holds it).
3. An island calls `fetch("/api/foo")`; the browser attaches `sprig_session`
   automatically (same-origin, no wrapper).
4. The `/api/*` channel forwards the cookie unchanged; the RUNE-side keep backend
   resolves cookie→stored-bearer server-side (no cookie→header translation happens in
   this package) and answers the request.

**LEGACY mode contrast:** step 1 returns the bearer in the body instead of minting a
cookie, so the browser itself holds and attaches the bearer on step 3 — there is no
cookie to forward.

`/api` body gateway (mod.ts:873-899): body-bearing requests had to be
`application/json` → else 415; UTF-8 **byteLength** > 4MiB (`TextEncoder`, not
`.length` — emoji regression pinned in body-byte-cap.test.ts) or `jsonDepth` > 200 →
400; unparseable → 400. `jsonDepth` is an O(n) non-recursive brace scan that ignores
string literals (rejects stack-exhausting bodies without recursing). Under the
target model any such gateway would belong to whatever serves `/api/*` — foreign to
sprig by Rule 1; the record stays here because the tests that pinned it live in this
repo.

This package runs two independent body gateways with deliberately different rules —
`/auth/login` predates the `/api` gateway and was never retrofitted to match it:

| | `POST /auth/login` (mod.ts:479-512) | `/api/*` (mod.ts:873-899) |
|---|---|---|
| content-type / 415 check | **none** — the raw body is parsed as JSON regardless of declared content-type | `application/json` required, else `415` |
| size cap | 64,000 UTF-16 code units (`raw.length`) → `413` | 4 MiB UTF-8 byte length (`TextEncoder`) → `400` |
| depth cap | none | `jsonDepth` > 200 → `400` |
| unparseable handling | folds into the same `400 { message: "idToken required" }` as a missing/non-string field — no distinct error | distinct `400` from a separate `JSON.parse` try/catch, after the size/depth check |
| check order | size cap (`413`) → parse + field check (`400`) | content-type (`415`) → size/depth (`400`) → parse (`400`) |

`/auth/exchange` shares `/auth/login`'s row exactly — same 64,000-code-unit cap, no
content-type check, unparseable folded into its own `400 { message: "token required" }`.

