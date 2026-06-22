// Public compiler API: scan a `src` tree for folder-components, then render a
// matched page into the shell's <router-outlet> as a full HTML document. The
// SSR body that bootstrap() used to fake with a JSON dump is now real markup.
import { basename, dirname, join, relative } from "@std/path";
import { walk } from "@std/fs/walk";
import { type ComponentDef, type Registry, renderNodes, resolveIslands } from "./render.ts";
import type { Node } from "./node.ts";
import { hasParseError, parseCached, parseTemplate } from "./parse.ts";
import { named } from "./parse.ts";
import { serialize, type SerializedTemplate } from "./serialize.ts";
import type { Scope } from "./expr.ts";
import { makeServerCtx, withServerInjector } from "./island.ts";
import { manifestPath } from "./build.ts";
import { componentScopeId } from "./scope.ts";
import type { ComponentDef as CoreComponentDef } from "@sprig/core";

export interface SsrRenderer {
  /** Render `pageLoad`'s component into the shell, return a full HTML document. */
  renderDocument(pageLoad: string, inputs: Scope): Promise<string>;
  /** Selectors discovered (for diagnostics/tests). */
  selectors(): string[];
  /** the scanned src root (for the dev server's watcher). */
  srcDir: string;
  /** DEV: re-read + re-parse one component's template.html so SSR stays fresh. */
  reparse(selector: string): Promise<boolean>;
  /** DEV: the current serialized AST for a selector (served to island chunks + HMR). */
  astFor(selector: string): SerializedTemplate | null;
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
  for await (const entry of walk(srcDir, { includeDirs: false, match: [/template\.html$/] })) {
    const dir = dirname(entry.path);
    const relDir = relative(srcDir, dir).replace(/\\/g, "/");
    const selector = basename(dir);
    await assertStaticPage(dir); // a pages/<name>/ folder cannot be an island
    const source = await Deno.readTextFile(entry.path);
    let island: ComponentDef["island"];
    const logicPath = join(dir, "logic.ts");
    if (await exists(logicPath)) {
      const mod = await import(`file://${logicPath}`) as { default: unknown };
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
          // the async pre-pass path: construct (DI available in the constructor), then
          // AWAIT onServerInit so a fetch resolves before render.
          resolve: (inputs) => {
            const inst = withServerInjector(() => new Cls(makeServerCtx(inputs))) as Record<string, unknown>;
            return Promise.resolve((inst as { onServerInit?: () => unknown }).onServerInit?.()).then(() => inst as Scope);
          },
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
    const template = await parseCached(source); // pre-parse → sync render
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

  // the build's manifest carries the client.js content hash for ?v= cache-busting.
  // In dev we re-read it each render so a background rebuild's new hash is picked up.
  // The manifest is a SERVER-ONLY build artifact, written OUTSIDE the public assets
  // dir (static/) so it is never reachable under /_assets and never leaks build
  // internals or pins a stale immutable cache (see build.ts manifestPath()).
  const mfPath = manifestPath(join(Deno.cwd(), "static"));
  const readVersion = async () => {
    try {
      return JSON.parse(await Deno.readTextFile(mfPath)).v ?? "dev";
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

  return {
    srcDir,
    // every registered component's selector (duplicates allowed: same-basename
    // components in different folders now coexist instead of clobbering).
    selectors: () => [...bySelector.values()].flatMap((defs) => defs.map((d) => d.selector)),
    async renderDocument(pageLoad, inputs) {
      if (opts.dev) version = await readVersion();
      const page = global.get(basename(pageLoad));
      const pageReg = registryForPage(page ? basename(pageLoad) : null);
      // a preview page may carry `__mocks` (child-component overrides) in its inputs
      const mocks = (inputs as Record<string, unknown>).__mocks as
        | Record<string, import("./render.ts").MockSpec>
        | undefined;
      // async pre-pass: await class-island onServerInit (in parallel) before the sync
      // render, so a component can fetch on the server and the data is in the HTML.
      const baseOpts = { scope: inputs, registry: pageReg, source: page?.template.text ?? "", scopeAttr: page?.scope, mocks };
      const resolved = new Map<Node, Scope>();
      if (page) await resolveIslands(named(page.template), baseOpts, resolved);
      const pageHtml = page
        ? renderNodes(named(page.template), { ...baseOpts, resolved })
        : "";
      const shell = global.get(shellSelector);
      const body = shell
        ? renderNodes(named(shell.template), { scope: {}, registry, outlet: pageHtml, source: shell.template.text, scopeAttr: shell.scope })
        : pageHtml;
      return document(body, base, version);
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
      const tpl = await parseTemplate(source, { allowError: true });
      if (hasParseError(tpl)) return false;
      cur.template = tpl; // defs are shared by reference across all registries
      lastSource.set(selector, source);
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

/** Enforce the convention: a folder directly under `pages/` is a PAGE, and pages
 *  must be STATIC — they cannot be islands. (Page-local components under
 *  `pages/<page>/components/` may still be islands.) Throws on `pages/<page>/logic.ts`. */
export async function assertStaticPage(templateDir: string): Promise<void> {
  if (basename(dirname(templateDir)) !== "pages") return; // not a page
  if (!(await exists(join(templateDir, "logic.ts")))) return; // static → fine
  const name = basename(templateDir);
  throw new Error(
    `sprig: page "${name}" cannot be an island — pages must be static, but found ` +
      `${join(templateDir, "logic.ts")}.\n` +
      `Move the interactive part into a shared-component, or a page-local component ` +
      `(pages/${name}/components/<name>/), and place it in the page's template.`,
  );
}

function document(body: string, base: string, version: string): string {
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
${body}
<script type="application/json" id="__sprig_config">${JSON.stringify({ base, v: version }).replace(/</g, "\\u003c")}</script>
<script type="module" src="${client}"></script>
</body>
</html>`;
}

export { join };
