/**
 * @sprig/core — the runtime contract for the folder-component model.
 *
 * This is the SERVER spine: dependency injection, the keep in-process `Backend`
 * bridge, and `bootstrap()` (routing → resolve → SSR). It is backend-agnostic —
 * it does NOT import @mrg-keystone/keep; the in-process client arrives as an
 * opaque `BackendClient` value threaded through `SprigApp.fetch`.
 *
 * It also carries the reactive accessors + defineComponent used by islands (run
 * on the server for initial SSR and on the client for hydration).
 */

// ─────────────────────────── Reactive accessors ─────────────────────────────
// Templates read BOTH signals and computeds as `name()`. Raw @preact/signals are
// not callable, so sprig wraps them in a callable accessor: `count()` reads,
// `count.value = …` / `count.set(…)` write.
import { computed as pcomputed, effect, signal as psignal, type Signal } from "@preact/signals-core";
export { effect, type Signal };

export interface Accessor<T> {
  (): T;
  readonly value: T;
  readonly signal: Signal<T>;
}
export interface WritableAccessor<T> {
  (): T;
  value: T;
  set(v: T): void;
  update(fn: (prev: T) => T): void;
  readonly signal: Signal<T>;
}

export function signal<T>(initial: T): WritableAccessor<T> {
  const s = psignal(initial);
  const acc = (() => s.value) as WritableAccessor<T>;
  Object.defineProperty(acc, "value", { get: () => s.value, set: (v: T) => (s.value = v) });
  Object.defineProperty(acc, "signal", { get: () => s });
  acc.set = (v) => (s.value = v);
  acc.update = (fn) => (s.value = fn(s.value));
  return acc;
}
export function computed<T>(fn: () => T): Accessor<T> {
  const c = pcomputed(fn);
  const acc = (() => c.value) as Accessor<T>;
  Object.defineProperty(acc, "value", { get: () => c.value });
  Object.defineProperty(acc, "signal", { get: () => c });
  return acc;
}

/** True if `v` is a writable signal accessor (callable + .set + .signal). Lets a
 *  harness pick the editable signals out of an island's setup() scope. A computed
 *  is read-only (no .set) so it is excluded. */
// deno-lint-ignore no-explicit-any
export function isSignal(v: unknown): v is WritableAccessor<any> {
  return typeof v === "function" && "set" in (v as object) && "signal" in (v as object);
}

// ─────────────────────────── Dependency Injection ───────────────────────────
export type Scope = "server" | "client" | "both";
export type Side = "server" | "client";
export interface InjectableConfig {
  scope?: Scope; // default "both"
  providedIn?: "root";
}
// deno-lint-ignore no-explicit-any
type Ctor<T = unknown> = new (...args: any[]) => T;
export interface Token<T> {
  readonly key: symbol;
  readonly name: string;
  /** phantom — carries T for inference */
  readonly _t?: T;
}
interface Registration {
  scope: Scope;
  providedIn?: "root";
  factory: () => unknown;
}
const REGISTRY = new Map<symbol, Registration>();

/** Class decorator: register a service so `inject(TheClass)` can resolve it. */
export function Injectable(config: InjectableConfig = {}) {
  return function <T extends Ctor>(target: T, _ctx?: unknown): T {
    REGISTRY.set(keyOf(target), {
      scope: config.scope ?? "both",
      providedIn: config.providedIn,
      factory: () => new target(),
    });
    return target;
  };
}
/** Value/interface token for non-class providers (config objects, factory fns). */
export function token<T>(
  name: string,
  config: InjectableConfig & { factory: () => T },
): Token<T> {
  const key = Symbol(name);
  REGISTRY.set(key, { scope: config.scope ?? "both", providedIn: config.providedIn, factory: config.factory });
  return { key, name };
}

/** An injector node in the root → route → component hierarchy. */
export class Injector {
  #instances = new Map<symbol, unknown>();
  /** Per-request response status channel: a resolve/service may set this (via
   *  `setResponseStatus`) to make bootstrap.fetch emit a non-200 (e.g. 404 for a
   *  matched route whose resource was not found). Lives on the request root. */
  status?: number;
  constructor(
    readonly side: Side,
    readonly kind: "root" | "route" | "component" = "root",
    readonly parent?: Injector,
  ) {}

  get root(): Injector {
    // deno-lint-ignore no-this-alias
    let i: Injector = this;
    while (i.parent) i = i.parent;
    return i;
  }

  /** Bind a concrete per-request value for a token (e.g. the keep Backend). */
  provide<T>(token: Token<T>, value: T): void {
    this.#instances.set(token.key, value);
  }

  resolve<T>(token: Ctor<T> | Token<T>): T {
    const key = keyOf(token);
    const reg = REGISTRY.get(key);
    if (!reg) throw new Error(`No provider for ${nameOf(token)}`);
    const target = reg.providedIn === "root" ? this.root : this;
    return target.#instantiate(key, token, reg) as T;
  }

  child(kind: "route" | "component"): Injector {
    return new Injector(this.side, kind, this);
  }

  #instantiate<T>(key: symbol, token: Ctor<T> | Token<T>, reg: Registration): T {
    // Scope guard runs BEFORE the cache-hit short-circuit so an inherited/bound
    // value (e.g. a server-only Backend on a parent) cannot be handed to an
    // injector of the wrong side — "DI never crosses the wire" (bug #92).
    if (reg.scope !== "both" && reg.scope !== this.side) {
      throw new Error(
        `Cannot inject ${nameOf(token)} (scope="${reg.scope}") on the ${this.side}. ` +
          `Pass its data in as an @input instead — DI does not cross the SSR/island boundary.`,
      );
    }
    // Presence-based cache lookup: a cached/bound value of `undefined` must still
    // count as a hit (bugs #59/#60), so distinguish "absent" from "value undefined".
    const found = this.#findInstance(key);
    if (found.has) return found.value as T;
    const prev = current;
    current = this;
    try {
      const value = reg.factory() as T;
      this.#instances.set(key, value);
      return value;
    } finally {
      current = prev;
    }
  }
  #findInstance(key: symbol): { has: boolean; value: unknown } {
    // walk the parent chain by recursion (no `this` aliasing), reporting presence
    // (not a bare value) so a cached `undefined` is not mistaken for "absent".
    if (this.#instances.has(key)) return { has: true, value: this.#instances.get(key) };
    return this.parent ? this.parent.#findInstance(key) : { has: false, value: undefined };
  }
}

/** The client root injector — one per document. */
export function clientRoot(): Injector {
  const g = globalThis as unknown as { __sprig_root?: Injector };
  return (g.__sprig_root ??= new Injector("client", "root"));
}

let current: Injector | undefined;
/** Resolve a dependency from the active injector. Synchronous-only: call it
 *  before any `await` (capture deps into vars first). */
export function inject<T>(token: Ctor<T> | Token<T>): T {
  if (!current) {
    throw new Error("inject() must be called synchronously within setup(), resolve(), or a service constructor");
  }
  return current.resolve(token);
}
/** The injector currently active (set inside runInInjector/#instantiate). Lets a
 *  service capture its request context synchronously during construction, so it can
 *  later report a response status even after an `await` has cleared `current`. */
export function currentInjector(): Injector | undefined {
  return current;
}
/** Record an HTTP status for the in-flight SSR request (e.g. 404 when a matched
 *  route's resource was not found). Stored on the request root so bootstrap.fetch
 *  can vary the Response status. Call it synchronously inside resolve()/setup(),
 *  or via a request context captured at service construction. */
export function setResponseStatus(injector: Injector | undefined, status: number): void {
  if (injector) injector.root.status = status;
}
/** Run `fn` with `injector` active. Returns whatever `fn` returns (incl. a Promise). */
export function runInInjector<T>(injector: Injector, fn: () => T): T {
  const prev = current;
  current = injector;
  try {
    return fn();
  } finally {
    current = prev;
  }
}

const CTOR_KEYS = new WeakMap<Ctor, symbol>();
function keyOf(t: Ctor | Token<unknown>): symbol {
  if ("key" in t) return t.key;
  let k = CTOR_KEYS.get(t);
  if (!k) {
    k = Symbol(t.name);
    CTOR_KEYS.set(t, k);
  }
  return k;
}
function nameOf(t: Ctor | Token<unknown>): string {
  return "name" in t ? t.name : String(t);
}

// ───────────────────── Backend — the keep in-process bridge ──────────────────
/** A structural drop-in for `fetch` (keep's `backend.fetch`), plus a typed
 *  `get<T>` convenience that replaces hand-written ssr-fetch shims. */
export interface BackendClient {
  fetch: typeof fetch;
  get<T>(path: string, init?: RequestInit): Promise<{ ok: boolean; status: number; data?: T }>;
}

/** Built-in SERVER-scoped token. `serveSprig` binds it to keep's `backend.fetch`
 *  per request; `resolve.ts` reads it with `inject(Backend)`. Injecting it in
 *  island/client code throws (scope "server") — DI never crosses the wire. */
export const Backend: Token<BackendClient> = token<BackendClient>("sprig:Backend", {
  scope: "server",
  providedIn: "root",
  factory: () => {
    throw new Error(
      "Backend is not bound. It is only available during SSR (serveSprig binds it); " +
        "an island cannot inject it — server data reaches islands as serialized @inputs.",
    );
  },
});

/** Wrap a bare `fetch` (keep's `backend.fetch`) into a BackendClient with `get`. */
export function backendClient(fetchImpl: typeof fetch): BackendClient {
  return {
    fetch: fetchImpl,
    async get<T>(path: string, init?: RequestInit) {
      const res = await fetchImpl(path, init);
      if (!res.ok) {
        await res.body?.cancel().catch(() => {});
        return { ok: false, status: res.status };
      }
      // A 2xx with a non-JSON body (an upstream HTML error page, empty body, wrong
      // content-type) must not crash the caller or leak the response stream: drain
      // the body and surface it as a non-OK result instead of throwing.
      try {
        return { ok: true, status: res.status, data: (await res.json()) as T };
      } catch {
        await res.body?.cancel().catch(() => {});
        return { ok: false, status: res.status };
      }
    },
  };
}

// ─────────────────────────── Components / resolve ───────────────────────────
export interface ResolveCtx {
  params: Record<string, string>;
  url: URL;
}
export type Resolve = (ctx: ResolveCtx) => Record<string, unknown> | Promise<Record<string, unknown>>;

/** The reactive scope an island's logic.ts builds. */
export interface ComponentCtx {
  /** Read a typed @input (serialized from the server). Returns an Accessor. */
  input<T>(name: string, fallback?: T): Accessor<T>;
  /** Declare a component @output; calling the returned fn emits to the parent. */
  output<T = void>(name: string): (value: T) => void;
  /** Two-way target: [(x)] = an `x` input + an `xChange` output. */
  model<T>(name: string, fallback?: T): WritableAccessor<T>;
}
/** When the island's per-island chunk loads + hydrates (M7 code-split lazy-load). */
export type IslandTrigger = "load" | "idle" | "visible" | "interaction";
export interface ComponentDef<T extends object = object> {
  readonly inputs: string[];
  readonly setup: (ctx: ComponentCtx) => T;
  /** hydration trigger — defaults to "load" (eager). */
  readonly trigger: IslandTrigger;
}
type SetupOptions<T extends object> = {
  inputs?: string[];
  trigger?: IslandTrigger;
  setup: (ctx: ComponentCtx) => T;
};
/** Define an island's reactive scope; the compiled template binds the returned object. */
export function defineComponent<T extends object>(
  setupOrOptions: ((ctx: ComponentCtx) => T) | SetupOptions<T>,
): ComponentDef<T> {
  if (typeof setupOrOptions === "function") return { inputs: [], trigger: "load", setup: setupOrOptions };
  return { inputs: setupOrOptions.inputs ?? [], trigger: setupOrOptions.trigger ?? "load", setup: setupOrOptions.setup };
}

/** What the build's per-folder loader produces (or main.ts wires explicitly). */
export interface ComponentModule {
  resolve?: Resolve;
  default?: ComponentDef; // island scope, if the folder has a logic.ts
}

// ───────────────────────────────── Router ───────────────────────────────────
export interface Route {
  path: string;
  load?: string;
  children?: Route[];
}
export function defineRoutes(routes: Route[]): Route[] {
  return routes;
}

export interface MatchedRoute {
  load?: string;
  params: Record<string, string>;
}

/** Minimal primary-path matcher: walks routes, supports ":param" segments and a
 *  nested single primary child chain. (The full named-outlet engine is router.ts
 *  in the build; the spine needs primary routing only.) */
export function matchRoute(routes: Route[], pathname: string): MatchedRoute | null {
  const segs = pathname.split("/").filter((s) => s.length > 0);
  return walk(routes, segs, {});
}
/** Decode a captured path segment (RFC/browser convention: path params are
 *  percent-encoded). Falls back to the raw segment if it is malformed. */
function decodeParam(seg: string): string {
  try {
    return decodeURIComponent(seg);
  } catch {
    return seg;
  }
}
function walk(routes: Route[], segs: string[], inherited: Record<string, string>): MatchedRoute | null {
  for (const route of routes) {
    const rs = route.path.split("/").filter((s) => s.length > 0);
    const params: Record<string, string> = { ...inherited };
    let ok = true;
    for (let i = 0; i < rs.length; i++) {
      const u = segs[i];
      if (u === undefined) { ok = false; break; }
      if (rs[i].startsWith(":")) params[rs[i].slice(1)] = decodeParam(u);
      else if (rs[i] !== u) { ok = false; break; }
    }
    if (!ok) continue;
    const rest = segs.slice(rs.length);
    if (rest.length === 0) return { load: route.load, params };
    if (route.children) {
      const sub = walk(route.children, rest, params);
      if (sub) return sub;
    }
  }
  return null;
}

// ──────────────────────────────── Bootstrap ─────────────────────────────────
export interface AppConfig {
  routes: Route[];
  base?: string;
  /** explicit load-string → module map (the build instruments this; the app
   *  may also wire it directly in main.ts). */
  modules?: Record<string, ComponentModule>;
  /** SSR renderer (the template compiler). main.ts wires it so @sprig/core stays
   *  decoupled from the wasm-backed compiler. Falls back to a JSON dump if absent. */
  render?: (pageLoad: string, inputs: Record<string, unknown>) => Promise<string>;
}
export interface SprigApp {
  fetch(req: Request, info?: Deno.ServeHandlerInfo, env?: { backend?: BackendClient }): Promise<Response>;
}

/** Read-only methods the SSR document route honors. */
const SSR_ALLOW = "GET, HEAD, OPTIONS";
/** Hardening + cache headers applied to every dynamic SSR HTML response. */
function ssrHeaders(extra?: Record<string, string>): Record<string, string> {
  return {
    "content-type": "text/html; charset=utf-8",
    // dynamic, per-resource HTML must not be heuristically cached by shared caches
    "cache-control": "no-store",
    // defense-in-depth for pages embedding inline JSON islands
    "x-content-type-options": "nosniff",
    "x-frame-options": "DENY",
    "referrer-policy": "no-referrer",
    ...extra,
  };
}

export function bootstrap(config: AppConfig): SprigApp {
  const base = config.base ?? "";
  return {
    async fetch(req, _info, env): Promise<Response> {
      const url = new URL(req.url);
      let path = url.pathname;
      if (base && (path === base || path.startsWith(base + "/"))) path = path.slice(base.length) || "/";
      // Any path not under the configured base 404s — including bare "/" (the index
      // must only be reachable on-base, not dual-mounted off-base). When base is
      // empty this branch is skipped and the raw path is used as-is.
      else if (base) return new Response("Not Found", { status: 404 });

      const matched = matchRoute(config.routes, path);
      if (!matched) return new Response("Not Found", { status: 404 });

      // SSR page routes are read-only resources: gate the HTTP method.
      const method = req.method;
      if (method === "OPTIONS") {
        return new Response(null, { status: 204, headers: { "allow": SSR_ALLOW } });
      }
      if (method !== "GET" && method !== "HEAD") {
        return new Response("Method Not Allowed", { status: 405, headers: { "allow": SSR_ALLOW } });
      }

      // server request injector with the Backend value bound (no globalThis); the
      // resolve runs on a route-scoped child so route/component-scoped services
      // re-scope per request and don't leak onto the request root.
      const root = new Injector("server", "root");
      if (env?.backend) root.provide(Backend, env.backend);
      const routeInjector = root.child("route");

      const mod = matched.load ? config.modules?.[matched.load] : undefined;

      let html: string;
      try {
        let inputs: Record<string, unknown> = {};
        if (mod?.resolve) {
          inputs = await runInInjector(routeInjector, () => mod.resolve!({ params: matched.params, url }));
        }
        html = config.render && matched.load
          ? await config.render(matched.load, inputs)
          : renderDocument(matched, inputs, base);
      } catch {
        // Any resolve()/render() failure becomes a controlled 500 — never an
        // unhandled rejection and never leaking internal error text to the client.
        return new Response("Internal Server Error", { status: 500, headers: ssrHeaders() });
      }

      // A resolve/service may have signalled a not-found (matched route, missing
      // resource) by setting the request status; honor it on the response line.
      const status = root.status ?? 200;
      return new Response(method === "HEAD" ? null : html, { status, headers: ssrHeaders() });
    },
  };
}

/** Placeholder SSR: a real document that embeds the resolved @inputs as the
 *  island prop bridge. The template→Preact compiler (next milestone) replaces
 *  the <pre> dump with the rendered folder-component tree. */
function renderDocument(matched: MatchedRoute, inputs: Record<string, unknown>, base: string): string {
  const json = JSON.stringify(inputs);
  const safe = json.replace(/</g, "\\u003c");
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>sprig</title>
</head>
<body>
  <main id="outlet" data-route="${matched.load ?? ""}" data-base="${base}">
    <script type="application/json" id="__sprig_inputs">${safe}</script>
    <pre id="__sprig_ssr_preview">${escapeHtml(JSON.stringify(inputs, null, 2))}</pre>
  </main>
</body>
</html>`;
}
function escapeHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}
