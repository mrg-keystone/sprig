// @mrg-keystone/sprig auth — the CLIENT half of sprig's single-path sign-in, owned by the framework
// so apps never hand-roll (and subtly misbuild) it. Auth is a server-managed **httpOnly cookie**
// now: the browser holds NOTHING — no bearer, no localStorage, no JS-readable cookie. The client
// surface is just three actions plus the Google primitive:
//
//   login(token?)  → token → POST /auth/exchange (opaque magic link); none → Google popup →
//                    POST /auth/login (Firebase). The SERVER mints the session and sets the httpOnly
//                    `sprig_session` cookie; this resolves once it's set. Returns {name,email}.
//   getUserData()  → GET /auth/me → {name,email,grants} | null (null when signed out). Async, because
//                    the profile lives server-side (JS can't read the httpOnly bearer).
//   logout()       → POST /auth/logout (server destroys the session + clears the cookie), idempotent.
//
// The cookie rides every same-origin request automatically, so there is NO request wrapper for auth
// — plain `fetch` works. `authFetch`/`apiPost` remain as credential-FREE convenience helpers (base
// path + JSON) for back-compat; they attach nothing. `grants` from `getUserData()` are **UX-only**,
// never a trust boundary: rune verifies the signed bearer and checks grants deny-by-default on every
// call, so a tampered client only lies to its own UI. Pairs with the /auth gateway serveSprig mounts
// (packages/keep/mod.ts), backed by keep's Deno-KV session store (silent refresh, off-client secrecy).
//
// SSR-SAFE: re-exported from @mrg-keystone/sprig, which the SERVER imports too, so every browser-API
// access (document / location) is typeof-guarded and the on-load side effect no-ops outside the browser.

/** The httpOnly session cookie the server sets and keep's SSR guard resolves. Exported so a guard
 *  can key on the exact name (it can only check PRESENCE — the value is server-side and opaque). */
export const SESSION_COOKIE = "sprig_session";
/** Prefix the network backend is mounted under (serveSprig's apiPrefix, default "/api"). */
const API_PREFIX = "/api";

/** The signed-in user for the UI: `{name, email, grants}`, or `null` when there's no session.
 *  Reads `GET /auth/me`, which resolves the httpOnly cookie server-side — the browser can no longer
 *  decode the bearer, so the profile must come from the server. `grants` are UX-only (see header). */
export async function getUserData(): Promise<{ name: string; email: string; grants: string[] } | null> {
  try {
    const res = await fetch("/auth/me", { headers: { accept: "application/json" } });
    if (!res.ok) return null; // 401 → no session
    const body = await res.json().catch(() => null) as
      | { name?: unknown; email?: unknown; grants?: unknown }
      | null;
    if (!body || typeof body !== "object") return null;
    const grants = Array.isArray(body.grants) ? body.grants.filter((g): g is string => typeof g === "string") : [];
    return {
      name: typeof body.name === "string" ? body.name : "",
      email: typeof body.email === "string" ? body.email : "",
      grants,
    };
  } catch {
    return null; // gateway unreachable → treat as signed out
  }
}

/** Full sign-out: the server destroys the session and clears the httpOnly cookie; there is no local
 *  credential to wipe anymore. Idempotent — a no-session logout still resolves cleanly. */
export async function logout(): Promise<void> {
  try {
    await fetch("/auth/logout", { method: "POST" });
  } catch { /* gateway unreachable — the cookie will lapse on its own TTL */ }
}

/** THE single sign-in intake.
 *  - `login(token)` → `POST /auth/exchange { token }` (opaque `?token=` magic-link path).
 *  - `login()`      → Google popup → Firebase idToken → `POST /auth/login { idToken, email }`.
 *  In BOTH cases the SERVER mints the session and sets the httpOnly `sprig_session` cookie; the
 *  client stores nothing. Resolves to `{name, email}` once the cookie is set. Throws `AuthError`
 *  (see its codes) on failure. */
export function login(token?: string): Promise<{ name: string; email: string }> {
  if (typeof token === "string" && token.length > 0) return exchangeToken(token);
  return loginWithGoogle();
}

/** Opaque `?token=` → server exchange → httpOnly cookie. The server returns the profile it decoded
 *  from the freshly-minted bearer (the browser never sees the bearer). */
async function exchangeToken(token: string): Promise<{ name: string; email: string }> {
  const res = await fetch("/auth/exchange", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ token }),
  }).catch(() => null);
  if (res && res.status === 401) throw new AuthError("not-authorized", "This link isn't authorized.");
  if (!res || !res.ok) throw new AuthError("failed", `Sign-in failed${res ? ` (${res.status})` : ""}. Try again.`);
  const body = await res.json().catch(() => null) as { name?: unknown; email?: unknown } | null;
  return {
    name: typeof body?.name === "string" ? body.name : "",
    email: typeof body?.email === "string" ? body.email : "",
  };
}

/** Seed a session from a first-navigation `?token=…` magic link, then STRIP the token from the
 *  address bar and STAY on the page (never leave a credential in a shareable URL, never navigate).
 *  Runs once on load, below. A bad/expired handle leaves the session unset — the SSR guard sends the
 *  next navigation to login, exactly as a bounced magic link should. */
async function seedTokenFromUrl(): Promise<void> {
  if (typeof location === "undefined") return;
  const url = new URL(location.href);
  const t = url.searchParams.get("token");
  if (!t) return;
  // Strip-and-stay: clear the param from history first, then exchange in the background.
  url.searchParams.delete("token");
  try {
    history.replaceState(null, "", url.toString());
  } catch { /* restricted history — ignore */ }
  try {
    await exchangeToken(t);
  } catch { /* bounced link — stay unauthenticated; the guard redirects on the next navigation */ }
}

// Runs once when this module loads in the browser: exchange a magic-link token for a server session.
if (typeof location !== "undefined") {
  void seedTokenFromUrl();
}

/** Fetch-shaped convenience wrapper. Auth is the httpOnly cookie now — it rides every same-origin
 *  request automatically — so this attaches NO credential; it's plain `fetch`, kept only for
 *  back-compat with callers that imported it. A 401 means the session is genuinely gone (keep already
 *  tried silent refresh server-side); the caller decides whether to send the user to login. */
export function authFetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
  return fetch(input, init);
}

/** POST a keep endpoint over the network backend and return its JSON body. A thin POST-only helper
 *  (base path + JSON); the session cookie rides along automatically. Throws on any non-2xx. */
export async function apiPost<T>(path: string, body?: unknown): Promise<T> {
  const res = await fetch(`${API_PREFIX}${path}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body ?? {}),
  });
  if (!res.ok) {
    const detail = await res.text().catch(() => "");
    throw new Error(`api ${path} -> ${res.status} ${detail.slice(0, 160)}`);
  }
  return await res.json() as T;
}

// ─────────────────────────── loginWithGoogle (the Google primitive) ───────────────────────────

/** A typed sign-in failure so the UI can branch: `cancelled` (user closed the popup),
 *  `not-authorized` (infra rejected the account), `unconfigured` (no Firebase config on this
 *  deployment), `failed` (anything else). */
export class AuthError extends Error {
  code: "cancelled" | "not-authorized" | "unconfigured" | "failed";
  constructor(code: AuthError["code"], message: string) {
    super(message);
    this.name = "AuthError";
    this.code = code;
  }
}

// The Firebase web SDK is loaded from its CDN at runtime — same version + pattern as infra's
// own login gate. The Function-wrapped import keeps the island bundler from trying to
// resolve/bundle the remote URL; the browser runs a native dynamic import.
const FIREBASE_APP = "https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js";
const FIREBASE_AUTH = "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";
// deno-lint-ignore no-explicit-any
const importLive = new Function("u", "return import(u)") as (u: string) => Promise<any>;
// deno-lint-ignore no-explicit-any
let authReady: Promise<{ auth: unknown; fb: any }> | null = null;

/** Load the Firebase SDK + this deployment's config ONCE (fetched from the same-origin
 *  /auth gateway serveSprig mounts). Warmed by `warmAuth()` so a click goes straight to the
 *  popup — Safari's transient-activation window after an await is short. */
// deno-lint-ignore no-explicit-any
function prepareAuth(): Promise<{ auth: unknown; fb: any }> {
  if (!authReady) {
    authReady = (async () => {
      const cfgRes = await fetch("/auth/firebase-config");
      if (!cfgRes.ok) throw new AuthError("unconfigured", "Sign-in is not configured on this deployment.");
      const cfg = await cfgRes.json();
      const [app, fb] = await Promise.all([importLive(FIREBASE_APP), importLive(FIREBASE_AUTH)]);
      const fbApp = app.getApps().length ? app.getApp() : app.initializeApp(cfg);
      return { auth: fb.getAuth(fbApp), fb };
    })();
    authReady.catch(() => {
      authReady = null; // a failed load must not poison the retry on the next click
    });
  }
  return authReady;
}

/** Warm the SDK + config ahead of the click (call from an island's onBrowserInit). Optional;
 *  a failure surfaces on the actual `login()` call, not here. */
export function warmAuth(): void {
  prepareAuth().catch(() => {/* retried on the click */});
}

/** The Google sign-in primitive (also reached via `login()` with no argument). Runs the whole flow —
 *  popup → Firebase ID token → the same-origin /auth/login gateway, which mints the server session
 *  and sets the httpOnly cookie — and returns `{name, email}`. The caller decides where to navigate
 *  next (e.g. `location.assign("/ui")`). Throws `AuthError` (see its codes). */
export async function loginWithGoogle(): Promise<{ name: string; email: string }> {
  let idToken: string, email: string, name: string;
  try {
    const { auth, fb } = await prepareAuth();
    const provider = new fb.GoogleAuthProvider();
    provider.setCustomParameters({ prompt: "select_account" });
    const cred = await fb.signInWithPopup(auth, provider);
    idToken = await cred.user.getIdToken();
    email = cred.user.email ?? "";
    name = cred.user.displayName ?? "";
  } catch (e) {
    if (e instanceof AuthError) throw e;
    const code = (e as { code?: string }).code ?? "";
    if (code === "auth/popup-closed-by-user" || code === "auth/cancelled-popup-request") {
      throw new AuthError("cancelled", "Sign-in cancelled.");
    }
    throw new AuthError("failed", e instanceof Error ? e.message : String(e));
  }

  const res = await fetch("/auth/login", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ idToken, email }),
  }).catch(() => null);
  if (res && res.status === 401) throw new AuthError("not-authorized", "This account isn't authorized.");
  if (!res || !res.ok) throw new AuthError("failed", `Sign-in failed${res ? ` (${res.status})` : ""}. Try again.`);
  // Server minted the session + set the httpOnly cookie. It echoes the profile it decoded; prefer the
  // server's name/email, falling back to what the popup gave us (e.g. the display name infra omits).
  const body = await res.json().catch(() => null) as { name?: unknown; email?: unknown } | null;
  return {
    name: typeof body?.name === "string" && body.name ? body.name : name,
    email: typeof body?.email === "string" && body.email ? body.email : email,
  };
}
