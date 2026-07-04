# sprig: the client auth surface is cookie-based now — `login(token?)`, `getUserData()`, `logout()`, no fetch wrapper

**Component:** `framework/.sprig/auth.ts` + the `/auth` gateway in `packages/keep/mod.ts`.

**Companion to** `tooling/sprig/feedback/framework-auth/README.md` (the wiring audit). Once the
session store owns the httpOnly cookie + the bearer (see that doc's AUDIT section and
`tooling/rune/feedback/keep-session-store/`), the browser holds **nothing** — so the client surface
collapses to three auth actions and **no request wrapper**.

**Part of the identity chain:**
- `infra/main/feedback/user-profile-in-exchange/` — infra returns `{name, email}`.
- `tooling/rune/feedback/session-profile-endpoint/` — keep caches it + exposes `GET /auth/me`.
- **this doc (sprig)** — `getUserData()` reads `/auth/me`; `login()`/`logout()` drive the cookie.

## The surface sprig should expose

1. **`login(token?)` — the single intake.**
   - `login(<token>)` → `POST /auth/exchange { token }` (opaque `?token=` path).
   - `login()` (no arg) → Google popup → `POST /auth/login { idToken, email }` (Firebase path).
   - **Both:** the *server* mints the session and sets the **httpOnly** `sprig_session` cookie; the
     client stores **nothing** (no `localStorage`, no client-set cookie, no bearer). Resolves once
     the cookie is set.
   - This replaces today's split (`loginWithGoogle()` + the `?token=` seed side-effect) with one
     entry point. The `?token=` on-load handler just calls `login(t)` then strips the param.

2. **`getUserData()` → `{ name, email, grants } | null`.**
   - `GET /auth/me` (resolves the cookie server-side) → `{ name, email, grants }`.
   - **`null` when there's no session cookie** (unauthenticated).
   - The client can no longer decode the bearer (it's httpOnly + server-side), so the current
     client-side `decodeBearer` path is dead — read everything from `/auth/me`.
   - **`grants` are UX-only, NOT a trust boundary.** They're returned so the UI can show/hide the
     right controls (good UX) — nothing more. rune is the sole enforcer: it verifies the *signed*
     bearer and checks grants deny-by-default on every call. A tampered client can only lie to its
     own UI; every gated action still 403s server-side. So surfacing grants to the browser is safe.

3. **`logout()` → wipe the session.**
   - `POST /auth/logout` → keep `destroySession(id)` + the gateway clears the cookie. Then any local
     UI state resets. Idempotent.

4. **Remove the request wrapper.** Auth is the httpOnly cookie now — it rides every same-origin
   request automatically — so **`authFetch`/`apiPost` are no longer needed for auth**; plain `fetch`
   works. (Keep a thin base-path/JSON convenience helper if you like, but it must carry **no**
   credential — the cookie does that.)

## Net client API

```ts
login(token?: string): Promise<{ name: string; email: string }>                  // token → exchange; none → Google
getUserData(): Promise<{ name: string; email: string; grants: string[] } | null> // GET /auth/me; grants = UX-only; null when signed out
logout(): Promise<void>                                                          // POST /auth/logout + cookie clear
```

That's the whole thing. No bearer, no `localStorage`, no `authFetch`. Depends on the keep `/auth/me`
+ `intakeSession` cookie wiring (framework-auth AUDIT) and infra returning `{name, email}`.

---

## APPLIED (2026-07-04)

`framework/.sprig/auth.ts` now exposes exactly this surface: `login(token?)`, async `getUserData()`
(reads `GET /auth/me`), `logout()`. The client stores nothing — the server sets the httpOnly
`sprig_session` cookie. The bearer / `localStorage` / `decodeBearer` / `setBearer` / `signOut` /
`hasSession` paths are deleted. `authFetch`/`apiPost` remain only as credential-free convenience
helpers (plain `fetch`; the cookie carries auth). See `feedback/framework-auth/` → "APPLIED" for the
gateway half. Note: `name` currently surfaces keep's `creator` until infra returns a real display
name (see `tooling/rune/feedback/session-profile-endpoint/`).
