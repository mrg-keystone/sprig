// Public compiler API: scan a `src` tree for folder-components, then render a
// matched page into the shell's <router-outlet> as a full HTML document. The
// SSR body that bootstrap() used to fake with a JSON dump is now real markup.
import { basename, dirname, join, relative, toFileUrl } from "@std/path";
import { walk } from "@std/fs/walk";
import { clearStaticCache, type ComponentDef, islandHost, type Registry, renderNodes, resolveIslands } from "./render.ts";
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
import { shortHash } from "./hash.ts";
import { componentScopeId } from "./scope.ts";
import type { ComponentDef as CoreComponentDef, Resolve } from "@sprig/core";

export interface SsrRenderer {
  /** Render `pageLoad`'s component into the shell, return a full HTML document. */
  renderDocument(pageLoad: string, inputs: Scope): Promise<string>;
  /** Same document, STREAMED: the <head> (asset preloads) flushes on the first byte,
   *  the body streams after its onServerInit fetches resolve. Byte-identical to
   *  renderDocument's output, just chunked. */
  renderStream(pageLoad: string, inputs: Scope): ReadableStream<Uint8Array>;
  /** Selectors discovered (for diagnostics/tests). */
  selectors(): string[];
  /** the scanned src root (for the dev server's watcher). */
  srcDir: string;
  /** DEV: re-read + re-parse one component's template.html so SSR stays fresh. */
  reparse(selector: string): Promise<boolean>;
  /** DEV: the current serialized AST for a selector (served to island chunks + HMR). */
  astFor(selector: string): SerializedTemplate | null;
  /** Auto-load a page's data loader by its route `load` path — imports
   *  `<srcRoot>/<load>/resolve.ts` and returns its `resolve` export (undefined if the
   *  page has none). This is what lets `routes` alone drive data loading: no per-page
   *  import + no `modules` map in the app's config. */
  loadResolve(pageLoad: string): Promise<Resolve | undefined>;
}

/** Scan `srcDir` for every folder containing a template.html → selector registry
 *  (selector = folder name). The page referenced by a route's `load` resolves by
 *  its folder basename, the same map used for tag resolution. */
export async function createRenderer(
  srcDir: string,
  base = "/ui",
  opts: { dev?: boolean; shell?: string } = {},
): Promise<SsrRenderer> {
  const shellSelector = opts.shell ?? "shell";
  // A component's IDENTITY is its folder path relative to srcDir (unique), not its
  // bare basename. Two registries: `global` for shared/shell/page components (keyed
  // by basename, must be unique → collision throws), and `pageLocal` for components
  // under pages/<page>/components/<name>/ (keyed by page → basename), which SHADOW a
  // same-named global component within that page only. This kills the old silent
  // last-write-wins Map clobber and gives each folder a distinct scope id.
  const global = new Map<string, ComponentDef>();
  const pageLocal = new Map<string, Map<string, ComponentDef>>(); // page → (selector → def)
  const srcPath = new Map<string, string>(); // relDir id → template.html path (for reparse)
  const lastSource = new Map<string, string>(); // selector → last parsed template source (HMR no-op detection)
  const bySelector = new Map<string, ComponentDef[]>(); // selector → all defs (diagnostics)
  // PROD: the build's serialized template registry (relDir → AST). Render these prebuilt
  // ASTs so the runtime never parses. Absent (no build / fresh dev) → parse live below.
  let prebuilt: Record<string, SerializedTemplate> | null = null;
  try {
    prebuilt = JSON.parse(await Deno.readTextFile(join(Deno.cwd(), "static", "templates.json")));
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
        island = {
          // sync fallback (islands behind control flow / not pre-resolved): runs
          // onServerInit synchronously (an async one isn't awaited on this path).
          scope: (inputs) =>
            withServerInjector(() => {
              const inst = new Cls(makeServerCtx(inputs));
              (inst as { onServerInit?: () => unknown }).onServerInit?.();
              return inst as Scope;
            }),
          // the async pre-pass path: construct + start onServerInit INSIDE the injector
          // (so inject() resolves in the constructor AND in onServerInit's synchronous
          // part, matching the sync path), then AWAIT the result before render. DI across
          // an await still needs async-aware context (documented limitation).
          resolve: (inputs) =>
            withServerInjector(() => {
              const inst = new Cls(makeServerCtx(inputs)) as Record<string, unknown>;
              return Promise.resolve((inst as { onServerInit?: () => unknown }).onServerInit?.()).then(() => inst as Scope);
            }),
          trigger: (Cls as { trigger?: string }).trigger ?? "load",
          snapshot: true, // carry instance state across the wire
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
    lastSource.set(selector, source);
    let defs = bySelector.get(selector);
    if (!defs) bySelector.set(selector, (defs = []));
    defs.push(def);
  }
  // the default (page-less) registry: global only.
  const registry: Registry = { get: (s) => global.get(s) };
  /** a per-page registry: page-local components shadow global ones within the page. */
  const registryForPage = (page: string | null): Registry => {
    const locals = page ? pageLocal.get(page) : undefined;
    return { get: (s) => (locals?.get(s)) ?? global.get(s) };
  };

  // The ?v= asset cache-bust is the content hash of the built static/ dir, computed on
  // demand — so there is NO separate manifest file beside the build. In dev we recompute
  // each render so a background rebuild's new hash is picked up.
  const staticDir = join(Deno.cwd(), "static");
  const readVersion = async () => {
    try {
      const files: string[] = [];
      // hash the SERVED assets only (.js + app.css) — same set the build hashes, so
      // templates.json / source maps don't perturb ?v=.
      for await (const e of Deno.readDir(staticDir)) {
        if (e.isFile && (e.name.endsWith(".js") || e.name === "app.css")) files.push(join(staticDir, e.name));
      }
      return files.length ? await shortHash(files.sort()) : "dev";
    } catch {
      return "dev";
    }
  };
  let version = await readVersion();

  /** find a single def by selector for the selector-based public API (dev watcher /
   *  HMR). Prefers a global component; falls back to a uniquely-named page-local. */
  const findBySelector = (selector: string): ComponentDef | undefined => {
    const defs = bySelector.get(selector);
    return defs && defs.length ? defs[0] : undefined;
  };

  /** Build the <body> content: async pre-pass (await class-island onServerInit in
   *  parallel) → sync render of the page → wrap in the shell. Shared by renderDocument
   *  (returns the whole doc) and renderStream (flushes the head before this resolves). */
  const renderBody = async (pageLoad: string, inputs: Scope): Promise<string> => {
    const page = global.get(basename(pageLoad));
    const pageReg = registryForPage(page ? basename(pageLoad) : null);
    // a preview page may carry `__mocks` (child-component overrides) in its inputs
    const mocks = (inputs as Record<string, unknown>).__mocks as
      | Record<string, import("./render.ts").MockSpec>
      | undefined;
    // The page's OWN logic.ts class IS its data source: run onServerInit and use the
    // instance as the render scope (this is what replaces a separate resolve.ts —
    // template + logic.ts is the whole page). `inputs` (route params) reach it via the
    // class ctx. A page with no logic.ts just renders against inputs directly.
    const pageScope: Scope = page?.island?.resolve ? await page.island.resolve(inputs) : inputs;
    const baseOpts = { scope: pageScope, registry: pageReg, source: page?.template.text ?? "", scopeAttr: page?.scope, mocks };
    // if the page IS a class island, snapshot its post-onServerInit state NOW (before the
    // template's @let locals mutate the scope) so the browser re-seeds it before onBrowserInit.
    const pageSnap = page?.island?.snapshot ? snapshotOf(pageScope as Record<string, unknown>) : undefined;
    const resolved = new Map<Node, Scope>();
    if (page) await resolveIslands(named(page.template), baseOpts, resolved);
    let pageHtml = page ? renderNodes(named(page.template), { ...baseOpts, resolved }) : "";
    // wrap the page-root as a hydration boundary so its own logic.ts hydrates on the client
    // (constructs the class, restores the snapshot, runs onBrowserInit, wires its events).
    if (page?.island) {
      const propsObj: Record<string, unknown> = { ...(inputs as Record<string, unknown>) };
      if (pageSnap) propsObj.__snapshot = pageSnap;
      pageHtml = islandHost(page.scope ?? "", page.selector, page.island.trigger, propsObj, pageHtml);
    }
    const shell = global.get(shellSelector);
    if (!shell) return pageHtml;
    // the SHELL template can also embed islands — pre-resolve their async onServerInit too.
    const shellOpts = { scope: {} as Scope, registry, outlet: pageHtml, source: shell.template.text, scopeAttr: shell.scope };
    const shellResolved = new Map<Node, Scope>();
    await resolveIslands(named(shell.template), shellOpts, shellResolved);
    return renderNodes(named(shell.template), { ...shellOpts, resolved: shellResolved });
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
      let fn: Resolve | undefined;
      try {
        const url = toFileUrl(join(srcDir, rel, "resolve.ts")).href;
        fn = (await import(url)).resolve as Resolve | undefined;
      } catch {
        fn = undefined; // no resolve.ts → a purely static page
      }
      resolveCache.set(rel, fn);
      return fn;
    },
    async renderDocument(pageLoad, inputs) {
      if (opts.dev) version = await readVersion();
      return document(await renderBody(pageLoad, inputs), base, version);
    },
    renderStream(pageLoad, inputs) {
      const enc = new TextEncoder();
      return new ReadableStream<Uint8Array>({
        async start(ctrl) {
          try {
            if (opts.dev) version = await readVersion();
            // snapshot the version so head and tail agree even if a concurrent dev rebuild
            // mutates the module-level `version` during the body await.
            const v = version;
            // flush the head NOW → the browser preloads app.css + client.js while we
            // await the body's onServerInit fetches.
            ctrl.enqueue(enc.encode(documentHead(base, v)));
            const body = await renderBody(pageLoad, inputs);
            ctrl.enqueue(enc.encode(body + documentTail(base, v)));
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
    async reparse(selector) {
      const cur = findBySelector(selector);
      if (!cur) return false;
      const relDir = [...srcPath.keys()].find((rel) => basename(rel) === selector && srcPath.get(rel));
      const path = relDir ? srcPath.get(relDir) : undefined;
      if (!path) return false;
      const source = await Deno.readTextFile(path);
      // No-op save (unchanged bytes) → don't re-parse, mutate the registry, or
      // broadcast a hot swap that needlessly re-renders every mounted island.
      if (lastSource.get(selector) === source) return false;
      // Mid-edit broken template: tree-sitter recovers to an ERROR AST instead of
      // throwing. Don't push that garbage live (it would clobber mounted islands'
      // markup); suppress the swap and keep the last-good template until the next
      // clean save. (parseTemplate with allowError lets us inspect hasError.)
      const p = await parser();
      const tpl = await p.parseTemplate(source, { allowError: true });
      if (p.hasParseError(tpl)) return false;
      cur.template = tpl; // defs are shared by reference across all registries
      lastSource.set(selector, source);
      clearStaticCache(); // a template changed → stale memoized static HTML must go
      return true;
    },
    astFor(selector) {
      const def = findBySelector(selector);
      return def ? serialize(def.template) : null;
    },
  };
}

/** Classify a component by its relative dir: page-local (under
 *  pages/<page>/components/<name>/) or global. */
function pageLocalOf(relDir: string): { page: string; selector: string } | null {
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
function documentHead(base: string, version: string): string {
  const client = `${base}/_assets/client.js?v=${version}`;
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>sprig</title>
  <link rel="stylesheet" href="${base}/_assets/app.css?v=${version}" />
  <link rel="modulepreload" href="${client}" />
</head>
<body>
`;
}
function documentTail(base: string, version: string): string {
  const client = `${base}/_assets/client.js?v=${version}`;
  return `
<script type="application/json" id="__sprig_config">${JSON.stringify({ base, v: version }).replace(/</g, "\\u003c")}</script>
<script type="module" src="${client}"></script>
</body>
</html>`;
}
function document(body: string, base: string, version: string): string {
  return documentHead(base, version) + body + documentTail(base, version);
}

export { join };
