// Public compiler API: scan a `src` tree for folder-components, then render a
// matched page into the shell's <router-outlet> as a full HTML document. The
// SSR body that bootstrap() used to fake with a JSON dump is now real markup.
import { basename, dirname, join, relative, toFileUrl } from "@std/path";
import { walk } from "@std/fs/walk";
import { clearStaticCache, type ComponentDef, islandHost, type Registry, renderNodes, resolveIslands, type RouteCtx } from "./render.ts";
import { snapshotOf } from "./lifecycle.ts";
import { named, type Node } from "./node.ts";
import { fromSerialized, serialize, type SerializedTemplate } from "./serialize.ts";

// The wasm-backed parser is a BUILD/DEV concern only — loaded lazily so the prod runtime
// (which renders prebuilt serialized ASTs from templates.json) never pulls tree-sitter
// into its import graph. Only sprig dev / a missing prebuild ever triggers this import.
let _parser: typeof import("./parse.ts") | null = null;
const parser = async () => (_parser ??= await import("./parse.ts"));
import type { Scope } from "./expr.ts";
import { makeServerCtx, withServerInjector } from "./island.ts";
import { versionOf } from "./hash.ts";
import { componentScopeId } from "./scope.ts";
import { perfConfig, type PerfConfig, perfHeadSnippet } from "./perf.ts";
import type { ComponentDef as CoreComponentDef, MatchedLevel, Resolve } from "@mrg-keystone/sprig";

export interface SsrRenderer {
  /** Render the matched CHAIN (outer layouts → leaf page) nested inside the shell, return a
   *  full HTML document. `chain` is the render stack from matchRoute; a length-1 chain is a
   *  plain page (the pre-nesting behavior). `ropts.assetsVersion` (threaded from serveSprig/
   *  sprigUi via the app env) is the content hash of the dir the assets are ACTUALLY served
   *  from — it wins over this renderer's own readVersion(). */
  renderDocument(chain: string | readonly MatchedLevel[], inputs: Scope, ropts?: { assetsVersion?: string; reqCtx?: RouteCtx }, chrome?: Scope): Promise<string>;
  /** Same document, STREAMED: the <head> (asset preloads) flushes on the first byte,
   *  the body streams after its onServerInit fetches resolve. Byte-identical to
   *  renderDocument's output, just chunked. */
  renderStream(chain: string | readonly MatchedLevel[], inputs: Scope, ropts?: { assetsVersion?: string; reqCtx?: RouteCtx }, chrome?: Scope): ReadableStream<Uint8Array>;
  /** Selectors discovered (for diagnostics/tests). */
  selectors(): string[];
  /** the scanned src root (for the dev server's watcher). */
  srcDir: string;
  /** DEV: re-read + re-parse one component's template.html so SSR stays fresh. `id` is the
   *  component's relDir (its unique identity — what the dev watcher passes), or a bare
   *  selector for back-compat (unambiguous only when the basename is unique). */
  reparse(id: string): Promise<boolean>;
  /** DEV: the current serialized AST for a component, addressed by relDir (HMR — exact) or
   *  bare selector (island chunk fetchAst — unique basenames). */
  astFor(id: string): SerializedTemplate | null;
  /** Auto-load a page's data loader by its route `load` path — imports
   *  `<srcRoot>/<load>/resolve.ts` and returns its `resolve` export (undefined if the
   *  page has none). This is what lets `routes` alone drive data loading: no per-page
   *  import + no `modules` map in the app's config. */
  loadResolve(pageLoad: string): Promise<Resolve | undefined>;
}

/** Scan `srcDir` for every folder containing a template.html → selector registry
 *  (selector = folder name). The page referenced by a route's `load` resolves by
 *  its folder basename, the same map used for tag resolution. */
/** Split a bootstrap/template.html into its raw <head> content (lifted out and injected into the
 *  generated head — NEVER parsed) and its <body> content (the fragment the component parser sees).
 *  A body-only shell (no <head>/<body> tags) returns { head: "", body: the whole source unchanged }. */
export function splitShellHtml(src: string): { head: string; body: string } {
  const headMatch = src.match(/<head[^>]*>([\s\S]*?)<\/head>/i);
  const bodyMatch = src.match(/<body[^>]*>([\s\S]*?)<\/body>/i);
  const head = headMatch ? headMatch[1].trim() : "";
  const body = bodyMatch
    ? bodyMatch[1].trim()
    : src.replace(/<!doctype[^>]*>/i, "").replace(/<head[^>]*>[\s\S]*?<\/head>/i, "").replace(/<\/?html[^>]*>/gi, "").trim();
  return { head, body };
}

export async function createRenderer(
  srcDir: string,
  base = "/ui",
  opts: { dev?: boolean; shell?: string; shellDir?: string; reserved?: string[]; favicon?: string } = {},
): Promise<SsrRenderer> {
  const shellSelector = opts.shell ?? "shell";
  // off-app (keep-owned) prefixes the client soft-nav must leave to the browser. Defaults
  // to keep's defaults so an app mounted at base "" doesn't soft-fetch /api or /docs.
  const reserved = opts.reserved ?? ["/api", "/docs"];
  // hidden INFRA perf reporting (env-gated, read once at boot — see ./perf.ts): when
  // enabled, every document ships the head beacon snippet and __sprig_config carries
  // the endpoint so the client runtime can report soft navigations the same way.
  const perf = perfConfig();
  // A component's IDENTITY is its folder path relative to srcDir (unique), not its
  // bare basename. Two registries: `global` for shared/shell/page components (keyed
  // by basename, must be unique → collision throws), and `pageLocal` for components
  // under pages/<page>/components/<name>/ (keyed by page → basename), which SHADOW a
  // same-named global component within that page only. This kills the old silent
  // last-write-wins Map clobber and gives each folder a distinct scope id.
  const global = new Map<string, ComponentDef>();
  const pageLocal = new Map<string, Map<string, ComponentDef>>(); // page → (selector → def)
  const srcPath = new Map<string, string>(); // relDir id → template.html path (for reparse)
  const byRelDir = new Map<string, ComponentDef>(); // relDir id → def (the component's unique identity; what the dev/HMR path keys by)
  const lastSource = new Map<string, string>(); // relDir id → last parsed template source (HMR no-op detection)
  const bySelector = new Map<string, ComponentDef[]>(); // selector → all defs (diagnostics)
  // PROD: the build's serialized template registry (relDir → AST). Render these prebuilt
  // ASTs so the runtime never parses. Absent (no build / fresh dev) → parse live below.
  let prebuilt: Record<string, SerializedTemplate> | null = null;
  try {
    // read the prebuilt registry from the SAME dir the build wrote it to — SPRIG_ASSETS_DIR in dev
    // (the temp cache), else <cwd>/static. Reading <cwd>/static unconditionally made `sprig dev`
    // ALWAYS miss → the renderer fell back to live tree-sitter parsing every template at boot.
    prebuilt = JSON.parse(await Deno.readTextFile(join(Deno.env.get("SPRIG_ASSETS_DIR") || join(Deno.cwd(), "static"), "templates.json")));
  } catch { /* no prebuild → live parse */ }
  for await (const entry of walk(srcDir, { includeDirs: false, match: [/template\.html$/] })) {
    const dir = dirname(entry.path);
    const relDir = relative(srcDir, dir).replace(/\\/g, "/");
    const selector = basename(dir);
    await assertStaticPage(dir); // a pages/<name>/ folder cannot be an island
    const source = await Deno.readTextFile(entry.path);
    let island: ComponentDef["island"];
    const logicPath = join(dir, "logic.ts");
    if (await exists(logicPath)) {
      const mod = await import(toFileUrl(logicPath).href) as { default: unknown };
      const def = mod.default;
      const isClass = typeof def === "function" && !!(def as { prototype?: unknown }).prototype;
      if (isClass) {
        // a class component: the instance IS the scope. Run sync onServerInit before
        // render (async onServerInit arrives with the async render). withServerInjector
        // lets inject() resolve in the constructor / onServerInit.
        // deno-lint-ignore no-explicit-any
        const Cls = def as new (ctx: any) => Record<string, unknown>;
        // A route's SERVER-ONLY logic (onServerLoad, and NO browser hook) produces data server-side
        // but never hydrates — no state snapshot here, and the build ships no client entry for it.
        // Any browser hook (onBrowserLoad on a route, or onBrowserInit on an island) → hydrate.
        const proto = Cls.prototype as { onServerLoad?: unknown; onBrowserLoad?: unknown; onBrowserInit?: unknown };
        const serverOnly = typeof proto.onServerLoad === "function" &&
          typeof proto.onBrowserLoad !== "function" && typeof proto.onBrowserInit !== "function";
        island = {
          // sync fallback (islands behind control flow / not pre-resolved): runs
          // onServerInit synchronously (an async one isn't awaited on this path).
          scope: (inputs, reqCtx) =>
            withServerInjector(() => {
              const inst = new Cls(makeServerCtx(inputs)) as { onServerInit?: (ctx?: RouteCtx) => unknown; onServerLoad?: (ctx?: RouteCtx) => unknown };
              // A route names its server hook onServerLoad (the route-level twin of a component's
              // onServerInit); prefer it, fall back to onServerInit so islands are unchanged. Route
              // logic receives the request ctx (url/params/session); an island ignores the arg.
              (inst.onServerLoad ?? inst.onServerInit)?.call(inst, reqCtx);
              return inst as Scope;
            }),
          // the async pre-pass path: construct + start onServerInit INSIDE the injector
          // (so inject() resolves in the constructor AND in onServerInit's synchronous
          // part, matching the sync path), then AWAIT the result before render. DI across
          // an await still needs async-aware context (documented limitation).
          resolve: (inputs, reqCtx) =>
            withServerInjector(() => {
              const inst = new Cls(makeServerCtx(inputs)) as Record<string, unknown> & { onServerInit?: (ctx?: RouteCtx) => unknown; onServerLoad?: (ctx?: RouteCtx) => unknown };
              // onServerLoad (route) preferred over onServerInit (component); await either before render.
              // Route logic receives the request ctx (url/params/session); an island ignores the arg.
              return Promise.resolve((inst.onServerLoad ?? inst.onServerInit)?.call(inst, reqCtx)).then(() => inst as Scope);
            }),
          trigger: (Cls as { trigger?: string }).trigger ?? "load",
          snapshot: !serverOnly, // server-only route logic never hydrates; everything else snapshots
          serverOnly, // the SSR renders it statically (no hydration boundary); the build skips its client entry
        };
      } else {
        // the { setup } model: wrap setup() in a server component injector so inject()
        // resolves inside it (DI scope "both"/"server") instead of throwing.
        const d = def as CoreComponentDef;
        island = {
          scope: (inputs) => withServerInjector(() => d.setup(makeServerCtx(inputs))) as Scope,
          trigger: d.trigger ?? "load",
        };
      }
    }
    // render the prebuilt AST (no tree-sitter); live-parse only when there's no prebuild.
    const template = prebuilt?.[relDir]
      ? fromSerialized(prebuilt[relDir])
      : await (await parser()).parseCached(source);
    const def: ComponentDef = { selector, template, island, scope: componentScopeId(relDir) };
    const local = pageLocalOf(relDir);
    if (local) {
      let m = pageLocal.get(local.page);
      if (!m) pageLocal.set(local.page, (m = new Map()));
      if (m.has(selector)) {
        throw collision(selector, `page "${local.page}"`);
      }
      m.set(selector, def);
    } else {
      // shared / shell / page component — globally unique by basename
      if (global.has(selector)) throw collision(selector, "the global (shared) scope");
      global.set(selector, def);
    }
    srcPath.set(relDir, entry.path);
    byRelDir.set(relDir, def);
    lastSource.set(relDir, source);
    let defs = bySelector.get(selector);
    if (!defs) bySelector.set(selector, (defs = []));
    defs.push(def);
  }
  // ── App SHELL from the sibling entrypoint folder ──────────────────────────
  // The shell (the outer document frame) can live in the app's `bootstrap/` ENTRY folder —
  // <srcDir>/../bootstrap/template.html — instead of a scanned `src/shell/` component. This
  // unifies the entry (bootstrap/mod.ts), the shell (template.html) and the global stylesheet
  // (styles.css, collected by the build's buildCss) in ONE folder. Present → it IS the shell
  // (registered under the shell selector); absent → apps keep using a scanned "shell" component.
  // Prebuilt when the build serialized it (key = the shell selector), else live-parsed once here.
  const shellDir = opts.shellDir ?? join(srcDir, "..", "bootstrap");
  const shellHtml = join(shellDir, "template.html");
  // The app owns the document <head> CONTENT (favicon, fonts, meta, preconnects) right IN
  // bootstrap/template.html: the framework SPLITS the file — the raw <head>…</head> is lifted out
  // (never parsed) and injected into the generated <head>, and only the <body> is run through the
  // component parser (a fragment grammar that would reject <!DOCTYPE>/<html>/<head>). A body-only
  // shell is unchanged; a separate bootstrap/head.html is still honored as a fallback.
  let appHead = "";
  if (await exists(shellHtml)) {
    const { head, body } = splitShellHtml(await Deno.readTextFile(shellHtml));
    appHead = head || (await Deno.readTextFile(join(shellDir, "head.html")).catch(() => "")).trim();
    const template = prebuilt?.[shellSelector]
      ? fromSerialized(prebuilt[shellSelector])
      : await (await parser()).parseCached(body);
    global.set(shellSelector, { selector: shellSelector, template, scope: componentScopeId(shellSelector) });
  }
  // the default (page-less) registry: global only.
  const registry: Registry = { get: (s) => global.get(s) };
  /** a per-page registry: page-local components shadow global ones within the page. */
  const registryForPage = (page: string | null): Registry => {
    const locals = page ? pageLocal.get(page) : undefined;
    return { get: (s) => (locals?.get(s)) ?? global.get(s) };
  };
  /** The matched page's identity (its folder basename) for the client, iff it is a real
   *  registered page — emitted into __sprig_config so the client resolves an island's child
   *  components against the SAME page-local registry the server used. Matches the page key
   *  used by registryForPage and pageLocalOf (the segment after pages/). */
  const pageName = (pageLoad: string): string | undefined => {
    const n = basename(pageLoad);
    return global.has(n) ? n : undefined;
  };

  // The ?v= asset cache-bust is the content hash of the built static/ dir, computed on
  // demand — so there is NO separate manifest file beside the build. In dev we recompute
  // each render so a background rebuild's new hash is picked up.
  // PROD serves assets from <cwd>/static. DEV serves them from a temp cache dir (NOT
  // <cwd>/static), which `sprig dev` exports as SPRIG_ASSETS_DIR — hash THAT so ?v= reflects
  // the bundle actually served. Without this, a dev render run from a dir whose own `static/`
  // never changes (e.g. the repo root) yields a frozen ?v=, so a returning browser keeps a
  // stale cached client.js even after a rebuild.
  const staticDir = Deno.env.get("SPRIG_ASSETS_DIR") || join(Deno.cwd(), "static");
  // hash the SERVED assets only (.js + app.css) — same set the build hashes, so
  // templates.json / source maps don't perturb ?v=. A missing/empty dir degrades to
  // the constant "dev" — NOT content-addressed, so the asset server must never send
  // `immutable` for it (serveAsset only does for a ?v= matching the real hash).
  const readVersion = async () => (await versionOf(staticDir)) ?? "dev";
  let version = await readVersion();
  // The degraded state warns ONCE, at first actual use in a non-dev render — not at
  // boot, where it would false-alarm serveSprig/sprigUi apps whose env supplies the
  // real assetsVersion per request. Silent degradation is what turned a Deno Deploy
  // cwd mismatch into browsers wedged on a year-long immutable cache of ?v=dev.
  let warnedDegraded = false;
  const pickVersion = (assetsVersion?: string): string => {
    if (assetsVersion) return assetsVersion;
    if (version === "dev" && !opts.dev && !warnedDegraded) {
      warnedDegraded = true;
      console.warn(
        `[sprig] could not hash assets dir "${staticDir}" — asset URLs are not ` +
          `cache-busted (?v=dev) and long-term caching is disabled. Serve through ` +
          `serveSprig/sprigUi with assetsDir set, or set SPRIG_ASSETS_DIR.`,
      );
    }
    return version;
  };

  /** find a single def by selector for the selector-based public API (dev watcher /
   *  HMR). Prefers a global component; falls back to a uniquely-named page-local. */
  const findBySelector = (selector: string): ComponentDef | undefined => {
    const defs = bySelector.get(selector);
    return defs && defs.length ? defs[0] : undefined;
  };

  /** Render ONE level of the matched chain (a leaf page, a layout router, or the shell):
   *  run its logic.ts (onServerInit → render scope), render its template with `outlet` (keyed
   *  by `outletKey`) spliced into its <router-outlet>, and — if it is an island (has logic.ts) —
   *  wrap it as a hydration boundary so its own onBrowserInit/onBrowserDestroy fire on the
   *  client. This generalizes the old page-render + shell-wrap into one N-level primitive. */
  const renderLevel = async (
    load: string,
    inputs: Scope,
    reg: Registry,
    outlet?: string,
    outletKey?: string,
    reqCtx?: RouteCtx,
  ): Promise<string> => {
    const comp = global.get(basename(load));
    if (!comp) return outlet ?? ""; // unknown load → pass the inner content through untouched
    const mocks = (inputs as Record<string, unknown>).__mocks as
      | Record<string, import("./render.ts").MockSpec>
      | undefined;
    // the component's OWN logic.ts class IS its data source: run onServerInit and use the
    // instance as the render scope. A component with no logic.ts renders against `inputs`.
    const scope: Scope = comp.island?.resolve
      ? await comp.island.resolve(inputs, reqCtx)
      : (comp.island ? comp.island.scope(inputs, reqCtx) : inputs);
    const baseOpts = { scope, registry: reg, source: comp.template.text, scopeAttr: comp.scope, outlet, outletKey, mocks };
    // snapshot the post-onServerInit state NOW (before @let locals mutate it) so the browser
    // re-seeds before onBrowserInit — for a layout too, so its live cycle resumes correctly.
    const snap = comp.island?.snapshot ? snapshotOf(scope as Record<string, unknown>) : undefined;
    const resolved = new Map<string, Scope>();
    await resolveIslands(named(comp.template), baseOpts, resolved);
    let html = renderNodes(named(comp.template), { ...baseOpts, resolved });
    // if it's a class island, wrap it as a hydration boundary so its logic.ts hydrates on the
    // client (constructs the class, restores the snapshot, runs onBrowserInit, wires events).
    if (comp.island && !comp.island.serverOnly) {
      const propsObj: Record<string, unknown> = { ...(inputs as Record<string, unknown>) };
      if (snap) propsObj.__snapshot = snap;
      html = islandHost(comp.scope ?? "", comp.selector, comp.island.trigger, propsObj, html);
    }
    // serverOnly route logic: its onServerLoad ran to produce `scope`/`html` above, but it renders
    // as a plain static subtree — no hydration boundary, and the build emits no client entry for it.
    return html;
  };

  /** Build the <body> content for the matched CHAIN (outer layouts → leaf page), nested
   *  inner→outer, then wrapped in the shell. Each layout's <router-outlet> holds the next
   *  inner level, keyed by that level's load (data-level) so the client soft-nav can swap the
   *  deepest changed one. The leaf gets the resolved `inputs`; layouts get {} (their own
   *  logic.ts onServerInit is their data source). Shared by renderDocument + renderStream. */
  const renderBody = async (chain: readonly MatchedLevel[], inputs: Scope, chrome?: Scope, reqCtx?: RouteCtx): Promise<string> => {
    if (!chain.length) return "";
    // layouts + the shell receive the CHROME model (generated nav etc.) as their inputs; the leaf
    // page gets its own resolved data. A layout's logic.ts reads chrome via ctx.input("nav").
    const chromeInputs = chrome ?? ({} as Scope);
    const leaf = chain[chain.length - 1].load;
    // the deepest level (the page) — its page-local registry, its resolved inputs, no outlet.
    let html = await renderLevel(leaf, inputs, registryForPage(basename(leaf)), undefined, undefined, reqCtx);
    let innerLoad = leaf;
    // wrap in each ancestor LAYOUT (routers/*), inner→outer; each holds the inner HTML, keyed.
    for (let i = chain.length - 2; i >= 0; i--) {
      html = await renderLevel(chain[i].load, chromeInputs, registry, html, innerLoad, reqCtx);
      innerLoad = chain[i].load;
    }
    // wrap in the shell (outermost); its outlet is keyed by the outermost chain level.
    const shell = global.get(shellSelector);
    if (!shell) return html;
    return await renderLevel(shellSelector, chromeInputs, registry, html, innerLoad, reqCtx);
  };

  // resolve.ts loaders, imported on first match by route `load` path and cached.
  const resolveCache = new Map<string, Resolve | undefined>();
  return {
    srcDir,
    // every registered component's selector (duplicates allowed: same-basename
    // components in different folders now coexist instead of clobbering).
    selectors: () => [...bySelector.values()].flatMap((defs) => defs.map((d) => d.selector)),
    async loadResolve(pageLoad) {
      const rel = pageLoad.replace(/^\.?\/+/, ""); // "./pages/home" | "pages/home" → "pages/home"
      if (resolveCache.has(rel)) return resolveCache.get(rel);
      const path = join(srcDir, rel, "resolve.ts");
      // Distinguish "genuinely no resolve.ts" (→ undefined, a static page) from "a
      // resolve.ts that EXISTS but throws at import time" (syntax/init error). Stat first:
      // a missing file is the only thing that means "the page has none". If the file is
      // present, let an import throw PROPAGATE (don't cache it) so the real fault surfaces
      // instead of being silently masked as "no loader".
      let fn: Resolve | undefined;
      if (await exists(path)) {
        fn = (await import(toFileUrl(path).href)).resolve as Resolve | undefined;
      } else {
        fn = undefined; // no resolve.ts → a purely static page
      }
      resolveCache.set(rel, fn);
      return fn;
    },
    async renderDocument(chain, inputs, ropts, chrome) {
      if (opts.dev && !ropts?.assetsVersion) version = await readVersion();
      // snapshot the version BEFORE the body await so a concurrent dev request recomputing
      // the module-level `version` during renderBody can't make this document stamp the
      // other request's version (mirrors renderStream's `const v = version;` guard).
      // The env-threaded assetsVersion (hash of the dir serveSprig actually serves)
      // wins over readVersion(), whose SPRIG_ASSETS_DIR/<cwd>/static guess is wrong
      // exactly where it matters (Deno Deploy's cwd is not the app dir).
      const v = pickVersion(ropts?.assetsVersion);
      // a bare load string (the pre-nesting caller, incl. tests) normalizes to a length-1 chain.
      const levels = typeof chain === "string" ? [{ load: chain }] : chain;
      const leaf = levels.length ? levels[levels.length - 1].load : "";
      const body = await renderBody(levels, inputs, chrome, ropts?.reqCtx);
      return document(body, base, v, reserved, pageName(leaf), perf, !!opts.dev, titleOf(levels), opts.favicon, appHead);
    },
    renderStream(chain, inputs, ropts, chrome) {
      const enc = new TextEncoder();
      return new ReadableStream<Uint8Array>({
        async start(ctrl) {
          try {
            if (opts.dev && !ropts?.assetsVersion) version = await readVersion();
            // snapshot the version so head and tail agree even if a concurrent dev rebuild
            // mutates the module-level `version` during the body await.
            const v = pickVersion(ropts?.assetsVersion);
            const levels = typeof chain === "string" ? [{ load: chain }] : chain;
            const leaf = levels.length ? levels[levels.length - 1].load : "";
            // flush the head NOW → the browser preloads app.css + client.js while we await the
            // body's onServerLoad fetches (and, when INFRA_PERF is on, the perf beacon fires while
            // the body is still streaming).
            ctrl.enqueue(enc.encode(documentHead(base, v, perf, titleOf(levels), opts.favicon, appHead)));
            const body = await renderBody(levels, inputs, chrome, ropts?.reqCtx);
            ctrl.enqueue(enc.encode(body + documentTail(base, v, reserved, pageName(leaf), perf, !!opts.dev)));
          } catch {
            // headers + head are already on the wire, so a render failure can't become a
            // 500 — emit a marker and close (matches the renderDocument 500's no-leak rule).
            ctrl.enqueue(enc.encode("<!-- sprig: render error -->\n</body></html>"));
          } finally {
            ctrl.close();
          }
        },
      });
    },
    async reparse(id) {
      // `id` is a component's relDir (its unique IDENTITY — what the dev watcher passes),
      // or, for back-compat, a bare selector (resolved to its relDir, unambiguous only when
      // the basename is unique). Keying by relDir is what lets a page-local edit reparse the
      // PAGE-LOCAL def instead of a same-basename global one.
      const relDir = byRelDir.has(id) ? id : [...srcPath.keys()].find((rel) => basename(rel) === id);
      const cur = relDir ? byRelDir.get(relDir) : undefined;
      const path = relDir ? srcPath.get(relDir) : undefined;
      if (!relDir || !cur || !path) return false;
      const source = await Deno.readTextFile(path);
      // No-op save (unchanged bytes) → don't re-parse, mutate the registry, or
      // broadcast a hot swap that needlessly re-renders every mounted island.
      if (lastSource.get(relDir) === source) return false;
      // Mid-edit broken template: tree-sitter recovers to an ERROR AST instead of
      // throwing. Don't push that garbage live (it would clobber mounted islands'
      // markup); suppress the swap and keep the last-good template until the next
      // clean save. (parseTemplate with allowError lets us inspect hasError.)
      const p = await parser();
      const tpl = await p.parseTemplate(source, { allowError: true });
      if (p.hasParseError(tpl)) return false;
      cur.template = tpl; // defs are shared by reference across all registries
      lastSource.set(relDir, source);
      clearStaticCache(); // a template changed → stale memoized static HTML must go
      return true;
    },
    astFor(id) {
      // relDir first (dev watcher / HMR — addresses the exact component), else a bare
      // selector (island fetchAst, keyed by selector — unambiguous for unique basenames).
      const def = byRelDir.get(id) ?? findBySelector(id);
      return def ? serialize(def.template) : null;
    },
  };
}

/** Classify a component by its relative dir: page-local (under
 *  pages/<page>/components/<name>/) or global. Exported so the client BUILD classifies
 *  static components by the EXACT same rule the server uses for its page-local registry. */
export function pageLocalOf(relDir: string): { page: string; selector: string } | null {
  const parts = relDir.split("/");
  if (parts[0] === "pages" && parts.length >= 4 && parts[2] === "components") {
    return { page: parts[1], selector: parts[parts.length - 1] };
  }
  return null;
}

function collision(selector: string, where: string): Error {
  return new Error(
    `sprig: duplicate component selector "${selector}" in ${where}. Two distinct ` +
      `component folders share the basename "${selector}". Rename one folder, or make ` +
      `it a page-local component (pages/<page>/components/${selector}/) to shadow the ` +
      `shared one within a single page.`,
  );
}

async function exists(path: string): Promise<boolean> {
  try {
    await Deno.stat(path);
    return true;
  } catch {
    return false;
  }
}

/** A page IS its template + an optional `logic.ts` class (its data via onServerInit +
 *  its behavior). No restriction — this used to forbid `pages/<page>/logic.ts`; the
 *  unified model allows it (kept as a no-op so existing call sites/imports hold). */
export async function assertStaticPage(_templateDir: string): Promise<void> {}

// The document is split head/tail so a streaming response can flush the HEAD on the
// first byte — the browser preloads app.css + client.js (modulepreload) while the
// server is still awaiting the body's onServerInit fetches. documentHead() + the body +
// documentTail() concatenate to EXACTLY document()'s string (streaming is transparent).
/** The document <title> for a matched chain: the deepest level that declares meta.title (leaf
 *  overrides its parents); undefined → documentHead uses the framework default. */
function titleOf(levels: readonly { meta?: { title?: string } }[]): string | undefined {
  for (let i = levels.length - 1; i >= 0; i--) if (levels[i].meta?.title) return levels[i].meta!.title;
  return undefined;
}
function documentHead(base: string, version: string, perf: PerfConfig | null = null, title?: string, favicon?: string, appHead = ""): string {
  const client = `${base}/_assets/client.js?v=${version}`;
  // the framework's RUNTIME bits, injected into WHATEVER head is in play: the perf beacon (BEFORE the
  // stylesheet — an inline script after a pending stylesheet blocks on the CSSOM), the built app.css,
  // the island-loader preload, and the chart vendor.
  const runtime = `${perfHeadSnippet(perf)}
  <link rel="stylesheet" href="${base}/_assets/app.css?v=${version}" />
  <link rel="modulepreload" href="${client}" />
  <script defer src="${base}/_assets/vendor/apexcharts.js"></script>`;
  // The app OWNS the document head via bootstrap/template.html's <head> — its charset, viewport, title,
  // favicon, fonts and meta are AUTHORITATIVE. The framework injects only its runtime bits AFTER it and
  // generates NO competing title/charset. (createRenderer({ favicon }) + a route's meta.title still
  // drive the default head below, for an app whose template.html is body-only.)
  if (appHead) {
    return `<!DOCTYPE html>
<html lang="en">
<head>
  ${appHead}${runtime}
</head>
<body>
`;
  }
  // No app <head> → the framework's default head (charset, viewport, title, favicon).
  const t = title ? title.replace(/&/g, "&amp;").replace(/</g, "&lt;") : "sprig";
  const icon = favicon ? `\n  <link rel="icon" href="${favicon.replace(/"/g, "&quot;")}" />` : "";
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>${t}</title>${icon}${runtime}
</head>
<body>
`;
}
// The framework's client runtime scripts (config + module) — wrapped by documentTail below.
function tailScripts(base: string, version: string, reserved: string[], page?: string, perf: PerfConfig | null = null, hmr = false): string {
  const client = `${base}/_assets/client.js?v=${version}`;
  // `page` (the matched page's basename) lets the client resolve an island's child
  // components against the same page-local registry the server used (registryForPage).
  const cfg: Record<string, unknown> = { base, v: version, reserved };
  if (page !== undefined) cfg.page = page;
  // hidden INFRA perf: hand the client runtime the collector so SOFT navigations —
  // whose fetched documents never execute scripts — emit the same beacon pair.
  if (perf) cfg.perf = { url: perf.url, app: perf.app };
  // dev-only: activate the loader's dormant HMR client. Emitted ONLY when the renderer is in
  // dev mode (`sprig dev`); prod never sets it, so the bundle stays byte-identical.
  if (hmr) cfg.hmr = true;
  return `
<script type="application/json" id="__sprig_config">${JSON.stringify(cfg).replace(/</g, "\\u003c")}</script>
<script type="module" src="${client}"></script>`;
}
function documentTail(base: string, version: string, reserved: string[], page?: string, perf: PerfConfig | null = null, hmr = false): string {
  return `${tailScripts(base, version, reserved, page, perf, hmr)}
</body>
</html>`;
}
function document(body: string, base: string, version: string, reserved: string[], page?: string, perf: PerfConfig | null = null, hmr = false, title?: string, favicon?: string, appHead = ""): string {
  return documentHead(base, version, perf, title, favicon, appHead) + body + documentTail(base, version, reserved, page, perf, hmr);
}

export { join };
