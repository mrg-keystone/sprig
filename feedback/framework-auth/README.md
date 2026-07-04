# sprig auth: `?token=` isn't exchanged (breaks rune-3 opaque tokens), + the missing single-path pieces

**Component:** `framework/.sprig/auth.ts` (client) + the `/auth` gateway in `packages/keep/mod.ts` (server).

## The ask (the target design)

Auth should be **one path, owned by sprig**, so apps never hand-roll it. Two intakes, one output,
everything server-side:

```
firebase idToken ─┐
                  ├─▶ (server) exchange at infra ─▶ signed bearer ─▶ httpOnly cookie ─▶ silent refresh
?token=<opaque> ──┘        (stores the ORIGINAL credential so it can re-mint on expiry)

client surface:  authFetch(url, init)   getUserData() → {name,email,grants}|null   logout()
rune:            verifies the bearer signature (already does) → trusts the grants
```

The "verify the signature, then use the grants" half **already exists** in keep (the signed
bearer's `claims` are the grants; keep verifies Ed25519 offline against infra's JWKS). So no rune
change is needed for that. The work is all on **sprig's** side, and it's ~70% there already —
this report is the missing 30% plus one outright bug.

## What sprig ships today (credit where due)

`framework/.sprig/auth.ts` already owns a real chunk of this:

- `loginWithGoogle()` — Firebase popup → idToken → `POST /auth/login` (same-origin gateway) →
  infra `session.login` → signed bearer → stored. **Firebase IS exchanged server-side. Good.**
- `apiPost(path, body)` — attaches the bearer to `/api`, signs out on a 401-that-had-a-bearer.
- `setBearer` / `signOut` / `hasSession` — bearer stored in `localStorage` **and** a `sprig_session`
  cookie (the SSR guard reads the cookie).
- `seedTokenFromUrl()` — reads `?token=` and stores it.
- Server gateway (`packages/keep/mod.ts`): `/auth/firebase-config`, `/auth/login`.

## BUG (reproducible): `?token=` stores the raw token — it is never exchanged

`seedTokenFromUrl()` stores the query value **verbatim** as the bearer:

```ts
// framework/.sprig/auth.ts
function seedTokenFromUrl(): void {
  const t = url.searchParams.get("token");
  if (!t) return;
  setBearer(t);          // ← stores the RAW ?token= value as the bearer. No exchange.
  ...
}
```

…and there is **no `/auth/exchange` route** on the gateway (only `/auth/login` for Firebase). So:

- **Firebase** path: idToken → `/auth/login` → infra → **signed bearer** → works.
- **`?token=`** path: opaque token → stored **as-is** → sent as `Authorization: Bearer <opaque>`.

On rune 3.x, keep verifies the bearer as an **infra-signed envelope** (JWKS). A raw opaque token
(a 34-byte handle — no `kid`, no `signature`, no `claims`) fails verification → **401 on every
`/api` call**. The `?token=` intake is therefore broken for opaque infra tokens; it only ever
worked when the link already carried a pre-exchanged bearer.

**Fix:** add a server `/auth/exchange` route (`POST {token}` → `<infra>/authz/exchange` → bearer),
and have `seedTokenFromUrl()` `await` it before `setBearer`. Then both intakes converge on a real
bearer. (`repro.sh` demonstrates raw-token → 401 vs exchanged-bearer → authorized.)

## Gaps vs the single-path design

1. **No `/auth/exchange` (opaque-token) route** — see the bug above. Firebase is exchanged
   server-side; opaque tokens have no server-side exchange at all.
2. **No silent refresh.** The bearer is ~1h. On expiry `apiPost` gets a 401 and **`signOut()`s**
   → forced re-login. Nothing holds the **original credential** to re-mint from, so an
   unattended/long-lived page (a wallboard, a kiosk) dies after an hour. Fix = a server session
   store that keeps the credential and re-exchanges transparently — see *The session store belongs
   in rune (Deno KV)* below.
3. **Bearer stored client-side (`localStorage` + a non-httpOnly cookie).** Two problems: (a) it's
   readable by any script → XSS-exfiltratable; (b) it's **size-bounded** — a cookie caps at **~4 KB
   and the browser silently drops an over-size cookie**, so a user with many grants (a large
   `claims` set) can quietly lose auth with no error. The current bearer is ~400 B (fine today), but
   it grows with grants. Fix = put only a small opaque **session id** in an httpOnly cookie and keep
   the bearer + credential + profile in a **Deno-KV session store server-side** (next section). That
   also means **keep must resolve the request from the cookie**, not just the `Authorization` header
   (today it reads only the header + `?token=` query). ⚠️ **Cross-cutting to rune/keep.**
4. **`apiPost` is POST-only.** The design wants a fetch-shaped `authFetch(url, init)` for any method.
5. **No `getUserData()`.** Only `hasSession()` (boolean). `loginWithGoogle` captures `email` but not
   `name`, and grants aren't surfaced. Want `getUserData() → {name, email, grants} | null`, which
   means (a) capture name+email at exchange and (b) expose the profile to the client (SSR-injected,
   or a `/auth/me` route — needed anyway once the cookie is httpOnly and JS can't read the bearer).
6. **`?token=` redirects instead of strip-and-stay.** `seedTokenFromUrl` does
   `location.replace(pathname.replace(/login|signin$/,"") || "/")` — it navigates. The design wants
   **strip the param and stay on the current page** (`history.replaceState` only). Minor, but it's
   exactly what makes `/board?token=…` bounce away.
7. **sprig doesn't ship the SSR guard.** Apps author their own (`alfred/src/guards.ts`), so the
   cookie name, verification, and protected-route logic drift per app. sprig should export a
   standard guard keyed on `SESSION_COOKIE`.

## Evidence the surface is incomplete: apps still hand-roll it

alfred does **not** use `@mrg-keystone/sprig`'s auth — it ships its own fork
(`ui/src/services/backend/client.ts` + `ui/src/guards.ts` + `ui/bootstrap/auth-gateway.ts`), and
the fork has **diverged**: it uses a different cookie name (`alfred_session` vs sprig's
`sprig_session`), and its `seedTokenFromUrl` hard-codes `location.replace("/ui")`. That an app
re-implemented the whole thing (worse) is the strongest signal the framework surface isn't
complete/opinionated enough to just adopt. Goal: alfred deletes all three files and imports
`authFetch` / `getUserData` / `logout` from `@mrg-keystone/sprig`, and a sprig-provided guard.

## Proposed surface

```ts
// @mrg-keystone/sprig (client)
authFetch(input: RequestInfo, init?: RequestInit): Promise<Response>  // fetch-shaped; cookie rides along; 401 → refresh once → retry
getUserData(): { name: string; email: string; grants: string[] } | null   // null when unauthenticated
logout(): Promise<void>                                              // clears server session + cookie (+ infra revoke)
loginWithGoogle(): Promise<{ name: string; email: string }>         // add `name`

// gateway (serveSprig), all server-side:
POST /auth/login       // firebase idToken → infra session.login   (exists)
POST /auth/exchange    // opaque token     → infra authz.exchange   (NEW)  ← fixes the bug
GET  /auth/me          // resolves the session cookie → {name,email,grants}  (NEW; needed for httpOnly)
POST /auth/logout      // (NEW)
// + a Deno-KV session store (rune/keep — see below) holding the credential for silent re-exchange
```

## The session store belongs in rune (Deno KV) — sprig maintainer: open a companion rune feedback

The heavy half of the single-path model is a **server-side session store**, and it should live in
**rune/keep** (not sprig), backed by **Deno KV** — which rune already uses (it *is* the `state`
store). Shape:

```
cookie:   sprig_session = <opaque session id>     (~32 bytes — never near the 4 KB cap)
Deno KV:  ["session", <id>] → { credential, bearer, sessionExpiry, name, email, grants }
```

Flow, entirely server-side in rune — **the token is kept, the exchange is handled there, nothing
sensitive reaches the browser**:
1. **Intake** (`?token=` or a Firebase idToken) → rune exchanges at infra → mints a session id →
   writes `{ the ORIGINAL credential, the bearer, profile }` to Deno KV → sets the httpOnly
   session-id cookie.
2. **Every request** carries the cookie automatically → rune resolves `["session", id]` → if the
   ~1h bearer is near expiry it **silently re-exchanges from the stored credential** (a KV write) →
   reads the grants. No client involvement, no re-login.
3. **logout** → delete the KV entry + clear the cookie (+ optional infra revoke).

Why Deno KV specifically: rune already depends on it, it has **native per-key TTL** (idle sessions
expire themselves), and it's the same store the app's own state lives in — zero new infra. It
solves three gaps at once: the **4 KB cookie limit** (id is tiny; grants grow unbounded), **silent
refresh** (gap #2), and **off-client secrecy** (gap #3).

**⚠️ Action for the sprig maintainer — you must open a companion feedback item in the rune repo.**
This half is rune/keep territory; sprig can't ship it alone. Split of ownership:

- **sprig owns** the *client* surface (`authFetch` / `getUserData` / `logout`, the login UI, the SSR
  guard) and setting/clearing the cookie via the gateway.
- **rune/keep owns** the *server session engine*: the Deno-KV session store, resolving auth from the
  `sprig_session` **cookie** (not only `Authorization`), the infra exchange + **silent refresh** from
  the stored credential, and per-session **TTL**.

Please file that rune-side feedback (e.g. `tooling/rune/feedback/keep-session-store/`) covering
points (a)–(d) above, and cross-link it with this document so the two halves land together — the
single path only works if both ship.

> **Filed:** `tooling/rune/feedback/keep-session-store/README.md` — covers (a)–(d) with verified
> `keep/` file:line citations, and cross-links back to this document.

## Minimal repro

`repro.sh` — deterministic; demonstrates the bug against a live rune-3 backend:
1. Raw `?token=` value as `Authorization: Bearer` → **401** (what sprig produces today).
2. Exchange that token at `/authz/exchange`, present the resulting bearer → **authorized** (what
   sprig should produce). The shape diff (opaque handle vs signed envelope with `kid`/`signature`/
   `claims`) is printed so the "not a bearer" point is concrete.

Provide `INFRA_URL`, `TOKEN` (an opaque infra token), and `BACKEND` (a rune-3 `/api` base with a
non-`@Public` endpoint) via env — no secrets committed.
