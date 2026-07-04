/**
 * @mrg-keystone/sprig — the runtime contract for the folder-component model.
 *
 * This is the SERVER spine: dependency injection, the keep in-process `Backend`
 * bridge, and `bootstrap()` (routing → guards → resolve → SSR). It is backend-agnostic —
 * it does NOT import @mrg-keystone/rune; the in-process client arrives as an
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

// ── Persisted state service ────────────────────────────────────────────────
// Every live (client) StateService is tracked so the framework can serialize them
// all to localStorage on navigation and restore them on load. Server instances are
// not tracked (no localStorage there) and their persist/restore are no-ops.
const LIVE_STATES = new Set<StateService>();

/**
 * Base for an app's persisted state. Subclass it with serializable fields and mark the
 * subclass `@Injectable({ providedIn: "root", scope: "both" })`; `inject()` it anywhere.
 * The framework serializes it to localStorage on every navigation and restores it on
 * load, so state survives navigation AND full reloads. `reset()` restores the constructed
 * defaults AND clears the saved copy in localStorage.
 */
export class StateService {
  /** Once-guard: restore() is contractually once-on-load, but restoreState() runs on EVERY
   *  island hydration (incl. deferred visible/idle/interaction islands that hydrate later).
   *  Re-overlaying localStorage onto a shared providedIn:"root" singleton would revert live
   *  in-memory mutations made since load (persist() only runs on nav/pagehide, so localStorage
   *  holds the stale value). Guard so only the FIRST restore applies; reset() re-enables it. */
  #restored = false;
  constructor() {
    if (typeof localStorage !== "undefined") {
      LIVE_STATES.add(this);
      // restore AFTER the subclass field initializers run (they execute after super()),
      // so a saved value isn't immediately clobbered by `count = 0`. Read restored fields
      // in onBrowserInit (which runs after hydration), not synchronously in setup().
      queueMicrotask(() => this.restore());
    }
  }
  /** localStorage key. Prefers a stable `static key` (set one — class names are MANGLED by
   *  the production minifier, so `constructor.name` is not durable across builds). */
  protected storageKey(): string {
    const k = (this.constructor as { key?: string }).key ?? this.constructor.name;
    return `sprig:state:${k}`;
  }
  /** Serialize this instance's own fields to localStorage (no-op on the server). */
  persist(): void {
    if (typeof localStorage === "undefined") return;
    localStorage.setItem(this.storageKey(), JSON.stringify(this));
  }
  /** Overlay the saved fields from localStorage onto this instance (no-op server-side). */
  restore(): void {
    if (typeof localStorage === "undefined") return;
    // Once-on-load: a later restore (deferred-island hydration) must NOT clobber live
    // mutations. Set the flag BEFORE the read so even an empty-localStorage first call
    // counts as "restored", preventing a later overlay of a stale value.
    if (this.#restored) return;
    this.#restored = true;
    const raw = localStorage.getItem(this.storageKey());
    if (raw === null) return;
    try {
      const data = JSON.parse(raw) as Record<string, unknown>;
      // Overlay only DATA fields. A corrupt/tampered entry whose key collides with a
      // method name (persist/reset/restore/storageKey) or "__proto__" must NOT clobber
      // the method or pollute the prototype — that would break the service on the next
      // persist()/restore() call. Skip a key whose current value is a function (a method
      // up the prototype chain) and never write through "__proto__".
      for (const k of Object.keys(data)) {
        if (k === "__proto__") continue;
        if (typeof (this as Record<string, unknown>)[k] === "function") continue;
        (this as Record<string, unknown>)[k] = data[k];
      }
    } catch { /* corrupt entry → keep current state */ }
  }
  /** Reset every field to its constructed default AND delete the saved state. */
  reset(): void {
    const fresh = new (this.constructor as new () => this)();
    LIVE_STATES.delete(fresh); // the fresh probe must not stay tracked
    for (const k of Object.keys(this)) delete (this as Record<string, unknown>)[k];
    Object.assign(this, fresh);
    // A reset returns to constructed defaults + clears the saved copy; re-enable a future
    // restore so a subsequently-persisted session can be loaded again.
    this.#restored = false;
    if (typeof localStorage !== "undefined") localStorage.removeItem(this.storageKey());
  }
}

/** Persist every live state service — the client calls this on each navigation. */
export function persistState(): void {
  for (const s of LIVE_STATES) s.persist();
}
/** Restore every live state service from localStorage — called once on client bootstrap. */
export function restoreState(): void {
  for (const s of LIVE_STATES) s.restore();
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

/** Detect a SECOND copy of the sprig runtime in one document. Module-scoped state
 *  (the DI context `current` below, token symbols, class identities) cannot cross
 *  copies, so a dual load kills every island with a misleading inject()/provider
 *  error. The usual cause: a stale cached bundle running next to a freshly fetched
 *  chunk after a redeploy. Report the REAL cause loudly and flag the state so the
 *  hydrate loop can attempt its one-shot recovery reload (hydrate.ts). Browser-only:
 *  on the server two module instances are legitimate (tests import with query
 *  strings; jsr + relative specifiers can coexist) and a reload is meaningless.
 *  Exported for direct testing; runs once at module init. */
export function detectDualRuntime(
  g: { __sprig_runtime?: true; __sprig_runtime_dual?: true } = globalThis as never,
  // via globalThis (not a bare `document`) so core.ts type-checks lib-agnostically —
  // it is imported by DOM-lib and deno-lib graphs alike
  isBrowser: boolean = typeof (globalThis as { document?: unknown }).document !== "undefined",
): boolean {
  if (!isBrowser) return false;
  if (g.__sprig_runtime) {
    g.__sprig_runtime_dual = true;
    console.error(
      "[sprig] two copies of the sprig runtime are loaded in this document — usually a " +
        "stale cached bundle running next to a fresh one after a redeploy. Islands will " +
        "fail to hydrate. Hard-reload / clear caches if this page does not recover itself.",
    );
    return true;
  }
  g.__sprig_runtime = true;
  return false;
}
detectDualRuntime();

let current: Injector | undefined;
/** Resolve a dependency from the active injector. Synchronous-only: call it
 *  before any `await` (capture deps into vars first). */
export function inject<T>(token: Ctor<T> | Token<T>): T {
  if (!current) {
    throw new Error("inject() must be called synchronously within setup(), resolve(), a guard, or a service constructor");
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
/** What a guard receives. `path` is the target route's post-base path segments
 *  (as they appear in the URL, undecoded) — return it (or an equal route) to let
 *  the navigation proceed. `params` are the matched `:param` captures (decoded).
 *  `headers` are the incoming request's headers — page navigations carry the
 *  browser's cookies there, which is what makes a server-side auth guard possible
 *  at all (an Authorization header never accompanies a document navigation).
 *  Call `inject()` synchronously inside a guard (before any `await`) for DI —
 *  guards run on the request's route injector, so a service a guard instantiates
 *  is the SAME instance the page's resolve() later injects. */
export interface GuardCtx {
  path: string[];
  params: Record<string, string>;
  url: URL;
  headers: Headers;
}
/** A route guard: a function that returns the route — as an array of path
 *  segments — the navigation should go to. Returning the route it was going to
 *  hit anyway (`ctx.path`) lets it proceed; returning any other route answers
 *  the request with a 302 redirect there (bare path, on-base). Segments are
 *  normalized: each element may carry "/" separators and empties are dropped,
 *  so `["admin","users"]` ≡ `["admin/users"]`; `[]` means the root route. */
export type Guard = (ctx: GuardCtx) => string[] | Promise<string[]>;

/** Declarative per-route metadata for generated chrome (sidebar nav, page title) plus
 *  any app-defined keys. A route with a `nav` label is opted INTO the generated nav. */
export interface RouteMeta {
  /** sidebar/nav label — its PRESENCE opts the route into the generated nav. */
  nav?: string;
  /** an icon key the shell's nav renders next to the label. */
  icon?: string;
  /** document <title> for this route. */
  title?: string;
  [key: string]: unknown;
}

export interface Route {
  path: string;
  /** the folder-component to render. A `routers/*` load is a LAYOUT (it wraps its
   *  children in its own <router-outlet>); a `pages/*` load is a leaf page. */
  load?: string;
  children?: Route[];
  /** Guards protecting this route AND its children (the matched chain's guards
   *  run parent-first, this route's own guards last). */
  guards?: Guard[];
  /** Declarative metadata (nav label/icon/title) consumed by generated chrome. */
  meta?: RouteMeta;
  /** A grant the session must hold to enter this route AND its children — verified
   *  server-side (like a guard) before render, collected parent-first along the chain. */
  requiredGrant?: string;
}
export function defineRoutes(routes: Route[]): Route[] {
  return routes;
}

/** A `routers/*` load is a nesting LAYOUT (owns a <router-outlet>); anything else
 *  (`pages/*`) is a leaf. This is what lets a router wrap its children while a plain
 *  page-parent stays a mere index (the pre-nesting behavior is preserved). */
export function isLayoutLoad(load: string | undefined): boolean {
  return !!load && load.startsWith("routers/");
}

/** One generated-nav entry, derived from a route's `meta.nav`. */
export interface NavItem {
  href: string;
  label: string;
  icon?: string;
  /** true when the current path is at or under this item's route. */
  active: boolean;
}

/** Derive the sidebar/nav model from the route tree: every route carrying a `meta.nav` label
 *  becomes an item, its href built from the nested path segments (so the nav IS the router — no
 *  hand-maintained list). `activePath` is the current on-base path (post-base, e.g. "/queue").
 *  `base` is prefixed onto each href. Pure — usable server-side (SSR chrome) or on the client. */
export function buildNav(routes: Route[], activePath: string, base = ""): NavItem[] {
  const active = "/" + activePath.split("/").filter(Boolean).join("/"); // normalized, leading slash
  const items: NavItem[] = [];
  const walk = (rs: Route[], prefix: string): void => {
    for (const r of rs) {
      const segs = [...prefix.split("/"), ...r.path.split("/")].filter(Boolean);
      const full = "/" + segs.join("/"); // "/" for the index
      if (r.meta?.nav) {
        items.push({
          href: `${base}${full === "/" ? "/" : full}`,
          label: r.meta.nav,
          icon: r.meta.icon,
          active: active === full || (full !== "/" && active.startsWith(full + "/")),
        });
      }
      if (r.children) walk(r.children, full === "/" ? "" : full);
    }
  };
  walk(routes, "");
  return items;
}

/** One renderable level of a matched route — a route with a `load`. The renderer nests
 *  these OUTER→INNER, each layout's <router-outlet> holding the next level's HTML. */
export interface MatchedLevel {
  load: string;
  meta?: RouteMeta;
}

export interface MatchedRoute {
  /** The render stack OUTER→INNER: each matched LAYOUT (routers/*) followed by the leaf
   *  page. e.g. [{load:"routers/main"},{load:"pages/overview"}]. Length 1 = a bare page. */
  chain: MatchedLevel[];
  /** The leaf load (last chain entry) — convenience for resolve + back-compat. */
  load?: string;
  params: Record<string, string>;
  /** Guards collected along the matched chain, parent-first. */
  guards?: Guard[];
  /** Grants required along the matched chain, parent-first (verified server-side). */
  grants?: string[];
}

/** Primary-path matcher: walks routes, supports ":param" segments, nested layouts
 *  (routers/*), and an index child (`path: ""`) for a layout's default page. Returns the
 *  full render CHAIN (outer layouts → leaf page) plus the parent-first guard + grant chains. */
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
function walk(
  routes: Route[],
  segs: string[],
  inherited: Record<string, string>,
  guards: Guard[] = [],
  wrappers: MatchedLevel[] = [],
  grants: string[] = [],
): MatchedRoute | null {
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
    // fresh arrays per matched level (never mutate the caller's): a failed child descent
    // must not leak this route's guards/grants/wrapper onto a later sibling attempt.
    const gchain = route.guards?.length ? [...guards, ...route.guards] : guards;
    const grchain = route.requiredGrant ? [...grants, route.requiredGrant] : grants;
    // a LAYOUT (routers/*) wraps its children in its own outlet; a plain page-parent does
    // NOT (it stays a mere index) — that's what preserves the pre-nesting behavior.
    const childWrappers = isLayoutLoad(route.load)
      ? [...wrappers, { load: route.load!, meta: route.meta }]
      : wrappers;
    const rest = segs.slice(rs.length);
    if (rest.length === 0) {
      // A layout (or a load-less container) has no page of its OWN at its base URL, so descend
      // into an index child (`path: ""`) for its default page — the clean cure for a container
      // also having to BE a page. A plain page-parent renders ITSELF (no index override), which
      // preserves the pre-nesting behavior exactly.
      if (route.children && (isLayoutLoad(route.load) || !route.load)) {
        const idx = walk(route.children, [], params, gchain, childWrappers, grchain);
        if (idx) return idx;
      }
      // this route is the terminal: its own load (page OR router) ends the chain, nested
      // under the wrappers ABOVE it.
      const chain: MatchedLevel[] = route.load ? [...wrappers, { load: route.load, meta: route.meta }] : wrappers;
      if (!chain.length) return null; // a pure container with nothing renderable → no match
      return { chain, load: chain[chain.length - 1].load, params, guards: gchain, grants: grchain };
    }
    if (route.children) {
      const sub = walk(route.children, rest, params, gchain, childWrappers, grchain);
      if (sub) return sub;
    }
  }
  return null;
}

/** Normalize a guard's returned route: split each element on "/" and drop empty
 *  segments, so ["admin/users"], ["admin","users"], ["/admin","users/"] are all
 *  the same route and [] (or [""]) is the root. */
function normalizeRoute(out: string[]): string[] {
  return out.flatMap((s) => s.split("/")).filter((s) => s.length > 0);
}

// ──────────────────────────────── Bootstrap ─────────────────────────────────
/** The SSR renderer object (createRenderer's return). Passing it to bootstrap is the
 *  ONLY wiring an app needs — render + stream + per-page resolve loading all come from
 *  it, so `routes` alone drive data loading (no `modules` map, no per-page imports). */
export interface AppRenderer {
  renderDocument(chain: string | readonly MatchedLevel[], inputs: Record<string, unknown>, ropts?: { assetsVersion?: string }, chrome?: Record<string, unknown>): Promise<string>;
  renderStream?(chain: string | readonly MatchedLevel[], inputs: Record<string, unknown>, ropts?: { assetsVersion?: string }, chrome?: Record<string, unknown>): ReadableStream<Uint8Array>;
  loadResolve?(pageLoad: string): Promise<Resolve | undefined>;
}

export interface AppConfig {
  routes: Route[];
  base?: string;
  /** The renderer — the one thing bootstrap needs to render + auto-load resolve.ts. */
  renderer?: AppRenderer;
  /** LEGACY explicit load-string → module map. Prefer `renderer` (auto-loads resolve.ts
   *  by route `load`); this is only consulted as an override when present. */
  modules?: Record<string, ComponentModule>;
  /** LEGACY direct render callback; superseded by `renderer.renderDocument`. */
  render?: (pageLoad: string, inputs: Record<string, unknown>, ropts?: { assetsVersion?: string }) => Promise<string>;
  /** LEGACY direct stream callback; superseded by `renderer.renderStream`. */
  renderStream?: (pageLoad: string, inputs: Record<string, unknown>, ropts?: { assetsVersion?: string }) => ReadableStream<Uint8Array>;
  /** Verify a route's `requiredGrant` server-side (runs after guards, before resolve — no data
   *  work for a denied page). Given the grant name + the request ctx (headers → the session
   *  cookie), return whether the caller holds it. The app wires this to its auth model (e.g. rune
   *  `grantsForApp` + the `*` skeleton). A grant the caller lacks redirects like a denied guard. */
  verifyGrant?: (grant: string, ctx: GuardCtx) => boolean | Promise<boolean>;
  /** Where a missing grant redirects (bare path segments; default `["login"]`). */
  grantDenied?: string[];
}
export interface SprigApp {
  /** `env.assetsVersion` is the content hash of the dir the assets are ACTUALLY served
   *  from (serveSprig/sprigUi compute it from their assetsDir). The renderer stamps it
   *  into `?v=` so the asset URLs are content-addressed — the renderer's own fallback
   *  (SPRIG_ASSETS_DIR/<cwd>/static) can't know the served dir and degrades on Deploy. */
  fetch(req: Request, info?: Deno.ServeHandlerInfo, env?: { backend?: BackendClient; assetsVersion?: string }): Promise<Response>;
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
    // SAMEORIGIN (not DENY) so an app may frame its own pages (e.g. an isolated
    // component preview in a stage iframe) while still blocking cross-origin clickjacking
    "x-frame-options": "SAMEORIGIN",
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

      // Guards run BEFORE resolve (no data work for a denied page), each wrapped
      // in runInInjector individually so EVERY guard gets a synchronous inject()
      // window (an earlier guard's `await` must not strip the injector from the
      // next one). The first guard whose returned route differs from the target
      // route wins → 302 there; all guards returning the target → proceed.
      const segs = path.split("/").filter((s) => s.length > 0);
      const gctx: GuardCtx = { path: segs, params: matched.params, url, headers: req.headers };
      if (matched.guards?.length) {
        const target = segs.join("/");
        try {
          for (const guard of matched.guards) {
            const out = normalizeRoute(await runInInjector(routeInjector, () => guard(gctx)));
            if (out.join("/") !== target) {
              return new Response(null, {
                status: 302,
                headers: { "location": `${base}/${out.join("/")}`, "cache-control": "no-store" },
              });
            }
          }
        } catch {
          // a throwing guard fails CLOSED — same controlled 500 as a resolve failure
          return new Response("Internal Server Error", { status: 500, headers: ssrHeaders() });
        }
      }
      // GRANTS: declarative per-route requirement (collected parent-first along the chain),
      // verified via the app's grant verifier — which checks the cookie-borne session against its
      // grant model (deny-by-default). A grant the caller lacks redirects like a denied guard. This
      // MUST live here (not in resolve): ResolveCtx has no headers, so the session is unreadable
      // there — the documented SSR-data-leak surface.
      if (matched.grants?.length && config.verifyGrant) {
        try {
          for (const grant of matched.grants) {
            const ok = await runInInjector(routeInjector, () => config.verifyGrant!(grant, gctx));
            if (!ok) {
              const to = normalizeRoute(config.grantDenied ?? ["login"]);
              return new Response(null, {
                status: 302,
                headers: { "location": `${base}/${to.join("/")}`, "cache-control": "no-store" },
              });
            }
          }
        } catch {
          return new Response("Internal Server Error", { status: 500, headers: ssrHeaders() });
        }
      }

      // resolve(): an explicit modules[load] override wins; otherwise auto-load the
      // page's resolve.ts by its route `load` path (the renderer knows the src root).
      // This is what makes `routes` alone enough — no `modules` map in the app config.
      let resolveFn: Resolve | undefined = matched.load ? config.modules?.[matched.load]?.resolve : undefined;

      // resolve() runs BEFORE headers go out, so its failure (or a not-found status it
      // sets) is honored on the response line; a render failure after this is a 500 in
      // the buffered path, or a closed partial stream once the head has been flushed.
      // loadResolve() lives INSIDE this try too: an existing resolve.ts that throws at
      // import time now propagates (it is no longer swallowed to undefined), so it must
      // become the same graceful 500 instead of an uncaught handler crash.
      let inputs: Record<string, unknown> = {};
      try {
        if (!resolveFn && matched.load && config.renderer?.loadResolve) {
          resolveFn = await config.renderer.loadResolve(matched.load);
        }
        if (resolveFn) {
          inputs = await runInInjector(routeInjector, () => resolveFn!({ params: matched.params, url }));
        }
      } catch {
        return new Response("Internal Server Error", { status: 500, headers: ssrHeaders() });
      }
      // A resolve/service may have signalled a not-found (matched route, missing
      // resource) by setting the request status; honor it on the response line.
      const status = root.status ?? 200;

      // the served-assets content hash from serveSprig/sprigUi → the renderer's ?v=
      const ropts = env?.assetsVersion ? { assetsVersion: env.assetsVersion } : undefined;
      const renderer = config.renderer;
      // the generated-nav model (from route metadata + the current path) handed to layouts/shell
      // as chrome — so the nav IS the route tree, no hand-maintained list. Cheap + pure.
      const chrome: Record<string, unknown> = { nav: buildNav(config.routes, path, base) };

      // Streaming SSR (preferred): flush the head now, stream the body after its fetches. A
      // LEGACY config.renderStream callback (single page) keeps priority; otherwise the modern
      // renderer streams the whole matched CHAIN (nested layouts → leaf).
      if (method !== "HEAD" && matched.chain.length) {
        if (config.renderStream) {
          return new Response(config.renderStream(matched.load!, inputs, ropts), { status, headers: ssrHeaders() });
        }
        if (renderer?.renderStream) {
          return new Response(renderer.renderStream(matched.chain, inputs, ropts, chrome), { status, headers: ssrHeaders() });
        }
      }

      let html: string;
      try {
        if (config.render && matched.load) {
          html = await config.render(matched.load, inputs, ropts); // LEGACY single-page callback
        } else if (renderer?.renderDocument && matched.chain.length) {
          html = await renderer.renderDocument(matched.chain, inputs, ropts, chrome);
        } else {
          html = renderDocument(matched, inputs, base); // legacy <pre>-dump placeholder
        }
      } catch {
        return new Response("Internal Server Error", { status: 500, headers: ssrHeaders() });
      }
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

// Firebase/Google sign-in + the session-bearer transport — sprig OWNS the auth flow so apps
// don't hand-roll (and misbuild) it. `loginWithGoogle()` is the sign-in primitive; the rest is
// the bearer lifecycle (store, auto-attach to /api, seed from a `?token=` magic link, drop on a
// stale 401). Pairs with the same-origin /auth gateway serveSprig auto-mounts (@mrg-keystone/sprig/keep).
// Re-exported here so an island simply does `import { loginWithGoogle } from "@mrg-keystone/sprig"`.
// (auth.ts is SSR-safe — its on-load side effects are typeof-guarded, so this is inert server-side.)
export {
  apiPost,
  authFetch,
  AuthError,
  getUserData,
  hasSession,
  loginWithGoogle,
  logout,
  SESSION_COOKIE,
  setBearer,
  signOut,
  warmAuth,
} from "./auth.ts";
