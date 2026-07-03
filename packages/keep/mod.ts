/**
 * @sprig/keep — composes a keep backend and a sprig UI into ONE single-origin
 * `{ fetch }` handler (a Deno.ServeDefaultExport), and binds keep's in-process
 * client to the `Backend` token so `resolve.ts` reads data with no token, no TCP.
 *
 * This is the whole composition root — the app author writes `serveSprig({...})`,
 * not a hand-rolled path dispatcher + globalThis bridge.
 */
import { backendClient, type Guard, isLayoutLoad, type Route, type RouteMeta, type SprigApp } from "@sprig/core";
import { join, toFileUrl } from "@std/path";

// The SSR renderer is server-only (Deno APIs) so it can't live in client-safe
// @sprig/core; it belongs with the rest of the server glue. The actual COMPILER
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
    const path = join(srcDir, "guards", name, "guard.ts");
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
  const raw = JSON.parse(await Deno.readTextFile(join(srcDir, "root.json"))) as RawRoute[];
  return await mapRouteTable(raw, srcDir);
}

/** The slice of keep's `bootstrapServer(...)` result that serveSprig consumes. */
export interface KeepApi {
  /** the IN-PROCESS client: typeof fetch, dispatches relative paths through the
   *  full pipeline with no TCP, bypassing token auth. SSR-only. */
  backend: { fetch: typeof fetch };
  /** the NETWORK handler: token-gated; forward Deno.ServeHandlerInfo into it. */
  handler: (req: Request, info?: Deno.ServeHandlerInfo) => Response | Promise<Response>;
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
   *  serveSprig auto-mounts the same-origin /auth gateway that sprig's `loginWithGoogle()`
   *  (@sprig/core) calls — proxying `/auth/firebase-config` + `/auth/login` to infra so the
   *  browser never touches the control plane cross-origin. Omit (and unset INFRA_URL) to leave
   *  /auth to the app. */
  auth?: { infraUrl?: string };
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
// The two same-origin endpoints sprig's `loginWithGoogle()` (@sprig/core) needs, proxied to
// infra so the browser never calls the control plane cross-origin (infra's /api sets no CORS
// headers) and never learns INFRA_URL:
//   GET  /auth/firebase-config → <infra>/firebase-config.json   (public web config, 5-min cached)
//   POST /auth/login           → <infra>/api/session/login      (Firebase idToken → session bearer)
// Returns null for any other path so serveSprig falls through to /api + the SSR app. Sprig owns
// this so apps stop hand-rolling it per-repo (the class of bug that silently issues no bearer).
const MAX_LOGIN_BODY = 64_000; // an ID token is ~1–2 KB; anything larger is not a login request
let firebaseConfigCache: { body: string; at: number } | null = null;

async function serveAuthGateway(req: Request, infraUrl: string): Promise<Response | null> {
  const path = new URL(req.url).pathname;
  const infra = infraUrl.replace(/\/+$/, "");

  if (path === "/auth/firebase-config") {
    if (req.method !== "GET") return new Response("Method Not Allowed", { status: 405, headers: { allow: "GET" } });
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
    // Server-to-server exchange; infra verifies the ID token against its Firebase project and
    // mints the offline-verifiable session bearer. Pass its verdict through verbatim.
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

  return null;
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

  if (base === apiPrefix || base === docsPrefix) {
    throw new Error(`serveSprig: base "${base}" collides with a reserved keep prefix`);
  }

  const backend = backendClient(config.keep.backend.fetch);
  // ONE source of truth for the asset version: the content hash of the dir we ACTUALLY
  // serve. It drives both the renderer's ?v= (via env.assetsVersion) and serveAsset's
  // immutable check, so the two can never disagree. Stat-probed memoization: steady
  // state is cheap, and an in-place rebuild is picked up on the next request.
  const version = assetsVersioner(assetsDir);

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

      // same-origin /auth sign-in gateway (the server half of sprig's loginWithGoogle),
      // when an infra URL is configured. Returns null for non-/auth paths → falls through.
      if (authInfraUrl) {
        const authRes = await serveAuthGateway(req, authInfraUrl);
        if (authRes) return authRes;
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
      return config.app.fetch(req, info, { backend, assetsVersion: (await version()) ?? undefined });
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
    return config.app.fetch(req, info, { backend, assetsVersion: (await version()) ?? undefined });
  };
}
