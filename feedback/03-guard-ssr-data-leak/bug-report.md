# Bug report: a guard-pass renders the protected page's DATA into the first SSR document — so the `?token=` login handshake leaks the payload to an unauthenticated visitor

- **Package:** `@sprig/core` 0.14.0 (repo @ `443d67a`)
- **Severity:** high — a protected page's server data is served to an anonymous
  visitor who appends `?token=<anything>` to the URL. No valid token, no cookie, no
  `/api` call. The subsequent client-side `/api` reads correctly 401, but the data is
  already in the first HTML document.
- **Observed on:** alfred (`http://localhost:3000/ui`, fused `serveSprig` host,
  2026-07-02) and the repro below against this repo's framework code.
- **Repro:** [`repro/`](repro/README.md) — two scripts, no browser.

## Symptom (live, on alfred)

The whole app subtree sits behind a `requireLogin` guard. Anonymous → login:

```
GET /ui/overview            → HTTP 302  location=/ui/login          (no data)
GET /ui/overview?token=3    → HTTP 200  (109 KB of HTML)            ← leak
POST /api/http/overview  (no/garbage bearer)   → HTTP 401           (real auth works)
```

The `?token=3` HTML — served to a client with **no cookie and no valid token** —
contains the protected records inline:

```
"phone":"+1 437 555 2628"  "disposition":"transferred"  "reason":"Pricing the AI could not answer"
"phone":"+1 615 555 3952"  "disposition":"abandoned"    "reason":"Long pause then disconnected"
… (full call list, customer PII)
```

So the SSR render's confidentiality rests **entirely** on the guard, and the guard
passed on an attacker-controlled query param.

## Root cause

Two facts combine. The first is app-level; the second and third are sprig-level and
are what make this a framework footgun rather than a one-off app bug.

### 1. (app) the guard passes on the login handshake

The magic-link pattern: a `?token=<bearer>` link is the login handshake, so the guard
lets it through for the client to seed the bearer + marker cookie and strip the query.
alfred's guard (and the fixture's `src/guards.ts`) does exactly this:

```ts
if (ctx.url.searchParams.has("token")) return ctx.path;   // pass — it's a handshake
```

This is the trigger, and yes, trusting the mere *presence* of `token` is too loose.
But **even a stricter guard cannot avoid the leak** for a genuine handshake: the whole
point of a magic-link is that the visitor is *not yet authenticated server-side* — the
token has to reach the client so the client can exchange it. Any guard that lets that
first navigation through hits facts 2+3.

### 2. (sprig) a guard-pass unconditionally renders trusted-backend data

In `bootstrap()` (`framework/.sprig/core.ts`), a guard returns either the target route
(pass) or a different route (302). On pass, the very next steps run `resolve()` and
embed its result in the document:

```
guard loop returns target  (core.ts ~608-626)
      ↓  no other gate
resolve() runs on the route injector, reads inject(Backend)  (core.ts ~640-649)
      ↓
inputs serialized into the SSR HTML / island props bridge
```

`Backend` is the in-process keep client — **trusted, no auth** (that's by design;
`serveSprig` binds it per request). So "guard passed" is treated as "render the data."
There is no third guard outcome — no "allow the route shell but withhold the data."

### 3. (sprig) `resolve()` has no auth signal, so the data layer can't defend itself

`ResolveCtx` is `{ params, url }` only (`core.ts:385-389`; the call site passes exactly
that at `core.ts:645`). No headers, no cookie — proven at runtime by
[`repro/02-resolve-cannot-see-auth.ts`](repro/02-resolve-cannot-see-auth.ts), which
sends a request *with* a cookie and an `Authorization` header and shows `resolve()`
receives `[params, url]`. The guard (`GuardCtx.headers`) is the **only** layer that
ever sees the auth cookie — and the framework itself documents this (the `GuardCtx`
JSDoc: cookies on the navigation are "what makes a server-side auth guard possible at
all"). So once the guard permits the request, `resolve()` cannot tell an authenticated
caller from an attacker who appended `?token=`, and cannot decline to load the records.

**Net:** the guard is the sole confidentiality boundary for SSR data (fact 2), and it
is the sole place with an auth signal (fact 3). The one pattern that legitimately needs
a guard to pass an *as-yet-unauthenticated* request — the token handshake — therefore
leaks the first data payload **by construction**. The framework invites the pattern
(it hands the guard `url` incl. the query, and points at cookies for auth) but gives no
safe way to express it.

## The only current-API workaround (and why it's a footgun)

A guard and the page's `resolve()` share the route injector (`GuardCtx` JSDoc: "a
service a guard instantiates is the SAME instance the page's resolve() later injects").
So a guard *could* stash a `provisional: true` flag in a request-scoped service on the
handshake path, and every `resolve()` could inject it and skip the data. That works,
but it is undocumented for this purpose and fails open: it relies on *every* protected
`resolve.ts` remembering to check the flag. Miss one and it silently leaks.

## Suggested fixes (a menu — none mutually exclusive)

1. **A third guard outcome: "allow shell, skip resolve."** Let a guard signal
   "permitted, but render data-less" (e.g. a sentinel return, or `ctx.deferData()`).
   `bootstrap()` skips `resolve()` and renders the page with empty inputs; the client
   completes the handshake and re-navigates authenticated. This fixes the handshake
   case directly and keeps the guard as the one decision point.
2. **Give `resolve()` a read-only auth view.** Add `headers` (or a narrower
   `cookies` / `authed` signal) to `ResolveCtx` so a data loader can defensively
   decline. Turns fact 3 from a dead end into a real second gate.
3. **A first-class handshake helper.** A documented "seed token on the client, then
   redirect to the clean URL" primitive so apps stop hand-rolling the leaky
   `?token=` pass-through in a guard.

Fix 1 is the tightest fit for the reported leak; 2 is the most general.

## Scope

The immediate trigger is an app guard (alfred's), and tightening that guard reduces
blast radius — but it does not remove the leak class, because the token handshake
*requires* passing an unauthenticated request, and facts 2+3 are pure framework. This
is filed against sprig because only the framework can offer a safe way to render an
authenticated shell without its data, or to let the data layer see the auth signal.
