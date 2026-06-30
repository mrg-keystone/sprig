/// <reference lib="dom" />
// Client runtime (M7 — per-island code-split). The eager loader (`client.js`) calls
// bootstrapIslands(): it scans the DOM for <sprig-island> and, per island, schedules
// a dynamic import() of that island's OWN chunk (`isl.<sel>.js`) when its trigger
// fires (load / idle / visible / interaction). Each island chunk calls
// registerIsland(), which hydrates the matching elements. The interpreter + setup +
// @sprig/core live in ONE shared chunk (esbuild --code-splitting dedups it), so the
// client root injector + signals are never duplicated across islands.
//
// Hydration itself reuses the SAME interpreter as SSR (renderNodes over the
// serialized JSON AST — no wasm): re-render the island body inside an effect (so any
// signal write re-paints) and wire (event) bindings via delegation on the island root.
import { type Accessor, clientRoot, type ComponentCtx, effect, persistState, restoreState, runInInjector, signal, type WritableAccessor } from "@sprig/core";
import { fromSerialized, type SerializedTemplate } from "./serialize.ts";
import { evalStatement, type Scope } from "./expr.ts";
import { type ComponentDef, type Handler, type MockSpec, type Registry, renderNodes } from "./render.ts";
import { named } from "./node.ts";
import { scopeId } from "./scope.ts";
import { restore } from "./lifecycle.ts";

/** Adapt a class default-export into the setup() contract: the instance IS the scope.
 *  Snapshot restore + onBrowserInit/onBrowserDestroy are handled by hydrateIsland. */
// deno-lint-ignore no-explicit-any
export function makeClassSetup(Cls: new (ctx: any) => Record<string, unknown>) {
  // construct inside the client root injector so inject() resolves in the constructor /
  // field initializers (mirrors the server's withServerInjector), e.g. inject(StateService).
  return (ctx: ComponentCtx) => runInInjector(clientRoot(), () => new Cls(ctx));
}

export interface IslandEntry {
  setup: (ctx: ComponentCtx) => Record<string, unknown>;
  template: SerializedTemplate;
  /** the component's view-encapsulation marker (path-derived, from the build) so
   *  the client re-render stamps the SAME scope attribute the SSR + scoped CSS use.
   *  Falls back to scopeId(selector) for older chunks that didn't carry it. */
  scope?: string;
}
/** Read from the SSR'd <script id="__sprig_config"> — where chunks live + cache version. */
export interface SprigConfig {
  base: string;
  v: string;
  /** Off-app route prefixes (keep-owned, e.g. ["/api", "/docs"]) the soft-nav handler
   *  must leave to the browser. Without this, at base "" the base-containment test is
   *  true for every same-origin path, so soft-nav would needlessly fetch these. */
  reserved?: string[];
  /** The matched page (its folder basename, e.g. "home") for THIS document — the SSR
   *  emits it so the client can resolve an island's child components against the same
   *  page-local registry the server used (registryForPage). A fallback for hosts that
   *  carry no data-page; soft-nav re-sets it from each swapped document. */
  page?: string;
}

// Static (non-island) component templates shipped to the client by the build, so an
// island's in-browser re-render can resolve child components instead of dropping them.
// Page-aware resolution mirrors the server's registryForPage (mod.ts): a GLOBAL map of
// shared/shell/page statics keyed by selector, PLUS a per-page map of page-local statics
// (pages/<page>/components/<name>/) keyed by page → selector. A page-local def SHADOWS a
// same-basename global one WITHIN its page only — so two same-basename statics (a global +
// a page-local) no longer silently last-write-wins by bare selector. registerComponent()
// (globals) + registerPageComponent() (page-locals) are called from the eager loader.
const componentRegistry = new Map<string, ComponentDef>();
const pageComponentRegistry = new Map<string, Map<string, ComponentDef>>(); // page → (selector → def)
export function registerComponent(sel: string, def: { template: SerializedTemplate; scope: string }): void {
  componentRegistry.set(sel, { selector: sel, template: fromSerialized(def.template), scope: def.scope });
}
/** Register a page-local static component (shadows a same-basename global within `page`). */
export function registerPageComponent(page: string, sel: string, def: { template: SerializedTemplate; scope: string }): void {
  let m = pageComponentRegistry.get(page);
  if (!m) pageComponentRegistry.set(page, (m = new Map()));
  m.set(sel, { selector: sel, template: fromSerialized(def.template), scope: def.scope });
}
/** A page-aware components registry mirroring the server's registryForPage: resolve a
 *  child by (page, selector) → page-local static ?? global static ?? ISLAND. `null`/unknown
 *  page → global statics + islands only. Built per island from its host's data-page so an
 *  island on page X composes page X's local child (not whichever same-basename static the
 *  build wrote last).
 *
 *  ISLAND-AWARE (bug AJ): islands self-register into the SEPARATE `registry` map (selector →
 *  IslandEntry), which render.ts never queried — so a CHILD island composed inside a parent
 *  island's template resolved to undefined during the parent's client re-render, fell through
 *  to NATIVE rendering (a bare <child> element), and morph then destroyed the live hydrated
 *  child host. Here we ALSO consult the island registry: a selector that is NOT a static but
 *  IS a (loaded) island resolves to a minimal island ComponentDef. renderComponent's CLIENT
 *  branch then emits a <sprig-island data-sel> SHELL the morph matches to the live host (and
 *  bootstrapIslands can lazy-load), instead of a bare custom element. Statics still WIN over an
 *  island of the same selector (same-basename islands already fail loud at build), so this
 *  never changes static resolution. */
export function componentsForPage(page: string | null): Registry {
  const locals = page ? pageComponentRegistry.get(page) : undefined;
  return {
    get: (sel) => {
      const stat = locals?.get(sel) ?? componentRegistry.get(sel);
      if (stat) return stat;
      const isl = registry.get(sel);
      if (isl) {
        // A minimal island ComponentDef: the client never renders the child's BODY (the child
        // island owns it), so `island.scope` is the identity (it is only invoked on the SERVER
        // branch, never here) and the template is the child's own serialized AST. The marker
        // makes renderComponent take the island branch → emit a <sprig-island> shell.
        return {
          selector: sel,
          template: fromSerialized(isl.template),
          scope: isl.scope ?? scopeId(sel),
          island: { scope: (i: Scope) => i, trigger: islandTrigger(sel) },
        };
      }
      return undefined;
    },
  };
}
/** The trigger a child-island host should advertise during a parent re-render. We don't have
 *  the original SSR trigger in the island entry, so fall back to the live host's data-trigger
 *  if one is mounted, else "load". (The shell is matched to the live host by morph regardless;
 *  this only matters for a child that has NOT yet loaded, where bootstrapIslands re-arms it.) */
function islandTrigger(sel: string): string {
  try {
    const live = document.querySelector(`sprig-island[data-sel="${cssEscape(sel)}"]`) as HTMLElement | null;
    return live?.dataset.trigger ?? "load";
  } catch {
    return "load";
  }
}
// The current document's matched page (a fallback for island hosts that carry no
// data-page). Set from __sprig_config at bootstrap and re-set after each soft-nav swap so
// islands hydrated into the new outlet resolve their children against the new page.
let _currentPage: string | null = null;
export function setCurrentPage(page: string | null | undefined): void {
  _currentPage = page ?? null;
}
export function currentPage(): string | null {
  return _currentPage;
}

// selector → its loaded entry (filled when an island chunk calls registerIsland)
const registry = new Map<string, IslandEntry>();
// selectors whose chunk import() is in flight (de-dupe concurrent triggers)
export const loading = new Set<string>();

/** Fired right after an island's setup() runs, handing external tooling a live
 *  handle on the mounted island — its element, selector, raw inputs, and the
 *  reactive `scope` setup() returned (whose signals ARE the island's state). The
 *  preview/inspection harness uses this to build an editable control surface by
 *  introspection (see isSignal in @sprig/core). No-op for normal apps. */
export interface IslandMount {
  el: HTMLElement;
  sel: string;
  inputs: Scope;
  scope: Record<string, unknown>;
}
const islandMountSubs = new Set<(m: IslandMount) => void>();
const islandMounts: IslandMount[] = [];
/** Subscribe to island mounts. The callback is REPLAYED for every island already
 *  mounted (so a late subscriber — e.g. a harness island that hydrates after its
 *  target — still sees it), then called for each future mount. Returns an
 *  unsubscribe fn. Order-independent by design. */
export function onIslandMounted(cb: (m: IslandMount) => void): () => void {
  islandMountSubs.add(cb);
  for (const m of islandMounts) {
    try {
      cb(m);
    } catch { /* harness errors must never break hydration */ }
  }
  return () => islandMountSubs.delete(cb);
}

// ─────────────────────────── teardown bookkeeping ───────────────────────────
// Soft-nav replaces an outlet's innerHTML wholesale, which detaches every island
// (and any armed-but-not-yet-fired trigger) inside it. Without explicit teardown the
// per-island reactive effect, its IntersectionObserver/idle timer, and the HMR `live`
// entry all leak (and the effect would keep writing to detached nodes). We track each
// mounted island's disposer and each armed trigger's canceller, keyed by element, and
// run them before/at the moment the element leaves the document.
interface Mounted {
  el: HTMLElement;
  dispose(): void;
}
interface Armed {
  el: HTMLElement;
  cancel(): void;
}
const mounted: Mounted[] = [];
const armed: Armed[] = [];

/** Tear down every island/armed-trigger whose host element is inside `root` (or already
 *  detached). Called right before an outlet swap discards the subtree. */
export function teardownInside(root: ParentNode | null): void {
  const gone = (el: HTMLElement) => !el.isConnected || (root != null && (root === el || root.contains(el)));
  for (let i = armed.length - 1; i >= 0; i--) {
    if (gone(armed[i].el)) {
      try {
        armed[i].cancel();
      } catch { /* best-effort */ }
      armed.splice(i, 1);
    }
  }
  for (let i = mounted.length - 1; i >= 0; i--) {
    if (gone(mounted[i].el)) {
      try {
        mounted[i].dispose();
      } catch { /* best-effort */ }
      mounted.splice(i, 1);
    }
  }
  // prune the mount handles too, else islandMounts retains a detached element + its
  // scope for every island EVER mounted (a soft-nav leak). Keeps it bounded to the
  // currently-mounted set, which is also the correct replay set for late subscribers.
  for (let i = islandMounts.length - 1; i >= 0; i--) {
    if (gone(islandMounts[i].el)) islandMounts.splice(i, 1);
  }
}

// ───────────────────────────── HMR (dev only) ───────────────────────────────
// State-preserving hot-swap: a mounted island keeps the SAME reactive scope (its
// signals = its state) while its template AST is swapped under it. Tracking is off
// unless the dev client calls enableHmr() before islands hydrate, so prod pays nothing.
let hmrEnabled = false;
interface LiveIsland {
  sel: string;
  el: HTMLElement;
  swap(template: SerializedTemplate): void;
}
const live: LiveIsland[] = [];

/** Turn on live-instance tracking (called by the dev HMR client at startup). */
export function enableHmr(): void {
  hmrEnabled = true;
}

/** Test-only: how many instances the HMR `live` registry currently holds (it must stay
 *  bounded to currently-mounted islands, not grow with every soft-nav). */
export function liveCount(): number {
  return live.length;
}

/** HMR: re-render every mounted instance of `sel` with a new template, keeping state.
 *  Detached instances are pruned so `live` stays bounded to currently-mounted islands. */
export function hotTemplate(sel: string, template: SerializedTemplate): void {
  const cur = registry.get(sel);
  if (cur) registry.set(sel, { ...cur, template }); // future mounts use the new AST
  for (let i = live.length - 1; i >= 0; i--) {
    const inst = live[i];
    if (!document.contains(inst.el)) {
      live.splice(i, 1); // prune dead instance (soft-nav / re-hydrate detached it)
      continue;
    }
    if (inst.sel === sel) inst.swap(template);
  }
}

/** Dev island chunks fetch their AST instead of baking it, so a hard reload after a
 *  template edit is fresh (the dev server serves the current parse). The selector is
 *  URL-encoded so it round-trips through the server's decodeURIComponent, and a non-OK
 *  response fails loudly (instead of letting r.json() throw an opaque SyntaxError). */
export async function fetchAst(base: string, sel: string): Promise<SerializedTemplate> {
  const r = await fetch(`${base}/_sprig/ast/${encodeURIComponent(sel)}`);
  if (!r.ok) throw new Error(`[sprig] failed to load island AST "${sel}": ${r.status}`);
  return await r.json();
}

// ───────────────────────── per-island chunk entry point ─────────────────────
/** Called by each `isl.<sel>.js` chunk on load: register the island + hydrate any
 *  already-present, not-yet-hydrated instances. */
export function registerIsland(sel: string, entry: IslandEntry): void {
  registry.set(sel, entry);
  loading.delete(sel); // the in-flight import has resolved → it is no longer loading
  hydratePending(sel);
}

function hydratePending(sel: string): void {
  const entry = registry.get(sel)!;
  document
    .querySelectorAll(`sprig-island[data-sel="${cssEscape(sel)}"]:not([data-sprig-hydrated])`)
    .forEach((el) => {
      // isolate each island: one instance's failure (e.g. a malformed props bridge)
      // must not abort hydration of its siblings.
      try {
        hydrateIsland(el as HTMLElement, entry);
      } catch (err) {
        console.error(`[sprig] failed to hydrate island "${sel}"`, err);
      }
    });
}

// ───────────────────────────── the eager loader ─────────────────────────────
/** Scan `root` for <sprig-island> and schedule each one's chunk to load on its trigger. */
export function bootstrapIslands(cfg: SprigConfig, root: ParentNode = document): void {
  // record the matched page so islands without a data-page host attr still resolve their
  // child components against the right page-local registry (registryForPage parity).
  setCurrentPage(cfg.page);
  root.querySelectorAll("sprig-island").forEach((el) => scheduleLoad(el as HTMLElement, cfg));
}

function scheduleLoad(el: HTMLElement, cfg: SprigConfig): void {
  if (el.dataset.sprigHydrated || el.dataset.sprigArmed) return;
  el.dataset.sprigArmed = "1";
  const sel = el.dataset.sel ?? "";
  const trigger = el.dataset.trigger ?? "load";
  const go = () => loadIsland(sel, cfg);

  if (trigger === "visible") {
    const io = new IntersectionObserver((entries, obs) => {
      if (entries.some((e) => e.isIntersecting)) {
        obs.disconnect();
        go();
      }
    });
    io.observe(el);
    // if the outlet is swapped before this ever intersects, disconnect the observer
    armed.push({ el, cancel: () => io.disconnect() });
  } else if (trigger === "idle") {
    // deno-lint-ignore no-explicit-any
    const g = globalThis as any;
    const ric = g.requestIdleCallback as ((cb: () => void) => number) | undefined;
    const cic = g.cancelIdleCallback as ((id: number) => void) | undefined;
    const id = ric ? ric(go) : setTimeout(go, 200);
    armed.push({ el, cancel: () => (ric && cic ? cic(id as number) : clearTimeout(id as number)) });
  } else if (trigger === "interaction") {
    const fire = () => {
      el.removeEventListener("pointerover", fire);
      el.removeEventListener("focusin", fire);
      go();
    };
    el.addEventListener("pointerover", fire, { once: true });
    el.addEventListener("focusin", fire, { once: true });
    armed.push({
      el,
      cancel: () => {
        el.removeEventListener("pointerover", fire);
        el.removeEventListener("focusin", fire);
      },
    });
  } else {
    go(); // "load"
  }
}

/** Load an island's chunk (once) then hydrate its instances. Already-loaded → just hydrate. */
function loadIsland(sel: string, cfg: SprigConfig): void {
  if (registry.has(sel)) {
    hydratePending(sel);
    return;
  }
  if (loading.has(sel)) return;
  loading.add(sel);
  // the chunk self-registers via registerIsland() on execute; convention-based URL.
  import(`${cfg.base}/_assets/isl.${sel}.js?v=${cfg.v}`).catch((err) => {
    loading.delete(sel);
    console.error(`[sprig] failed to load island "${sel}"`, err);
  });
}

// ──────────────────────────── soft navigation ───────────────────────────────
// deno-lint-ignore no-explicit-any
type NavEvent = any;
/** Deps the soft-nav handler needs, injected so the decision logic is testable
 *  without a real Navigation API / DOM. */
export interface SoftNavDeps {
  fetch: (url: string, init: { signal: unknown }) => Promise<Response>;
  parse: (html: string) => Document;
  outletOf: (doc: ParentNode) => Element | null;
  assign: (url: string) => void;
  scrollTo: (x: number, y: number) => void;
  scrollToTarget: (root: ParentNode, hash: string) => boolean;
  bootstrap: (root: ParentNode) => void;
  teardown: (root: ParentNode | null) => void;
  viewTransition?: (cb: () => void) => void;
  /** Read the matched page from a fetched document's __sprig_config (the soft-nav swap
   *  keeps only the outlet's innerHTML, so the config script — which carries the new
   *  page — is read off the parsed doc and threaded into the live cfg before bootstrap,
   *  so islands hydrated into the new outlet resolve children against the NEW page). */
  pageOf?: (doc: ParentNode) => string | undefined;
}

/** Should this navigate event be left to the browser (NOT soft-intercepted)?
 *  Skips: non-interceptable, hash-only, downloads, form posts, cross-origin, out-of-base,
 *  reloads (must re-run the full lifecycle), and same-URL / query-only navigations to the
 *  current path (an outlet wipe would needlessly discard in-outlet island state). */
export function softNavShouldSkip(e: NavEvent, cfg: SprigConfig, currentUrl: string): boolean {
  if (!e.canIntercept || e.hashChange || e.downloadRequest || e.formData) return true;
  if (e.navigationType === "reload") return true; // a reload must reload the document
  let url: URL, cur: URL;
  try {
    url = new URL(e.destination.url);
    cur = new URL(currentUrl);
  } catch {
    return true;
  }
  if (url.origin !== location.origin) return true;
  if (!(url.pathname === cfg.base || url.pathname.startsWith(cfg.base + "/"))) return true;
  // off-app (keep-owned) prefixes: at base "" the containment test above matches every
  // same-origin path, so without this a click on /api or /docs would soft-fetch them
  // before the outlet fallback (a wasted XHR). Leave reserved destinations to the browser.
  for (const r of cfg.reserved ?? []) {
    if (url.pathname === r || url.pathname.startsWith(r + "/")) return true;
  }
  // same path (only the query/hash differs, or identical URL): an outlet swap would
  // tear down + re-create the whole subtree and jump to top for no structural change.
  if (url.pathname === cur.pathname) return true;
  return false;
}

/** True iff the fetched response is a committable soft-nav target: a 2xx, non-redirected,
 *  text/html response. Anything else (error page, redirect, JSON, opaque) → full nav. */
export function softNavResponseOk(r: Response): boolean {
  if (!r.ok || r.redirected) return false;
  const ct = r.headers.get("content-type") ?? "";
  return ct.toLowerCase().includes("text/html");
}

/** Scroll policy after an outlet swap: restore native behavior on back/forward
 *  (traverse — let the browser/our restoration keep the prior offset), scroll a
 *  #fragment target into view when present, else jump to top (push/replace). */
export function softNavScroll(
  navigationType: string,
  hash: string,
  deps: Pick<SoftNavDeps, "scrollTo" | "scrollToTarget">,
  root: ParentNode,
): void {
  if (navigationType === "traverse") return; // browser restores the saved scroll offset
  if (hash && deps.scrollToTarget(root, hash)) return; // scrolled the anchor into view
  deps.scrollTo(0, 0);
}

/** The full soft-nav flow for one intercepted navigation, with all environment access
 *  injected so it is unit-testable. Returns when the swap (or fallback) is done. */
export async function runSoftNav(e: NavEvent, cfg: SprigConfig, deps: SoftNavDeps): Promise<void> {
  let html: string;
  try {
    const r = await deps.fetch(e.destination.url, { signal: e.signal });
    if (e.signal?.aborted) return;
    if (!softNavResponseOk(r)) {
      deps.assign(e.destination.url);
      return;
    }
    html = await r.text();
  } catch {
    // network/abort/HTTP-transport failure: fall back to a real browser navigation
    // (unless a superseding navigation already aborted this one).
    if (!e.signal?.aborted) deps.assign(e.destination.url);
    return;
  }
  if (e.signal?.aborted) return;
  const doc = deps.parse(html);
  const next = deps.outletOf(doc);
  const cur = deps.outletOf(document);
  if (!next || !cur) {
    deps.assign(e.destination.url);
    return;
  }
  const hash = (() => {
    try {
      return new URL(e.destination.url).hash;
    } catch {
      return "";
    }
  })();
  // the new document's matched page — thread it into the live cfg so the swapped-in
  // islands resolve their child components against the NEW page (registryForPage parity).
  if (deps.pageOf) cfg.page = deps.pageOf(doc);
  const swap = () => {
    deps.teardown(cur); // dispose islands/observers in the old outlet before discarding it
    (cur as HTMLElement).innerHTML = (next as HTMLElement).innerHTML;
    deps.bootstrap(cur); // new islands re-arm + lazy-load on trigger (sets currentPage from cfg)
    softNavScroll(e.navigationType, hash, deps, cur);
  };
  if (deps.viewTransition) deps.viewTransition(swap);
  else swap();
}

/** Intercept same-origin <base>/* links, swap ONLY the <sprig-outlet> in a view
 *  transition, and re-arm islands inside it (their chunks lazy-load again on
 *  trigger). Islands OUTSIDE the outlet stay mounted (state preserved). */
export function setupSoftNav(cfg: SprigConfig): void {
  // persist every state service before the page goes away (hard reload / close / cross-doc
  // nav), so it survives a full reload even when the soft-nav path below doesn't run.
  globalThis.addEventListener("pagehide", () => persistState());
  // deno-lint-ignore no-explicit-any
  const nav = (globalThis as any).navigation;
  if (!nav) return; // unsupported → normal browser navigation
  // deno-lint-ignore no-explicit-any
  const d = document as any;
  const deps: SoftNavDeps = {
    fetch: (url, init) => fetch(url, init as RequestInit),
    parse: (html) => new DOMParser().parseFromString(html, "text/html"),
    outletOf: (doc) => doc.querySelector("sprig-outlet"),
    assign: (url) => location.assign(url),
    scrollTo: (x, y) => globalThis.scrollTo(x, y),
    scrollToTarget: (root, hash) => {
      const id = (() => {
        try {
          return decodeURIComponent(hash.slice(1));
        } catch {
          return hash.slice(1);
        }
      })();
      const t = (root.querySelector(`#${CSS.escape(id)}`) as HTMLElement | null) ?? document.getElementById(id);
      if (t) {
        t.scrollIntoView();
        return true;
      }
      return false;
    },
    bootstrap: (root) => bootstrapIslands(cfg, root),
    teardown: (root) => teardownInside(root),
    pageOf: (doc) => pageFromConfig(doc),
    viewTransition: d.startViewTransition ? (cb: () => void) => d.startViewTransition(cb) : undefined,
  };
  nav.addEventListener("navigate", (e: NavEvent) => {
    if (softNavShouldSkip(e, cfg, location.href)) return;
    persistState(); // save current state before navigating away (it reconstructs on the next page)
    e.intercept({ scroll: "manual", handler: () => runSoftNav(e, cfg, deps) });
  });
}

/** Read the matched page from a (parsed) document's __sprig_config script — the page the
 *  SSR stamped for client-side page-aware child-component resolution. Undefined if absent
 *  or unparseable (→ global-only resolution, the safe default). */
export function pageFromConfig(doc: ParentNode): string | undefined {
  const el = doc.querySelector("#__sprig_config");
  if (!el?.textContent) return undefined;
  try {
    return (JSON.parse(el.textContent) as SprigConfig).page;
  } catch {
    return undefined;
  }
}

// ─────────────────────────────── hydration ──────────────────────────────────
function hydrateIsland(el: HTMLElement, entry: IslandEntry): void {
  if (el.dataset.sprigHydrated) return;
  const sel = el.dataset.sel ?? "";

  const propsEl = el.querySelector("script.sprig-props");
  // the props bridge is untrusted-shaped input (truncation / proxies can corrupt it):
  // parse BEFORE marking hydrated so a failure leaves the element retry-able, not a
  // permanently-flagged dead island.
  let inputs: Scope = {};
  if (propsEl?.textContent) inputs = JSON.parse(propsEl.textContent);
  // preview child-component overrides carried across the wire (see renderComponent)
  const mocks = inputs.__mocks as Record<string, MockSpec> | undefined;
  el.dataset.sprigHydrated = "1";

  const scope = entry.setup(clientCtx(inputs)); // the signals here ARE the island's state
  // class component: re-seed the instance from the server snapshot BEFORE the first
  // render + onBrowserInit, so the client's first paint matches the server's.
  if (inputs.__snapshot) restore(scope as Record<string, unknown>, inputs.__snapshot as Record<string, unknown>);
  // overlay localStorage-persisted state synchronously NOW — every StateService
  // injected during setup() has already run its field initializers, so this applies
  // the persisted values before the first effect render + onBrowserInit read them.
  // (StateService's constructor also queues a restore() microtask, but that lands
  // AFTER this synchronous task; this call is what makes the first paint correct.)
  restoreState();
  // hand external tooling (the preview harness) a live handle on this island,
  // recording it so late subscribers are replayed (see onIslandMounted). Also stash
  // the scope on the element itself — the DOM is shared even if a tool's chunk got a
  // separate copy of this module, so a harness can always read it off the node.
  (el as unknown as { __sprigScope?: unknown }).__sprigScope = scope;
  const mount: IslandMount = { el, sel, inputs, scope: scope as Record<string, unknown> };
  islandMounts.push(mount);
  for (const cb of islandMountSubs) {
    try {
      cb(mount);
    } catch { /* harness errors must never break hydration */ }
  }
  // re-emit the view-encapsulation marker so the re-rendered DOM keeps its scoped
  // styles. Prefer the build-supplied (path-derived) scope so it matches the SSR
  // markup + the scoped app.css; fall back to scopeId(sel) for chunks without it.
  const scopeAttr = entry.scope ?? scopeId(sel);
  // Resolve this island's child components against ITS page, mirroring the server's
  // registryForPage: a page-local static shadows a same-basename global within its page.
  // The matched page is carried on the host (data-page), falling back to __sprig_config's
  // page (set at hydrate / re-set after a soft-nav swap) and finally to global-only.
  const page = el.dataset.page ?? currentPage();
  const components = componentsForPage(page);
  // swappable across HMR; the SAME `scope` is kept so state survives a template swap
  let nodes = named(fromSerialized(entry.template));
  let source = entry.template.source;
  const tick = hmrEnabled ? signal(0) : null;

  // current handler table — rebuilt on every render; closed over by the listeners
  let handlers: Handler[] = [];
  // one delegated listener per distinct dom event the template uses (re-runnable so
  // event types introduced by a LATER render also get delegated — not just first-render).
  const wired = new Set<string>();
  const wire = () => {
    for (const base of new Set(handlers.map((h) => h.base))) {
      if (wired.has(base)) continue;
      wired.add(base);
      el.addEventListener(base, (ev: Event) => {
        const t = (ev.target as HTMLElement)?.closest?.(`[data-sprig-${base}]`) as HTMLElement | null;
        if (!t || !el.contains(t)) return;
        const marker = t.getAttribute(`data-sprig-${base}`) ?? "";
        for (const h of resolveHandlers(marker, handlers, ev)) {
          if (h.base === "submit") ev.preventDefault();
          evalStatement(h.body, h.scope, ev);
        }
      });
    }
  };

  const dispose = effect(() => {
    tick?.(); // tracked only in HMR mode, so hotTemplate() can force a re-render
    const hs: Handler[] = [];
    const html = renderNodes(nodes, { scope, registry: components, source, handlers: hs, scopeAttr, mocks });
    patchInnerHtml(el, html); // morph (preserves focus/caret/scroll) instead of wholesale replace
    handlers = hs;
    wire(); // (re)attach delegated listeners for any event base this render introduced
  });

  // client lifecycle (duck-typed — a plain { setup } object simply omits these). The
  // DOM is live after the first effect run, so onBrowserInit fires now with `this` = the
  // scope; onBrowserDestroy folds into teardown so a component can release its own
  // resources (timers/sockets/listeners) on unmount — the cleanup channel whose absence
  // bit us before.
  const life = scope as { onBrowserInit?: () => void; onBrowserDestroy?: () => void };
  life.onBrowserInit?.();

  // register teardown so soft-nav (or any detach) can dispose the effect + its
  // subscriptions, so we never leak or write to a detached node.
  mounted.push({
    el,
    dispose: () => {
      dispose();
      try {
        life.onBrowserDestroy?.();
      } catch { /* teardown cleanup must never throw past the unmount */ }
    },
  });

  if (hmrEnabled && tick) {
    live.push({
      sel,
      el,
      swap(t) {
        nodes = named(fromSerialized(t));
        source = t.source;
        tick.set(tick() + 1); // re-render with the SAME scope → state preserved
      },
    });
  }
}

/** Update `el`'s children to match `html`, REUSING existing nodes where the tag matches
 *  so focus/caret/selection/scroll and uncontrolled DOM state of unchanged elements
 *  survive a reactive re-render (instead of `el.innerHTML = html` blowing the subtree
 *  away). A lightweight position-keyed morph — no vdom, just node reuse + attr/text sync. */
export function patchInnerHtml(el: HTMLElement, html: string): void {
  // deno-lint-ignore no-explicit-any
  const tmpl = (document as any).createElement("template") as HTMLTemplateElement;
  tmpl.innerHTML = html;
  morphChildren(el, tmpl.content, /* hostLevel */ true);
}

/** Is `el` a live child-island host — a <sprig-island> carrying a data-sel? Such a host owns
 *  its own subtree (its effect/listeners/hydrated state live below it). During a PARENT
 *  island's re-render morph, it must be treated as opaque: never re-synced, never recursed
 *  into, never replaced (bug AJ — doing so destroyed the hydrated child + leaked its effect). */
function islandHostSel(node: Node): string | null {
  if (node.nodeType !== 1) return null;
  const el = node as Element;
  if (el.tagName !== "SPRIG-ISLAND") return null;
  return el.getAttribute("data-sel");
}

/** Does the re-rendered node `n` CORRESPOND to the live child-island host `o` (same child)?
 *  After the render-side fix `n` is a <sprig-island data-sel> SHELL (same data-sel). As a
 *  belt-and-suspenders fallback we also match a BARE custom element whose tag equals the
 *  host's data-sel (a chunk that didn't get the island-aware registry). Either way the live
 *  host is the authority; the re-rendered node is discarded. */
function correspondsToIslandHost(o: Node, n: Node): boolean {
  const sel = islandHostSel(o);
  if (sel == null || n.nodeType !== 1) return false;
  const ne = n as Element;
  const nSel = islandHostSel(n);
  if (nSel != null) return nSel === sel; // new is a <sprig-island data-sel> shell
  return ne.tagName.toLowerCase() === sel.toLowerCase(); // new is a bare <child> custom element
}

function sameNode(a: Node, b: Node): boolean {
  if (a.nodeType !== b.nodeType) return false;
  if (a.nodeType === 1) return (a as Element).tagName === (b as Element).tagName;
  return true; // text/comment: reuse and sync value
}

/** The island host's own hydration bridge: a <script class="sprig-props"> carrying the
 *  server snapshot. It's the host's FIRST child in the SSR DOM but is never part of the
 *  body the client re-render emits — so it must be excluded from the host-level morph
 *  alignment (see morphChildren `hostLevel`). */
function isPropsBridge(n: Node): boolean {
  return n.nodeType === 1 && (n as Element).tagName === "SCRIPT" &&
    ((n as Element).getAttribute("class") ?? "").split(/\s+/).includes("sprig-props");
}
/** A whitespace-only text node (insignificant formatting — e.g. the separator the SSR host
 *  emits between its props-script and the body). Dropped from both sides of the host-level
 *  alignment so it can't reintroduce a position skew. */
function isBlankText(n: Node): boolean {
  return n.nodeType === 3 && !(n.nodeValue ?? "").trim();
}

/** Morph `parent`'s children to match `source`'s. `hostLevel` is set ONLY for the top-level
 *  morph of an island host (patchInnerHtml): there the live DOM still carries the host's
 *  wrapper cruft — its <script class="sprig-props"> bridge plus a whitespace separator —
 *  that the body-only re-render never re-emits. Left in the alignment, that one/two-node
 *  prefix skews every position, so the live body element (which holds nested <sprig-island>
 *  hosts) lands opposite the wrong re-render node and is replaceChild'd away — destroying
 *  every nested island (bug B3). Excluding the bridge + blank text realigns body-to-body so
 *  correspondsToIslandHost can protect each nested host. The lingering bridge/whitespace
 *  nodes stay in the DOM untouched (inert). Recursion into inner elements passes hostLevel
 *  false — only a host carries the bridge. */
function morphChildren(parent: Node, source: Node, hostLevel = false): void {
  let olds = Array.from(parent.childNodes);
  let news = Array.from(source.childNodes);
  if (hostLevel) {
    olds = olds.filter((n) => !isPropsBridge(n) && !isBlankText(n));
    news = news.filter((n) => !isBlankText(n));
  }
  // KEYED island-host pre-pass (bug B3). A live <sprig-island data-sel=X> owns a hydrated
  // subtree (its effect/listeners/state live below it) and MUST be matched to the re-render's
  // corresponding node by KEY (its data-sel), never by raw position. Any structural skew
  // between the SSR body and the body-only client re-render — interleaved whitespace, the
  // host's props-bridge, an @if-toggled sibling — would otherwise shift the host opposite a
  // NON-island node, so correspondsToIslandHost (a positional check) misses and the host is
  // replaceChild'd away, destroying every nested island. So: find each live host's re-render
  // counterpart by key, pin the host in place (untouched), and drop BOTH from the positional
  // lists. The remaining (non-island) nodes morph positionally as before — a mispositioned
  // STATIC node just re-renders, but no hydrated island is ever lost.
  const liveHosts = olds.filter((o) => islandHostSel(o) != null);
  if (liveHosts.length) {
    const consumed = new Set<Node>();
    for (const host of liveHosts) {
      const match = news.find((n) => !consumed.has(n) && correspondsToIslandHost(host, n));
      if (match) consumed.add(match); // host stays as-is; its re-render counterpart is absorbed
    }
    olds = olds.filter((o) => islandHostSel(o) == null); // pinned hosts: left in the DOM, untouched
    news = news.filter((n) => !consumed.has(n));
  }
  const max = Math.max(olds.length, news.length);
  for (let i = 0; i < max; i++) {
    const o = olds[i];
    const n = news[i];
    if (!n) {
      if (o) parent.removeChild(o);
      continue;
    }
    if (!o) {
      parent.appendChild(n.cloneNode(true));
      continue;
    }
    // A live child-island host the parent re-render reached: leave it ENTIRELY untouched
    // (no attr sync, no recursion, no replace). The child island owns + manages its subtree;
    // morphing it would strip its hydration marker / inner body / wipe its state (bug AJ).
    if (correspondsToIslandHost(o, n)) continue;
    if (sameNode(o, n)) {
      morphNode(o, n);
    } else {
      parent.replaceChild(n.cloneNode(true), o);
    }
  }
}

function morphNode(o: Node, n: Node): void {
  if (o.nodeType === 1) {
    const oe = o as Element, ne = n as Element;
    // sync attributes (so [disabled], class, data-sprig-* indices, etc. update in place)
    for (const a of Array.from(ne.attributes)) {
      if (oe.getAttribute(a.name) !== a.value) oe.setAttribute(a.name, a.value);
    }
    for (const a of Array.from(oe.attributes)) {
      if (!ne.hasAttribute(a.name)) oe.removeAttribute(a.name);
    }
    morphChildren(oe, ne);
  } else {
    if (o.nodeValue !== n.nodeValue) o.nodeValue = n.nodeValue;
  }
}

function clientCtx(inputs: Scope): ComponentCtx {
  return {
    input<T>(n: string, fb?: T): Accessor<T> {
      return signal((n in inputs ? inputs[n] : fb) as T) as Accessor<T>;
    },
    output<T = void>(_n: string): (v: T) => void {
      return () => {}; // cross-island outputs: future work
    },
    model<T>(n: string, fb?: T): WritableAccessor<T> {
      return signal((n in inputs ? inputs[n] : fb) as T);
    },
  };
}

// chord modifier tokens are tested against the event's modifier-key booleans, NOT
// against e.key (which holds the single main key). Everything else is a key token.
const KEY_ALIAS: Record<string, string> = { enter: "enter", escape: "escape", space: " ", tab: "tab", esc: "escape" };
const MOD_FLAG: Record<string, "ctrlKey" | "shiftKey" | "altKey" | "metaKey"> = {
  control: "ctrlKey",
  ctrl: "ctrlKey",
  shift: "shiftKey",
  alt: "altKey",
  option: "altKey",
  meta: "metaKey",
  cmd: "metaKey",
  command: "metaKey",
};
/** Resolve a `data-sprig-<base>` marker (the index, or space-joined index list, that
 *  render.ts stamps for the bindings sharing one DOM base) into the handlers that should
 *  fire for `ev` — every handler whose index is listed AND whose chord modifiers match
 *  the event, in order (mirroring addEventListener: two same-base handlers both fire). */
export function resolveHandlers(marker: string, handlers: Handler[], ev: Event): Handler[] {
  const out: Handler[] = [];
  for (const idx of marker.split(/\s+/)) {
    if (idx === "") continue;
    const h = handlers[Number(idx)];
    if (!h || (h.modifiers.length && !keyMatches(ev, h.modifiers))) continue;
    out.push(h);
  }
  return out;
}

export function keyMatches(e: Event, mods: string[]): boolean {
  const ke = e as KeyboardEvent;
  const key = ke.key?.toLowerCase();
  for (const m of mods) {
    const flag = MOD_FLAG[m];
    if (flag) {
      if (!ke[flag]) return false; // chord modifier must be held
    } else {
      if (key !== (KEY_ALIAS[m] ?? m)) return false; // the main key must match
    }
  }
  return true;
}

// minimal CSS.escape for the data-sel attribute selector (selectors are kebab idents)
function cssEscape(s: string): string {
  return s.replace(/["\\]/g, "\\$&");
}
