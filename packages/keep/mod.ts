/**
 * @sprig/keep — composes a keep backend and a sprig UI into ONE single-origin
 * `{ fetch }` handler (a Deno.ServeDefaultExport), and binds keep's in-process
 * client to the `Backend` token so `resolve.ts` reads data with no token, no TCP.
 *
 * This is the whole composition root — the app author writes `serveSprig({...})`,
 * not a hand-rolled path dispatcher + globalThis bridge.
 */
import { backendClient, type SprigApp } from "@sprig/core";

// The SSR renderer is server-only (Deno APIs) so it can't live in client-safe
// @sprig/core; it belongs with the rest of the server glue. The actual COMPILER
// (buildClient + the tree-sitter parser) is CLI-only and is NOT re-exported here.
export { createRenderer, type SsrRenderer } from "../../framework/.sprig/compiler/mod.ts";

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

async function serveAsset(dir: string, file: string, req: Request): Promise<Response> {
  // static files answer only to GET/HEAD
  if (req.method !== "GET" && req.method !== "HEAD") {
    return new Response("Method Not Allowed", {
      status: 405,
      headers: { "allow": "GET, HEAD" },
    });
  }
  // contain to dir (no path traversal): reject only a real ".." path SEGMENT,
  // not a legitimate single-segment name that merely contains a ".." substring.
  if (file.split("/").includes("..")) return new Response("Forbidden", { status: 403 });
  try {
    const path = `${dir}/${file}`;
    const stat = await Deno.stat(path);
    // cache validators so conditional GETs can 304 instead of re-transferring
    const lastModified = stat.mtime ?? new Date(0);
    const etag = `W/"${stat.size.toString(16)}-${lastModified.getTime().toString(16)}"`;
    const inm = req.headers.get("if-none-match");
    const ims = req.headers.get("if-modified-since");
    const notModified = (inm !== null && inm === etag) ||
      (inm === null && ims !== null && new Date(ims).getTime() >= Math.floor(lastModified.getTime() / 1000) * 1000);
    const headers: Record<string, string> = {
      "content-type": contentTypeFor(file),
      "cache-control": "public, max-age=31536000, immutable",
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

  if (base === apiPrefix || base === docsPrefix) {
    throw new Error(`serveSprig: base "${base}" collides with a reserved keep prefix`);
  }

  const backend = backendClient(config.keep.backend.fetch);

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

      // built assets → static dir (immutable cache)
      if (path.startsWith(assetPrefix + "/")) {
        return serveAsset(assetsDir, path.slice(assetPrefix.length + 1), req);
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
            if (body.length > MAX_BODY_BYTES || jsonDepth(body) > MAX_JSON_DEPTH) {
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
      // everything else → sprig SSR, in-process Backend threaded in (no globalThis)
      return config.app.fetch(req, info, { backend });
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

  return (req, info) => {
    const path = new URL(req.url).pathname;
    // not under <base> → not ours; the host handles it (next()).
    if (path !== base && !path.startsWith(base + "/")) return Promise.resolve(null);
    if (FORBIDDEN_METHODS.has(req.method)) {
      return Promise.resolve(
        new Response("Method Not Allowed", { status: 405, headers: { "allow": "GET, HEAD, POST, PUT, PATCH, DELETE, OPTIONS" } }),
      );
    }
    if (path.startsWith(assetPrefix + "/")) {
      return serveAsset(assetsDir, path.slice(assetPrefix.length + 1), req);
    }
    return config.app.fetch(req, info, backend ? { backend } : undefined);
  };
}
