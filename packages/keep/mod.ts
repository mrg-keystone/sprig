/**
 * @mrg-keystone/sprig/keep — composes a keep backend and a sprig UI into ONE single-origin
 * `{ fetch }` handler (a Deno.ServeDefaultExport), and binds keep's in-process
 * client to the `Backend` token so `resolve.ts` reads data with no token, no TCP.
 *
 * This is the whole composition root — the app author writes `serveSprig({...})`,
 * not a hand-rolled path dispatcher + globalThis bridge.
 */
import { backendClient, type Guard, isLayoutLoad, type Route, type RouteMeta, type SprigApp } from "@mrg-keystone/sprig";
import { join, toFileUrl } from "@std/path";
// Third-party browser libs VENDORED INTO the server source (imported as TEXT → part of the
// module graph, not a disk read, so they ship whether sprig runs from ~/.sprig or straight
// from JSR). serveSprig hands them to the client at <base>/_assets/vendor/<name>; every app
// AND the isolate workbench gets them without compiling them into its own frontend bundle.
// The app declares these in deno.json ONLY for type-checking — this vendored copy is the one
// and only version that actually runs (same "CLI owns the runtime" rule as @mrg-keystone/sprig).
// Load each vendored lib as TEXT from this module's OWN location — works both from a local file://
// install (~/.sprig) and the published https:// JSR module. (A static `import … with { type: "text" }`
// can't be published: JSR's module-graph builder rejects the text import attribute. Same eagerness as
// the old text import, which embedded all 561K in the graph regardless.)
const readVendor = async (name: string): Promise<string> => {
  const u = new URL(`./vendor/${name}`, import.meta.url);
  return u.protocol === "file:" ? await Deno.readTextFile(u) : await (await fetch(u)).text();
};
const VENDOR: Record<string, { body: string; type: string }> = {
  "apexcharts.js": { body: await readVendor("apexcharts.js"), type: "text/javascript; charset=utf-8" },
};

// The SSR renderer is server-only (Deno APIs) so it can't live in client-safe
// @mrg-keystone/sprig; it belongs with the rest of the server glue. The actual COMPILER
// (buildClient + the tree-sitter parser) is CLI-only and is NOT re-exported here.
export { createRenderer, type SsrRenderer } from "../../framework/.sprig/compiler/mod.ts";
import { assetsVersioner } from "../../framework/.sprig/compiler/hash.ts";

// ───────────────────────────── JSON folder routing ─────────────────────────────
// Routes as data: `src/root.json` is the entry table; a route whose `load` is a `routers/<name>`
// pulls its children from `src/routers/<name>/routes.json`, and `guards: ["<name>"]` resolves to
// `src/guards/<name>/guard.ts`'s exported guard. Declarative route tables (no imports) that compose
// folder-first. `defineRoutes([...])` in TS still works — this just produces the same Route[].
interface RawRoute {
  path: string;
  load?: string;
  guards?: string[];
  requiredGrant?: string;
  meta?: RouteMeta;
  children?: RawRoute[];
}

async function routeFileExists(p: string): Promise<boolean> {
  try {
    await Deno.stat(p);
    return true;
  } catch {
    return false;
  }
}

async function resolveGuards(names: string[], srcDir: string): Promise<Guard[]> {
  const guards: Guard[] = [];
  for (const name of names) {
    // a guard is a folder: guards/<name>/mod.ts (+ its test.ts). guard.ts is the legacy filename.
    const dir = join(srcDir, "guards", name);
    const path = (await routeFileExists(join(dir, "mod.ts"))) ? join(dir, "mod.ts") : join(dir, "guard.ts");
    const mod = await import(toFileUrl(path).href) as Record<string, unknown>;
    const fn = (mod.default ?? mod.guard ?? Object.values(mod).find((v) => typeof v === "function")) as Guard | undefined;
    if (typeof fn !== "function") {
      throw new Error(`sprig loadRoutes: guard "${name}" — ${path} must export a guard function (default or named).`);
    }
    guards.push(fn);
  }
  return guards;
}

async function mapRouteTable(entries: RawRoute[], srcDir: string): Promise<Route[]> {
  const out: Route[] = [];
  for (const e of entries) {
    const route: Route = { path: e.path };
    if (e.load) route.load = e.load;
    if (e.requiredGrant) route.requiredGrant = e.requiredGrant;
    if (e.meta) route.meta = e.meta;
    if (e.guards?.length) route.guards = await resolveGuards(e.guards, srcDir);
    // children = inline children (recursively) + a router's OWN routes.json (routers/<name>/…)
    const children: Route[] = e.children ? await mapRouteTable(e.children, srcDir) : [];
    if (isLayoutLoad(e.load)) {
      const table = join(srcDir, e.load!, "routes.json");
      if (await routeFileExists(table)) {
        const sub = JSON.parse(await Deno.readTextFile(table)) as RawRoute[];
        children.push(...await mapRouteTable(sub, srcDir));
      }
    }
    if (children.length) route.children = children;
    out.push(route);
  }
  return out;
}

/** Load the app's route tree from JSON folder tables: `<srcDir>/root.json` (the entry table), each
 *  `routers/<name>/routes.json` (a layout's children), and `guards/<name>/guard.ts` (guards resolved
 *  by name). Produces the same `Route[]` `bootstrap()` consumes — `defineRoutes([...])` still works. */
export async function loadRoutes(srcDir: string): Promise<Route[]> {
  // The entry is the routers/root/ router — its routes.json is the top-level table, its template.html
  // the root layout, its logic.ts the shared root hooks (a regular router that IS the entrypoint).
  // Legacy: a flat src/root.json table with no root layout. Prefer the folder.
  if (await routeFileExists(join(srcDir, "routers", "root", "routes.json"))) {
    return await mapRouteTable([{ path: "", load: "routers/root" }], srcDir);
  }
  const raw = JSON.parse(await Deno.readTextFile(join(srcDir, "root.json"))) as RawRoute[];
  return await mapRouteTable(raw, srcDir);
}

/** A credential handed to keep's session engine: a Firebase idToken or an opaque `?token=` handle. */
export interface SessionIntake {
  credential: string;
  credentialKind: "firebase" | "opaque";
  email?: string;
}
/** What `keep.intakeSession` returns — the opaque session id (goes in the httpOnly cookie) plus the
 *  decoded profile the gateway surfaces to the browser (the bearer NEVER leaves the server). */
export interface SessionMinted {
  id: string;
  creator: string;
  email?: string;
  grants: string[];
}
/** The cached profile `/auth/me` reads back off a resolved session (grants are UX-only here — the
 *  request-path guard still enforces them deny-by-default from the verified bearer). */
export interface SessionProfile {
  name?: string;
  email?: string;
  grants?: string[];
}

/** The slice of keep's `bootstrapServer(...)` result that serveSprig consumes. */
export interface KeepApi {
  /** the IN-PROCESS client: typeof fetch, dispatches relative paths through the
   *  full pipeline with no TCP, bypassing token auth. SSR-only. */
  backend: { fetch: typeof fetch };
  /** the NETWORK handler: token-gated; forward Deno.ServeHandlerInfo into it. */
  handler: (req: Request, info?: Deno.ServeHandlerInfo) => Response | Promise<Response>;
  /** keep's cookie-session engine — present only when keep enabled `KEEP_SESSION_KV`. When it is,
   *  the /auth gateway mints an httpOnly `sprig_session` id via `intakeSession` (the bearer stays
   *  server-side) and reads/clears it via `sessions.read` / `destroySession`; when it is absent the
   *  gateway degrades to the legacy proxy that hands the bearer to the browser. */
  intakeSession?: (input: SessionIntake) => Promise<SessionMinted>;
  destroySession?: (id: string) => Promise<void>;
  sessions?: { read(id: string): Promise<SessionProfile | null> };
}

export interface ServeSprigConfig {
  keep: KeepApi;
  app: SprigApp;
  /** where the UI mounts (default "/ui"). keep owns apiPrefix + docsPrefix. */
  base?: string;
  apiPrefix?: string; // default "/api"
  docsPrefix?: string; // default "/docs"
  /** directory served at <base>/_assets/* (the build's client.js etc.); default "static". */
  assetsDir?: string;
  /** Firebase/Google sign-in. When an infra URL is resolvable here (or via the INFRA_URL env),
   *  serveSprig auto-mounts the same-origin /auth gateway that sprig's `loginWithGoogle()` and
   *  `?token=` seeding (@mrg-keystone/sprig) call — proxying `/auth/firebase-config`, `/auth/login`
   *  (Firebase idToken → bearer) and `/auth/exchange` (opaque `?token=` → bearer) to infra so the
   *  browser never touches the control plane cross-origin. Omit (and unset INFRA_URL) to leave
   *  /auth to the app.
   *
   *  `exchangePath` is infra's opaque-token exchange endpoint (default `/api/authz/exchange`,
   *  mirroring the `/api/session/login` convention). The default is the one value to confirm
   *  against your infra deployment; override here or via the `INFRA_EXCHANGE_PATH` env var. */
  auth?: { infraUrl?: string; exchangePath?: string };
}

const ASSET_TYPES: Record<string, string> = {
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".map": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".json": "application/json; charset=utf-8",
};

/** Methods the WHATWG Fetch spec forbids the Request constructor from carrying.
 *  serveSprig re-wraps incoming requests, so these must be rejected BEFORE the
 *  re-wrap (else `new Request(...)` throws an uncaught TypeError → bare 500). */
const FORBIDDEN_METHODS = new Set(["TRACE", "TRACK", "CONNECT"]);

/** Bound on the request-body size and JSON nesting depth accepted at the gateway,
 *  so a tiny but deeply-nested body cannot exhaust the call stack downstream. */
const MAX_BODY_BYTES = 4 * 1024 * 1024;
const MAX_JSON_DEPTH = 200;

/** Derive the lookup extension from the BASENAME (the segment after the last
 *  "/"), lower-cased; "" when there is no dot in the basename. Never reads across
 *  a "/" separator (bug 93) and never mis-keys an extensionless name to its
 *  trailing character (bug 91). Exported for direct regression testing. */
export function assetExt(file: string): string {
  const base = file.slice(file.lastIndexOf("/") + 1);
  const dot = base.lastIndexOf(".");
  return dot < 0 ? "" : base.slice(dot).toLowerCase();
}

/** Derive a content-type from the file's extension (case-insensitive). */
function contentTypeFor(file: string): string {
  return ASSET_TYPES[assetExt(file)] ?? "application/octet-stream";
}

/** Non-recursive depth scan of a JSON string: returns the max nesting depth of
 *  arrays/objects, ignoring braces inside string literals. O(n), no stack use —
 *  so it can reject a stack-exhausting body WITHOUT itself recursing. */
function jsonDepth(text: string): number {
  let depth = 0, max = 0, inStr = false, esc = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inStr) {
      if (esc) esc = false;
      else if (c === "\\") esc = true;
      else if (c === '"') inStr = false;
      continue;
    }
    if (c === '"') inStr = true;
    else if (c === "[" || c === "{") {
      if (++depth > max) max = depth;
    } else if (c === "]" || c === "}") depth--;
  }
  return max;
}

/** esbuild's content-hashed chunk names (chunk-XXXXXXXX.js, 8 base32 chars). These are
 *  content-addressed by FILENAME — new bytes always mean a new name — so `immutable`
 *  is sound for them even without a ?v= (they're fetched via bare relative imports,
 *  which don't inherit the importer's query). The pattern is deliberately tight so a
 *  hand-authored "chunk-utils.js" can never be wrongly pinned for a year. */
const HASHED_CHUNK = /^chunk-[A-Z0-9]{8}\.js$/;

async function serveAsset(
  dir: string,
  file: string,
  req: Request,
  version?: () => Promise<string | null>,
): Promise<Response> {
  // static files answer only to GET/HEAD
  if (req.method !== "GET" && req.method !== "HEAD") {
    return new Response("Method Not Allowed", {
      status: 405,
      headers: { "allow": "GET, HEAD" },
    });
  }
  // percent-decode the file segment before disk lookup, so a non-ASCII asset
  // name (e.g. isl.café-card.js, requested as isl.caf%C3%A9-card.js) resolves to
  // its file on disk instead of 404-ing. A malformed escape (e.g. a lone "%")
  // throws URIError → clean 400 rather than a crash. Mirrors dev.ts's AST endpoint.
  let decoded: string;
  try {
    decoded = decodeURIComponent(file);
  } catch {
    return new Response("Bad Request", { status: 400 });
  }
  // contain to dir (no path traversal): reject only a real ".." path SEGMENT,
  // not a legitimate single-segment name that merely contains a ".." substring.
  // The guard runs AFTER decoding so an encoded "..%2f" traversal is still caught.
  // Split on BOTH separators: Windows treats "\" as a path separator too, so an
  // encoded backslash ("..%5c") must be caught as well — not just "/" (".."%2f).
  if (decoded.split(/[/\\]/).includes("..")) return new Response("Forbidden", { status: 403 });
  try {
    const path = `${dir}/${decoded}`;
    const stat = await Deno.stat(path);
    // `immutable` may only ever be sent for a CONTENT-ADDRESSED request — one whose
    // URL is guaranteed to change when the bytes change: either ?v= equals the served
    // dir's CURRENT content hash, or the file is a content-hash-named chunk. Anything
    // else (?v=dev from a degraded version, a missing ?v=, a stale hash from a browser
    // that cached an older deploy) gets `no-cache` = revalidate before reuse — the
    // ETag/304 path below makes that one cheap conditional request, not a re-download.
    // Unconditional `immutable` here is what turned a frozen ?v= into browsers wedged
    // on a year-long cache of a dead deploy (every island failing to hydrate).
    const q = new URL(req.url).searchParams.get("v");
    const cur = version ? await version() : null;
    const addressed = (cur !== null && q === cur) || HASHED_CHUNK.test(decoded.slice(decoded.lastIndexOf("/") + 1));
    // cache validators so conditional GETs can 304 instead of re-transferring
    const lastModified = stat.mtime ?? new Date(0);
    const etag = `W/"${stat.size.toString(16)}-${lastModified.getTime().toString(16)}"`;
    const inm = req.headers.get("if-none-match");
    const ims = req.headers.get("if-modified-since");
    const notModified = (inm !== null && inm === etag) ||
      (inm === null && ims !== null && new Date(ims).getTime() >= Math.floor(lastModified.getTime() / 1000) * 1000);
    const headers: Record<string, string> = {
      "content-type": contentTypeFor(file),
      "cache-control": addressed ? "public, max-age=31536000, immutable" : "no-cache",
      "etag": etag,
      "last-modified": lastModified.toUTCString(),
    };
    if (notModified) return new Response(null, { status: 304, headers });
    const bytes = await Deno.readFile(path);
    return new Response(req.method === "HEAD" ? null : bytes, { headers });
  } catch {
    return new Response("Not Found", { status: 404 });
  }
}

export interface ServeDefaultExport {
  fetch(req: Request, info: Deno.ServeHandlerInfo): Promise<Response>;
}

// ─────────────────────────────── /auth sign-in gateway ───────────────────────────────
// The same-origin endpoints sprig's client auth (@mrg-keystone/sprig) needs. Everything is
// server-side: the browser never calls infra cross-origin (infra's /api sets no CORS headers) and,
// once keep's cookie-session engine is on, never holds a bearer at all.
//   GET  /auth/firebase-config → <infra>/firebase-config.json   (public web config, 5-min cached)
//   POST /auth/login           → Firebase idToken  → session     (`login()` no-arg / Google popup)
//   POST /auth/exchange        → opaque ?token=     → session     (`login(token)` / magic link)
//   GET  /auth/me              → the session cookie → {name,email,grants} | 401
//   POST /auth/logout          → destroy the session + clear the cookie
//
// SESSION MODE (keep.intakeSession present — `KEEP_SESSION_KV` on): login/exchange mint an opaque
// session id, keep stores the ORIGINAL credential + bearer + profile server-side, and the gateway
// sets it in an **httpOnly** `sprig_session` cookie. The bearer NEVER reaches the browser; the
// cookie rides same-origin on every request and keep resolves it (with silent refresh) server-side.
// LEGACY MODE (no intakeSession): login/exchange proxy to infra and return the bearer verbatim, for
// older non-KV deployments whose client still stores it. Sprig owns this so apps stop hand-rolling
// it per-repo (the class of bug that silently issues no bearer).
const MAX_LOGIN_BODY = 64_000; // an ID token is ~1–2 KB; anything larger is not a login request
// infra's opaque-token → bearer exchange. Mirrors `/api/session/login`'s `/api/<domain>/<action>`
// shape; the one value to confirm against your infra deployment (override via serveSprig's
// `auth.exchangePath` or the INFRA_EXCHANGE_PATH env var).
const DEFAULT_EXCHANGE_PATH = "/api/authz/exchange";
/** The httpOnly cookie the session id lives in (keep's guard resolves this exact name). */
const SESSION_COOKIE = "sprig_session";
let firebaseConfigCache: { body: string; at: number } | null = null;

/** Read a cookie value off the request's Cookie header (undecoded); "" when absent. */
function readCookie(req: Request, name: string): string {
  const header = req.headers.get("cookie") ?? "";
  for (const part of header.split(";")) {
    const eq = part.indexOf("=");
    if (eq < 0) continue;
    if (part.slice(0, eq).trim() === name) return part.slice(eq + 1).trim();
  }
  return "";
}

/** Build the `Set-Cookie` for the session id. `Secure` only over https so localhost dev (http)
 *  still gets the cookie; `HttpOnly` keeps it out of JS reach; `SameSite=Lax` rides top-level nav. */
function sessionCookie(id: string, req: Request, maxAge: number): string {
  const secure = new URL(req.url).protocol === "https:" ? "; Secure" : "";
  return `${SESSION_COOKIE}=${encodeURIComponent(id)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAge}${secure}`;
}

/** keep throws this exact shape when the session store is off (no `KEEP_SESSION_KV`) — the signal
 *  to fall back to legacy bearer proxying rather than treat it as a credential rejection. */
function isSessionStoreDisabled(e: unknown): boolean {
  return e instanceof Error && /session store is disabled/i.test(e.message);
}

const SESSION_MAX_AGE = 60 * 60 * 24 * 7; // 7 days — matches keep's default idle TTL

/** Mint a session in SESSION MODE, or return null to fall back to legacy bearer proxying (when the
 *  store is disabled / unavailable). Sets the httpOnly cookie and returns the profile — no bearer. */
async function mintSession(keep: KeepApi, req: Request, input: SessionIntake): Promise<Response | null> {
  if (!keep.intakeSession) return null;
  try {
    const { id, creator, email, grants } = await keep.intakeSession(input);
    return new Response(JSON.stringify({ name: creator, email: email ?? "", grants }), {
      status: 200,
      headers: {
        "content-type": "application/json",
        "cache-control": "no-store",
        "set-cookie": sessionCookie(id, req, SESSION_MAX_AGE),
      },
    });
  } catch (e) {
    if (isSessionStoreDisabled(e)) return null; // → legacy proxy below
    // A real credential rejection (infra said no) — surface as 401, don't leak the store to the app.
    return new Response(JSON.stringify({ message: "not authorized" }), {
      status: 401,
      headers: { "content-type": "application/json", "cache-control": "no-store" },
    });
  }
}

async function serveAuthGateway(
  req: Request,
  keep: KeepApi,
  infraUrl: string,
  exchangePath: string,
): Promise<Response | null> {
  const path = new URL(req.url).pathname;
  const infra = infraUrl.replace(/\/+$/, "");

  if (path === "/auth/firebase-config") {
    if (req.method !== "GET") return new Response("Method Not Allowed", { status: 405, headers: { allow: "GET" } });
    if (!infra) return new Response("auth not configured", { status: 404 });
    if (!firebaseConfigCache || Date.now() - firebaseConfigCache.at > 300_000) {
      const res = await fetch(`${infra}/firebase-config.json`).catch(() => null);
      if (!res?.ok) return new Response("firebase config unavailable", { status: 502 });
      firebaseConfigCache = { body: await res.text(), at: Date.now() };
    }
    return new Response(firebaseConfigCache.body, {
      headers: { "content-type": "application/json", "cache-control": "no-store" },
    });
  }

  if (path === "/auth/login") {
    if (req.method !== "POST") return new Response("Method Not Allowed", { status: 405, headers: { allow: "POST" } });
    if (!infra) return new Response("auth not configured", { status: 404 });
    const raw = await req.text();
    if (raw.length > MAX_LOGIN_BODY) return new Response("Payload Too Large", { status: 413 });
    let idToken = "", email = "";
    try {
      const body = JSON.parse(raw) as { idToken?: unknown; email?: unknown };
      if (typeof body.idToken === "string") idToken = body.idToken;
      if (typeof body.email === "string") email = body.email;
    } catch { /* handled by the 400 below */ }
    if (!idToken) {
      return new Response(JSON.stringify({ message: "idToken required" }), {
        status: 400,
        headers: { "content-type": "application/json" },
      });
    }
    // Preferred: keep mints a server-side session from the idToken and we set the httpOnly cookie.
    const minted = await mintSession(keep, req, { credential: idToken, credentialKind: "firebase", email });
    if (minted) return minted;
    // Legacy fallback (no session store): server-to-server exchange; infra verifies the ID token and
    // mints the offline-verifiable session bearer. Pass its verdict — and the bearer — through verbatim.
    const res = await fetch(`${infra}/api/session/login`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ idToken, email }),
    }).catch(() => null);
    if (!res) return new Response("auth upstream unreachable", { status: 502 });
    return new Response(await res.text(), {
      status: res.status,
      headers: { "content-type": "application/json", "cache-control": "no-store" },
    });
  }

  if (path === "/auth/exchange") {
    if (req.method !== "POST") return new Response("Method Not Allowed", { status: 405, headers: { allow: "POST" } });
    if (!infra) return new Response("auth not configured", { status: 404 });
    const raw = await req.text();
    if (raw.length > MAX_LOGIN_BODY) return new Response("Payload Too Large", { status: 413 });
    let token = "";
    try {
      const body = JSON.parse(raw) as { token?: unknown };
      if (typeof body.token === "string") token = body.token;
    } catch { /* handled by the 400 below */ }
    if (!token) {
      return new Response(JSON.stringify({ message: "token required" }), {
        status: 400,
        headers: { "content-type": "application/json" },
      });
    }
    // Preferred: keep swaps the opaque handle for a bearer, stores it server-side, sets the cookie.
    const minted = await mintSession(keep, req, { credential: token, credentialKind: "opaque" });
    if (minted) return minted;
    // Legacy fallback (no session store): server-to-server exchange returning the bearer verbatim.
    // Without this an opaque `?token=` was stored VERBATIM as the bearer and failed keep's JWKS
    // verification → 401 on every /api call.
    const res = await fetch(`${infra}${exchangePath}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ token }),
    }).catch(() => null);
    if (!res) return new Response("auth upstream unreachable", { status: 502 });
    return new Response(await res.text(), {
      status: res.status,
      headers: { "content-type": "application/json", "cache-control": "no-store" },
    });
  }

  if (path === "/auth/me") {
    if (req.method !== "GET") return new Response("Method Not Allowed", { status: 405, headers: { allow: "GET" } });
    const unauth = () =>
      new Response("null", { status: 401, headers: { "content-type": "application/json", "cache-control": "no-store" } });
    const id = decodeURIComponent(readCookie(req, SESSION_COOKIE));
    if (!id || !keep.sessions) return unauth();
    const rec = await keep.sessions.read(id).catch(() => null);
    if (!rec) return unauth();
    // grants are UX-only here (the guard still enforces them from the verified bearer per request).
    return new Response(JSON.stringify({ name: rec.name ?? "", email: rec.email ?? "", grants: rec.grants ?? [] }), {
      headers: { "content-type": "application/json", "cache-control": "no-store" },
    });
  }

  if (path === "/auth/logout") {
    if (req.method !== "POST") return new Response("Method Not Allowed", { status: 405, headers: { allow: "POST" } });
    const id = decodeURIComponent(readCookie(req, SESSION_COOKIE));
    if (id && keep.destroySession) await keep.destroySession(id).catch(() => {});
    // Clear the cookie regardless (idempotent) — Max-Age=0 expires it immediately.
    return new Response(null, {
      status: 204,
      headers: { "set-cookie": sessionCookie("", req, 0), "cache-control": "no-store" },
    });
  }

  return null;
}

// ─────────────────────────────── build-info <meta> provenance ───────────────────────────────
// `sprig build` bakes the git-root deno.json's `git` block (repo/commit/branch/buildTime, stamped by
// the deploy tooling) into `<assetsDir>/build-info.json`. serveSprig/sprigUi read it ONCE (the served
// dir is the one thing they know reliably on Deno Deploy — same channel that makes ?v= work) and
// splice the tags into every SSR document head. No git or repo is needed in the serving isolate.

/** Read `<assetsDir>/build-info.json` once and render the provenance `<meta>` tags for the head.
 *  Memoized (constant per deployment); "" when the file is absent (local dev / not stamped). */
function buildMetaReader(assetsDir: string): () => Promise<string> {
  let cached: string | null = null;
  return async () => {
    if (cached !== null) return cached;
    try {
      const info = JSON.parse(await Deno.readTextFile(`${assetsDir}/build-info.json`)) as Record<string, unknown>;
      const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;");
      const tag = (name: string, key: string) => {
        const v = info[key];
        return typeof v === "string" && v ? `  <meta name="${name}" content="${esc(v)}" />\n` : "";
      };
      cached = tag("git-repo", "repo") + tag("git-commit", "commit") + tag("git-branch", "branch") + tag("build-time", "buildTime");
    } catch {
      cached = ""; // no build-info → emit nothing
    }
    return cached;
  };
}

/** Splice `meta` into an HTML response right after the opening `<head>` — streaming-safe (the head
 *  flushes as the first chunk, so the tags land immediately and the body passes through untouched).
 *  A non-HTML response, or an empty `meta`, is returned unchanged. */
function injectHeadMeta(res: Response, meta: string): Response {
  if (!meta) return res;
  const type = res.headers.get("content-type") ?? "";
  if (!type.includes("text/html") || res.body === null) return res;
  const dec = new TextDecoder();
  const enc = new TextEncoder();
  const NEEDLE = "<head>";
  let carry = "";
  let done = false;
  const rewrite = new TransformStream<Uint8Array, Uint8Array>({
    transform(chunk, controller) {
      if (done) {
        controller.enqueue(chunk);
        return;
      }
      carry += dec.decode(chunk, { stream: true });
      const at = carry.indexOf(NEEDLE);
      if (at !== -1) {
        const cut = at + NEEDLE.length;
        controller.enqueue(enc.encode(carry.slice(0, cut) + "\n" + meta + carry.slice(cut)));
        carry = "";
        done = true;
      } else if (carry.length > 8192) {
        controller.enqueue(enc.encode(carry)); // no <head> in the first 8KB → pass through
        carry = "";
        done = true;
      }
    },
    flush(controller) {
      if (carry) controller.enqueue(enc.encode(carry));
    },
  });
  const headers = new Headers(res.headers);
  headers.delete("content-length"); // body length changed
  return new Response(res.body.pipeThrough(rewrite), { status: res.status, statusText: res.statusText, headers });
}

/**
 * Dispatch order (the author writes none of this):
 *   /api/*   → keep.handler with the prefix STRIPPED, info forwarded (token-gated,
 *              NEVER backend.fetch — that would skip auth for network callers).
 *   /docs*   → keep.handler unstripped (the Swagger UI references /docs/* absolutely).
 *   else     → the sprig SSR app, with the in-process Backend threaded in.
 */
export function serveSprig(config: ServeSprigConfig): ServeDefaultExport {
  const base = config.base ?? "/ui";
  const apiPrefix = config.apiPrefix ?? "/api";
  const docsPrefix = config.docsPrefix ?? "/docs";
  const assetsDir = config.assetsDir ?? "static";
  const assetPrefix = `${base}/_assets`;
  // Firebase/Google sign-in gateway (loginWithGoogle's server half) — mounted only when an
  // infra URL is resolvable; else /auth is left to the app (backward compatible).
  const authInfraUrl = config.auth?.infraUrl ?? Deno.env.get("INFRA_URL") ?? "";
  const authExchangePath = config.auth?.exchangePath ?? Deno.env.get("INFRA_EXCHANGE_PATH") ?? DEFAULT_EXCHANGE_PATH;

  if (base === apiPrefix || base === docsPrefix) {
    throw new Error(`serveSprig: base "${base}" collides with a reserved keep prefix`);
  }

  const backend = backendClient(config.keep.backend.fetch);
  // ONE source of truth for the asset version: the content hash of the dir we ACTUALLY
  // serve. It drives both the renderer's ?v= (via env.assetsVersion) and serveAsset's
  // immutable check, so the two can never disagree. Stat-probed memoization: steady
  // state is cheap, and an in-place rebuild is picked up on the next request.
  const version = assetsVersioner(assetsDir);
  const buildMeta = buildMetaReader(assetsDir);

  return {
    async fetch(req, info): Promise<Response> {
      const url = new URL(req.url);
      const path = url.pathname;

      // forbidden methods (TRACE/TRACK/CONNECT) can never be carried by a
      // re-wrapped Request — reject cleanly up front instead of crashing.
      if (FORBIDDEN_METHODS.has(req.method)) {
        return new Response("Method Not Allowed", {
          status: 405,
          headers: { "allow": "GET, HEAD, POST, PUT, PATCH, DELETE, OPTIONS" },
        });
      }

      // same-origin /auth gateway (the server half of sprig's client auth). Active when an infra
      // URL is configured (login/exchange/firebase-config) OR keep exposes the cookie-session engine
      // (me/logout work without infra). Returns null for non-/auth paths → falls through.
      if (authInfraUrl || config.keep.sessions || config.keep.destroySession) {
        const authRes = await serveAuthGateway(req, config.keep, authInfraUrl, authExchangePath);
        if (authRes) return authRes;
      }
      // framework-vendored libs (apexcharts, …) → served straight from the in-source VENDOR
      // map above, NOT the app's build output. This is what "ship it to the client" means:
      // the server hands over its own bundled copy; the app never emits it.
      if (path.startsWith(assetPrefix + "/vendor/")) {
        const asset = VENDOR[path.slice((assetPrefix + "/vendor/").length)];
        return asset
          ? new Response(asset.body, { headers: { "content-type": asset.type, "cache-control": "public, max-age=86400" } })
          : new Response("Not Found", { status: 404 });
      }
      // built assets → static dir (immutable only for content-addressed requests)
      if (path.startsWith(assetPrefix + "/")) {
        return serveAsset(assetsDir, path.slice(assetPrefix.length + 1), req, version);
      }
      // network /api/* → keep (auth-gated), prefix stripped, info forwarded
      if (path === apiPrefix || path.startsWith(apiPrefix + "/")) {
        const strippedPath = path.slice(apiPrefix.length) || "/";
        // the api channel must NOT alias the human /docs Swagger surface
        if (strippedPath === docsPrefix || strippedPath.startsWith(docsPrefix + "/")) {
          return new Response("Not Found", { status: 404 });
        }
        const stripped = new URL(req.url);
        stripped.pathname = strippedPath;

        // request-validation gateway: a body-bearing /api request is pre-checked
        // here so malformed/oversized/over-nested/wrong-media-type bodies become a
        // clean 4xx instead of a 500 leaking a parser/stack error from the pipeline.
        if (req.body !== null) {
          const body = await req.text();
          if (body.length > 0) {
            const ct = (req.headers.get("content-type") ?? "").split(";")[0].trim().toLowerCase();
            if (ct !== "application/json") {
              return new Response("Unsupported Media Type", { status: 415 });
            }
            if (new TextEncoder().encode(body).byteLength > MAX_BODY_BYTES || jsonDepth(body) > MAX_JSON_DEPTH) {
              return new Response("Bad Request", { status: 400 });
            }
            try {
              JSON.parse(body);
            } catch {
              return new Response("Bad Request", { status: 400 });
            }
          }
          const rebuilt = new Request(stripped, {
            method: req.method,
            headers: req.headers,
            body: body.length > 0 ? body : undefined,
          });
          return Promise.resolve(config.keep.handler(rebuilt, info));
        }
        return Promise.resolve(config.keep.handler(new Request(stripped, req), info));
      }
      // /docs* → keep, unstripped
      if (path === docsPrefix || path.startsWith(docsPrefix + "/")) {
        return Promise.resolve(config.keep.handler(req, info));
      }
      // everything else → sprig SSR, in-process Backend threaded in (no globalThis),
      // plus the served-assets content hash so the rendered ?v= is content-addressed.
      // Session mode: resolve the httpOnly session cookie → profile and thread it in as env.session
      // so the SSR guard reads ctx.session instead of re-verifying a bearer. Legacy mode (no
      // keep.sessions) → session stays null and a guard parses the headers itself, as before.
      let session: SessionProfile | null = null;
      if (config.keep.sessions) {
        const raw = readCookie(req, SESSION_COOKIE);
        if (raw) session = await config.keep.sessions.read(decodeURIComponent(raw)).catch(() => null);
      }
      return injectHeadMeta(await config.app.fetch(req, info, { backend, assetsVersion: (await version()) ?? undefined, session }), await buildMeta());
    },
  };
}

export interface SprigUiConfig {
  app: SprigApp;
  /** where the UI mounts (default "/ui"); the build's assets live at <base>/_assets/*. */
  base?: string;
  /** directory the built assets are read from (default "static"). */
  assetsDir?: string;
  /** the HOST's in-process backend, threaded into resolve.ts for SSR data loading. */
  backend?: { fetch: typeof fetch };
}

/**
 * A framework-agnostic middleware CORE for mounting the sprig UI inside ANY host server.
 * Returns a Response for any request under `base` (the assets + the SSR app), or `null`
 * to pass through (not ours). Compose it however your host wants:
 *
 *   Deno:      Deno.serve((req, info) => ui(req, info).then(r => r ?? host(req)))
 *   Danet/Oak: app.use(async (ctx, next) => {
 *                const r = await ui(ctx.request.source);            // the raw Request
 *                if (r) { ctx.response.status = r.status; ctx.response.headers = r.headers; ctx.response.body = r.body; }
 *                else await next();
 *              })
 *   Hono:      app.use(async (c, next) => (await ui(c.req.raw)) ?? (await next()))
 *
 * The host owns /api, /docs, and every other route; the sprig middleware owns /ui/**.
 */
export function sprigUi(
  config: SprigUiConfig,
): (req: Request, info?: Deno.ServeHandlerInfo) => Promise<Response | null> {
  const base = config.base ?? "/ui";
  const assetsDir = config.assetsDir ?? "static";
  const assetPrefix = `${base}/_assets`;
  const backend = config.backend ? backendClient(config.backend.fetch) : undefined;
  // same single source of truth as serveSprig: the served dir's content hash drives
  // the renderer's ?v= AND the immutable check (stat-probed, tracks in-place rebuilds).
  const version = assetsVersioner(assetsDir);
  const buildMeta = buildMetaReader(assetsDir);

  return async (req, info) => {
    const path = new URL(req.url).pathname;
    // not under <base> → not ours; the host handles it (next()).
    if (path !== base && !path.startsWith(base + "/")) return null;
    if (FORBIDDEN_METHODS.has(req.method)) {
      return new Response("Method Not Allowed", { status: 405, headers: { "allow": "GET, HEAD, POST, PUT, PATCH, DELETE, OPTIONS" } });
    }
    if (path.startsWith(assetPrefix + "/")) {
      return serveAsset(assetsDir, path.slice(assetPrefix.length + 1), req, version);
    }
    return injectHeadMeta(await config.app.fetch(req, info, { backend, assetsVersion: (await version()) ?? undefined }), await buildMeta());
  };
}
