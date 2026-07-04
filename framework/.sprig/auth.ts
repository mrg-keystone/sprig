// @mrg-keystone/sprig auth — the client half of sprig's Firebase/Google sign-in, owned by the
// framework so apps don't hand-roll (and subtly misbuild) the popup → exchange → bearer
// transport dance. Pairs with the server /auth gateway that serveSprig auto-mounts
// (packages/keep/mod.ts): the gateway proxies to infra, this attaches the resulting
// infra-signed session bearer to every /api call.
//
// THE PRIMITIVE: `loginWithGoogle()` runs the whole flow and returns the signed-in user;
// the caller decides where to go next. Everything else here is the bearer lifecycle the
// framework now owns: store it (localStorage + the `sprig_session` cookie the SSR guard
// verifies), auto-attach it via `authFetch`, drop it on a real 401, and seed it from a
// `?token=` link — which is EXCHANGED server-side for a real bearer (see below), not stored raw.
//
// CLIENT SURFACE: `authFetch(input, init)` (fetch-shaped, bearer auto-attached),
// `getUserData() -> {name,email,grants} | null`, `logout()`, `loginWithGoogle() -> {name,email}`.
// `apiPost` remains as a thin POST-only wrapper over `authFetch` for back-compat.
//
// NOTE — the httpOnly-cookie + silent-refresh half of the single-path design (holding the
// original credential server-side and re-minting the ~1h bearer transparently) belongs in
// keep's Deno-KV session store; see tooling/rune/feedback/keep-session-store. Until it ships,
// a lapsed bearer signs out and the next navigation re-authenticates.
//
// SSR-SAFE: this module is re-exported from @mrg-keystone/sprig, which the SERVER imports too, so
// every browser-API access (document / localStorage / location) is typeof-guarded and the
// on-load side effects no-op outside the browser.

// ─────────────────────────────── bearer transport ───────────────────────────────
const TOKEN_KEY = "sprig.bearer";
/** The bearer envelope carries the identity (`creator`) + grants (`claims`), but not a display
 *  name — infra's Firebase login doesn't fold it in. We capture it from the sign-in and stash it
 *  here so `getUserData()` can surface `{name}` alongside the decoded email + grants. */
const PROFILE_KEY = "sprig.profile";
/** The cookie the SSR route guard reads + verifies (holds the SAME bearer as localStorage).
 *  A server-side guard sees only cookies on a document navigation — never an Authorization
 *  header — so the bearer travels here too. It is the real, signature-verifiable credential,
 *  not a presence marker. A guard MUST read this exact name. */
export const SESSION_COOKIE = "sprig_session";
const SESSION_MAX_AGE = 60 * 60 * 24 * 30; // 30 days — a storage hint; the guard checks real expiry
/** Prefix the network backend is mounted under (serveSprig's apiPrefix, default "/api"). */
const API_PREFIX = "/api";

function hasDoc(): boolean {
  return typeof document !== "undefined";
}

function writeSessionCookie(bearer: string): void {
  if (!hasDoc()) return;
  const secure = location.protocol === "https:" ? "; secure" : "";
  document.cookie = `${SESSION_COOKIE}=${encodeURIComponent(bearer)}; path=/; max-age=${SESSION_MAX_AGE}; samesite=lax${secure}`;
}

function clearSessionCookie(): void {
  if (!hasDoc()) return;
  document.cookie = `${SESSION_COOKIE}=; path=/; max-age=0; samesite=lax`;
}

/** Store the infra session bearer in BOTH the localStorage copy `apiPost` attaches to /api
 *  calls AND the cookie the SSR guard verifies. Keeping them in lockstep is what lets the
 *  next document navigation authenticate. */
export function setBearer(token: string): void {
  try {
    localStorage.setItem(TOKEN_KEY, token);
  } catch { /* private mode / storage disabled — the bearer just won't persist */ }
  writeSessionCookie(token);
}

/** Full sign-out: forget the bearer in BOTH stores (localStorage + the guard's cookie) and the
 *  cached profile. `logout()` is the public, server-aware surface; this is the local half it
 *  shares with the auto-signout on a lapsed 401. */
export function signOut(): void {
  try {
    localStorage.removeItem(TOKEN_KEY);
  } catch { /* ignore */ }
  clearProfile();
  clearSessionCookie();
}

/** Full sign-out including a best-effort server teardown. The server session revoke (delete the
 *  keep session-store entry + optional infra revoke) lands with tooling/rune/feedback/keep-session-store;
 *  until that route exists the call is a harmless no-op and only the local state is cleared. */
export async function logout(): Promise<void> {
  try {
    await fetch("/auth/logout", { method: "POST" });
  } catch { /* route may not exist yet — the local clear below is the real teardown today */ }
  signOut();
}

function storeProfile(name: string): void {
  try {
    localStorage.setItem(PROFILE_KEY, JSON.stringify({ name }));
  } catch { /* private mode — profile just won't persist */ }
}

function readProfileName(): string {
  try {
    const raw = localStorage.getItem(PROFILE_KEY);
    if (!raw) return "";
    const p = JSON.parse(raw) as { name?: unknown };
    return typeof p.name === "string" ? p.name : "";
  } catch {
    return "";
  }
}

function clearProfile(): void {
  try {
    localStorage.removeItem(PROFILE_KEY);
  } catch { /* ignore */ }
}

/** The identity + grants half of the profile, read straight off the stored bearer. keep verifies
 *  the signature; the client only DECODES for display, so no verification runs here. Accepts
 *  infra's envelope as raw JSON or base64url(JSON) (the two wire forms keep's parser accepts). */
type BearerClaim = { key?: unknown; value?: unknown };
function decodeBearer(token: string): { creator: string; claims: BearerClaim[] } | null {
  const trimmed = (token ?? "").trim();
  if (!trimmed) return null;
  const asObject = (s: string): { creator: string; claims: BearerClaim[] } | null => {
    try {
      const o = JSON.parse(s) as { creator?: unknown; claims?: unknown };
      if (!o || typeof o !== "object") return null;
      return {
        creator: typeof o.creator === "string" ? o.creator : "",
        claims: Array.isArray(o.claims) ? o.claims as BearerClaim[] : [],
      };
    } catch {
      return null;
    }
  };
  const direct = asObject(trimmed);
  if (direct) return direct;
  try {
    const pad = "=".repeat((4 - (trimmed.length % 4)) % 4);
    const bin = atob(trimmed.replaceAll("-", "+").replaceAll("_", "/") + pad);
    const bytes = Uint8Array.from(bin, (ch) => ch.charCodeAt(0));
    return asObject(new TextDecoder().decode(bytes));
  } catch {
    return null;
  }
}

/** The signed-in user for the UI: `{name, email, grants}`, or `null` when there's no session.
 *  `email` + `grants` come from the stored bearer's envelope (`creator` + `claims`); `name` from
 *  the profile captured at sign-in. A grant is rendered `key` (or `key:value` when scoped). */
export function getUserData(): { name: string; email: string; grants: string[] } | null {
  const t = bearer();
  if (!t) return null;
  const env = decodeBearer(t);
  const grants = (env?.claims ?? [])
    .map((c) => {
      const key = typeof c.key === "string" ? c.key : "";
      if (!key) return "";
      const value = typeof c.value === "string" ? c.value : "";
      return value ? `${key}:${value}` : key;
    })
    .filter(Boolean);
  return { name: readProfileName(), email: env?.creator ?? "", grants };
}

function bearer(): string | null {
  try {
    return localStorage.getItem(TOKEN_KEY);
  } catch {
    return null;
  }
}

/** True when a bearer is stashed (for a login page's "already signed in" self-heal). */
export function hasSession(): boolean {
  return bearer() !== null;
}

/** Seed the infra bearer from a first-navigation `?token=…` magic link. The opaque handle is
 *  EXCHANGED server-side (`POST /auth/exchange` → infra → real bearer) before it's stored — a raw
 *  handle is NOT a bearer and would 401 keep's JWKS verification on every /api call. Strips the
 *  token from the address bar first (never leave a credential in a shareable URL) and STAYS on the
 *  current page — no navigation. Runs once on load, below. */
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
    const res = await fetch("/auth/exchange", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ token: t }),
    });
    if (res.ok) {
      const out = await res.json().catch(() => null) as { token?: string } | null;
      if (out?.token) setBearer(out.token);
    }
    // A non-ok exchange (bad/expired handle) leaves the session unset — the SSR guard sends the
    // next navigation to the login route, exactly as a bounced magic link should.
  } catch { /* exchange upstream unreachable — stay unauthenticated */ }
}

// Runs once when this module loads in the browser: exchange a magic-link token, then self-heal
// a browser that kept the localStorage bearer but lost the guard cookie (expired / predates
// the cookie) by re-writing it, so the SSR guard can verify again instead of bouncing.
if (typeof location !== "undefined") {
  void (async () => {
    await seedTokenFromUrl();
    const b = bearer();
    if (b) writeSessionCookie(b);
  })();
}

/** True when a request targets this origin — a relative URL, or an absolute one whose origin
 *  matches. We attach the bearer ONLY to same-origin requests so `authFetch(thirdPartyUrl)` can
 *  never exfiltrate the credential. Outside the browser (SSR) everything is treated same-origin. */
function isSameOrigin(input: RequestInfo | URL): boolean {
  if (!hasDoc()) return true;
  const href = input instanceof Request ? input.url : String(input);
  try {
    return new URL(href, location.href).origin === location.origin;
  } catch {
    return true; // unparseable → treat as relative/same-origin
  }
}

/** Fetch-shaped, session-aware request. Auto-attaches the bearer (same-origin only) unless the
 *  caller already set an Authorization header, then behaves like `fetch`. On a 401 that CARRIED a
 *  bearer (a lapsed ~1h session) it signs out so the next navigation re-authenticates — an
 *  anonymous 401 is left alone (it isn't an expiry, and must not clear a session another tab / the
 *  sign-in flow just set). Silent refresh from a stored credential slots in here once keep's
 *  session store ships (tooling/rune/feedback/keep-session-store); today a lapse means re-login. */
export async function authFetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
  const t = bearer();
  const headers = new Headers(init?.headers);
  if (t && isSameOrigin(input) && !headers.has("authorization")) {
    headers.set("authorization", `Bearer ${t}`);
  }
  const res = await fetch(input, { ...init, headers });
  if (res.status === 401 && t) signOut();
  return res;
}

/** POST a keep endpoint over the network backend and return its JSON body. A thin POST-only
 *  wrapper over `authFetch` (kept for back-compat; new code can call `authFetch` for any method).
 *  Throws on any non-2xx. */
export async function apiPost<T>(path: string, body?: unknown): Promise<T> {
  const res = await authFetch(`${API_PREFIX}${path}`, {
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

// ─────────────────────────── loginWithGoogle (the primitive) ───────────────────────────

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
 *  a failure surfaces on the actual `loginWithGoogle()` call, not here. */
export function warmAuth(): void {
  prepareAuth().catch(() => {/* retried on the click */});
}

/** THE sign-in primitive. Runs the whole Google flow — popup → Firebase ID token → exchange
 *  at the same-origin /auth/login gateway for the infra-signed session bearer → store it for
 *  every /api call + the SSR guard — and returns the signed-in user `{name, email}`. The caller
 *  decides where to navigate next (e.g. `location.assign("/ui")`). Throws `AuthError` (see its
 *  codes). The `name` is captured here (the bearer envelope doesn't carry it) so `getUserData()`
 *  can surface it. */
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
  const session = await res.json().catch(() => null) as { token?: string } | null;
  if (!session?.token) throw new AuthError("failed", "Login succeeded but no session bearer was issued.");

  setBearer(session.token);
  storeProfile(name);
  return { name, email };
}
