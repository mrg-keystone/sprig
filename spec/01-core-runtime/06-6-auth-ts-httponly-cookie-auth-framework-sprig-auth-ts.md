## 6. auth.ts — httpOnly cookie auth (framework/.sprig/auth.ts)

Model: the server manages an **httpOnly cookie** (`SESSION_COOKIE = "sprig_session"`);
it IS the `/api/*` credential in session mode (keep resolves it server-side — spec 06
[§4](../06-keep-serving-composition/04-4-the-auth-gateway-api-body-gateway-current-as-built.md)).
`AuthError` — the type [§1](01-1-public-api-surface-all-of-mrg-keystone-sprig.md)
re-exports and this section defines — carries one of four codes: `"cancelled"` (the
Google popup was closed before completing), `"not-authorized"` (server rejected the
credential, 401), `"unconfigured"` (no Firebase config on this deployment), `"failed"`
(catch-all for any other failure). The browser-JS/SSR invariants this module holds to
are pinned below under
[Contracts that must survive a refactor](#contracts-that-must-survive-a-refactor).

### Client functions

| Function | Trigger + request | Success | Failure / `AuthError` mapping |
|---|---|---|---|
| `login(token?)` | non-empty `token` → magic-link `POST /auth/exchange`, JSON body `{ token }`; empty/absent `token` → delegates to `loginWithGoogle()`'s popup flow | mints session, sets cookie (server-side — spec 06 §4), resolves `{name, email}` decoded server-side from the exchanged token (magic-link path) or as `loginWithGoogle()` resolves below (popup path) | magic-link path (non-empty `token`): no popup, no Firebase config fetch, so only `401` → throws `AuthError("not-authorized")`, or any other failure → throws `AuthError("failed")` — never `"cancelled"` or `"unconfigured"`; popup path (empty/absent `token`): same throwing discipline as `loginWithGoogle()` below |
| `loginWithGoogle()` | `GET /auth/firebase-config` (see below) + Firebase SDK load → Google popup → Firebase idToken → `POST /auth/login`, JSON body `{ idToken, email? }` | server mints session + sets cookie; resolves `{name, email}` — prefers the server-echoed profile from `/auth/login`'s response body, falling back to the popup's `email`/`displayName` for whichever field the server didn't echo | popup closed → throws `AuthError("cancelled")`; `401` → throws `AuthError("not-authorized")`; no Firebase config on this deployment (non-ok `/auth/firebase-config`) → throws `AuthError("unconfigured")`; any other failure → throws `AuthError("failed")` |
| `getUserData()` | `GET /auth/me` | `{name, email, grants}`, grants sanitized to strings | `401` or unreachable → returns `null` (never throws) |
| `logout()` | `POST /auth/logout` | resolves, idempotent | unreachable → swallowed, still resolves (never throws) |
| `apiPost<T>(path, body?)` | `POST /api${path}`, JSON body — `body` optional, defaults `{}` | parsed JSON response, typed `T` | non-2xx → throws a plain `Error` (`api ${path} -> ${status} ...`), not an `AuthError` |
| `authFetch` | plain `fetch` — cookie rides automatically; back-compat alias, not a wrapper | native `fetch` semantics | native `fetch` semantics (no `AuthError` translation) |

`warmAuth()` pre-warms the Firebase SDK/config ahead of use, to beat Safari's
transient-activation window on the popup flow, by issuing the same `GET
/auth/firebase-config` request `loginWithGoogle()` issues before opening the popup
(`warmAuth()` itself has no request/response contract of its own — it just triggers and
discards that fetch early). A non-ok response from `GET /auth/firebase-config` is what
`loginWithGoogle()` (and, by extension, `login()`'s popup path) turns into
`AuthError("unconfigured")`.

**Module-load side effect:** `seedTokenFromUrl()` runs on import in a browser,
exchanging any URL-carried token in the background — see
[Contracts that must survive a refactor](#contracts-that-must-survive-a-refactor) for
its exact ordering guarantee. Firebase is imported from the gstatic CDN via
`new Function("u","return import(u)")` to hide the URL from the island bundler.

### Contracts that must survive a refactor

None of these are pinned by a named test today — auth.ts is the one core-runtime
module [§9](09-9-behavioral-contracts-pinned-by-tests-must-survive-a-refact.md) has no
entry for — so a refactor's only guarantee is this list, worded so each item is
checkable directly against the rewritten code:

- **No client credential.** No browser-reachable code path reads or persists a bearer
  token or a JS-readable cookie into JS-reachable storage; the only credential the
  browser ever holds is the server-set httpOnly `sprig_session` cookie, invisible to
  `document.cookie`. The transient sign-in inputs (the Firebase `idToken` posted to
  `/auth/login`, the magic-link `token` posted to `/auth/exchange`) are transmitted
  once during the handshake and never held anywhere afterward.
- **SSR-inert.** The module has no top-level browser access, and every
  `document`/`location`/`window` access anywhere in it is `typeof`-guarded, so
  importing/loading this module under a server (non-browser) runtime is inert —
  it never throws on import. This does not extend to calling the exported
  functions: the fetch-based ones (`login`, `loginWithGoogle`, `apiPost`,
  `authFetch`) reject server-side because `fetch` itself fails there, which is
  expected and not a violation of this contract.
- **Grants are UX-only.** `getUserData()`'s `grants` field drives conditional
  rendering only; no client code treats it as an authorization decision — enforcement
  is server-side (spec 06 §4), never here (auth.ts:16-18).
- **URL token is single-use.** `seedTokenFromUrl()` strips `?token=` from the URL via
  `history.replaceState` BEFORE it starts the background exchange, so the token never
  survives in the URL bar or browser history — even if the exchange itself later fails.

