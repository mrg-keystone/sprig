/// <reference lib="dom" />
// @sprig/core auth — the client half of sprig's Firebase/Google sign-in, owned by the
// framework so apps don't hand-roll (and subtly misbuild) the popup → exchange → bearer
// transport dance. Pairs with the server /auth gateway that serveSprig auto-mounts
// (packages/keep/mod.ts): the gateway proxies to infra, this attaches the resulting
// infra-signed session bearer to every /api call.
//
// THE PRIMITIVE: `loginWithGoogle()` runs the whole flow and returns the signed-in user;
// the caller decides where to go next. Everything else here is the bearer lifecycle the
// framework now owns: store it (localStorage + the `sprig_session` cookie the SSR guard
// verifies), auto-attach it to /api, drop it on a real 401, seed it from a `?token=` link.
//
// SSR-SAFE: this module is re-exported from @sprig/core, which the SERVER imports too, so
// every browser-API access (document / localStorage / location) is typeof-guarded and the
// on-load side effects no-op outside the browser.

// ─────────────────────────────── bearer transport ───────────────────────────────
const TOKEN_KEY = "sprig.bearer";
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

/** Full sign-out: forget the bearer in BOTH stores (localStorage + the guard's cookie). */
export function signOut(): void {
  try {
    localStorage.removeItem(TOKEN_KEY);
  } catch { /* ignore */ }
  clearSessionCookie();
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

/** Seed the infra bearer from a first-navigation `?token=…` magic link, then re-enter the
 *  app THROUGH the verified guard (a bogus token bounces back to the login route — never
 *  loops or leaks). Strips the token from history first. Runs once on load, below. */
function seedTokenFromUrl(): void {
  if (typeof location === "undefined") return;
  const url = new URL(location.href);
  const t = url.searchParams.get("token");
  if (!t) return;
  setBearer(t);
  url.searchParams.delete("token");
  try {
    history.replaceState(null, "", url.toString());
  } catch { /* restricted history — ignore */ }
  location.replace(url.pathname.replace(/\/(login|sign-?in)\/?$/i, "") || "/");
}

// Runs once when this module loads in the browser: seed a magic-link token, then self-heal
// a browser that kept the localStorage bearer but lost the guard cookie (expired / predates
// the cookie) by re-writing it, so the SSR guard can verify again instead of bouncing.
if (typeof location !== "undefined") {
  seedTokenFromUrl();
  const b = bearer();
  if (b) writeSessionCookie(b);
}

/** POST a keep endpoint over the network backend and return its JSON body. Attaches the
 *  session bearer; on a 401 that HAD a bearer (stale/expired) it signs out so the next
 *  navigation lands on the login route — an anonymous 401 is left alone (it isn't a session
 *  expiry, and must not clear a session another tab / the sign-in flow just set). Throws on
 *  any non-2xx. */
export async function apiPost<T>(path: string, body?: unknown): Promise<T> {
  const headers: Record<string, string> = { "content-type": "application/json" };
  const t = bearer();
  if (t) headers["authorization"] = `Bearer ${t}`;
  const res = await fetch(`${API_PREFIX}${path}`, {
    method: "POST",
    headers,
    body: JSON.stringify(body ?? {}),
  });
  if (res.status === 401 && t) signOut();
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
 *  every /api call + the SSR guard — and returns the signed-in user. The caller decides where
 *  to navigate next (e.g. `location.assign("/ui")`). Throws `AuthError` (see its codes). */
export async function loginWithGoogle(): Promise<{ email: string }> {
  let idToken: string, email: string;
  try {
    const { auth, fb } = await prepareAuth();
    const provider = new fb.GoogleAuthProvider();
    provider.setCustomParameters({ prompt: "select_account" });
    const cred = await fb.signInWithPopup(auth, provider);
    idToken = await cred.user.getIdToken();
    email = cred.user.email ?? "";
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
  return { email };
}
