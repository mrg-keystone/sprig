#!/usr/bin/env -S deno run -A
// `sprig build` (M7 — per-island code-split). For each island (a folder with
// template.html + logic.ts) it serializes the template → JSON AST and generates a
// tiny entry `isl.<sel>.ts` that imports just that island's logic + AST and calls
// registerIsland(). It also generates the eager loader `client.ts`. All entries are
// bundled in ONE `deno bundle --code-splitting` pass, so esbuild dedups the shared
// runtime (@mrg-keystone/sprig + interpreter + hydrate) into a single content-hashed chunk
// referenced by every entry — never duplicated. Output:
//   <out>/client.js          the eager loader (scans DOM, lazy-loads islands by trigger)
//   <out>/isl.<sel>.js       one tiny chunk per island (dynamic-imported on its trigger)
//   <out>/chunk-<hash>.js    the shared runtime, loaded once
// The ?v= cache-bust is the content hash of <out>/ recomputed by the SSR on demand
// (mod.ts readVersion) — no manifest file is written; the build is self-contained in <out>.
import { basename, dirname, fromFileUrl, join, relative, resolve as resolvePath, toFileUrl } from "@std/path";
import { walk } from "@std/fs/walk";
import { parseTemplate } from "./parse.ts";
import { serialize } from "./serialize.ts";
import { componentScopeId, scopeCss } from "./scope.ts";
import { assertStaticPage, pageLocalOf, splitShellHtml } from "./mod.ts";
import { shortHash } from "./hash.ts";

export interface BuildResult {
  islands: string[];
  chunks: string[];
  out: string;
  bytes: number;
  hash: string;
}

/** The app's identity name — the workspace ROOT deno.json's `name`, org-scope stripped
 *  ("@app/alfred" → "alfred"). Walks up from `startDir`, preferring the deno.json that owns the
 *  workspace (has a `workspace` array) over a nearer member's name; falls back to the nearest
 *  named deno.json; undefined if none is named. One source of truth for `bootstrapServer(name)`
 *  and the guard's grant key, instead of a literal repeated in both. */
export async function appName(startDir: string): Promise<string | undefined> {
  const strip = (n: string) => n.replace(/^@[^/]+\//, "");
  let dir = resolvePath(startDir);
  let nearest: string | undefined;
  while (true) {
    try {
      const cfg = JSON.parse(await Deno.readTextFile(join(dir, "deno.json"))) as { name?: unknown; workspace?: unknown };
      if (typeof cfg.name === "string" && cfg.name) {
        nearest ??= cfg.name;
        if (Array.isArray(cfg.workspace)) return strip(cfg.name); // the workspace root owns the identity
      }
    } catch { /* no deno.json here — keep walking up */ }
    const up = dirname(dir);
    if (up === dir) return nearest ? strip(nearest) : undefined;
    dir = up;
  }
}

/** Is this logic.ts a route's SERVER-ONLY logic — onServerLoad with NO browser hook? Such a route
 *  runs at SSR for its data but never hydrates, so the build ships no client island entry for it
 *  (matching the renderer, which decides the same from the real class prototype). Comments are
 *  STRIPPED first: a logic.ts that merely mentions onBrowserLoad in prose ("no onBrowserLoad →
 *  server-only") must not be misread as hydrating — the hook names are matched in code only. */
export function isServerOnlyRouteLogic(source: string): boolean {
  const code = source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/[^\n]*/g, "");
  return /\bonServerLoad\b/.test(code) && !/\bonBrowserLoad\b/.test(code) && !/\bonBrowserInit\b/.test(code);
}

export async function buildClient(srcDir: string, outDir: string): Promise<BuildResult> {
  // ONE build — there is NO dev/prod variant. `sprig dev` serves the BYTE-IDENTICAL bundle
  // this produces for prod, so what you exercise in dev is exactly what ships. HMR is not a
  // build mode: the loader ALWAYS compiles the HMR client (dormant) and starts it only when
  // the SSR sets cfg.hmr (a runtime DATA flag the dev server emits — see mod.ts), and island
  // chunks ALWAYS bake their AST (the dev server keeps them fresh out-of-band via the dormant
  // receiver in hydrate.ts registerIsland, which refetches the live AST only while HMR is on).
  // module-relative URLs (not filesystem paths) so the generated chunks can `import`
  // hydrate/hmr whether this module is local (file://) or published on JSR (https://) —
  // esbuild resolves either; fromFileUrl(import.meta.url) would throw on an https URL.
  const hydratePath = new URL("./hydrate.ts", import.meta.url).href;
  const hmrPath = new URL("./hmr.ts", import.meta.url).href;
  const genDir = join(outDir, ".gen");

  // 1. discover islands + serialize their templates. Islands register/hydrate by
  //    SELECTOR (the client matches <sprig-island data-sel="…">), so two islands
  //    that share a basename cannot both be wired up — that collapsed silently to a
  //    single isl.<sel>.ts before. Detect it and fail loudly (like assertStaticPage).
  const islands: Array<{ sel: string; logic: string; tpl: string; scope: string }> = [];
  // Static (non-island) components shipped to the client so an island's in-browser
  // re-render can compose them. Collected by relDir (a component's unique identity) and
  // classified — by the SAME pageLocalOf rule the server uses (mod.ts) — into GLOBAL
  // (shared/shell/page) statics keyed by selector and PAGE-LOCAL statics keyed by
  // (page → selector). This mirrors registryForPage so a global + a same-basename
  // page-local no longer silently last-write-wins by bare selector on the client.
  // (page roots are excluded — a page isn't embedded as a child of an island).
  type Static = { sel: string; tpl: string; scope: string };
  const globalStatics = new Map<string, Static>(); // selector → def
  const pageStatics = new Map<string, Map<string, Static>>(); // page → (selector → def)
  const globalStaticDir = new Map<string, string>(); // selector → relDir of the first global static (collision diagnostics)
  // every component's serialized template, keyed by relDir — emitted to templates.json
  // so the SSR renders prebuilt ASTs and never runs tree-sitter at runtime.
  const templates: Record<string, unknown> = {};
  const seen = new Map<string, string>(); // selector → relDir of the first island
  for await (const entry of walk(srcDir, { includeDirs: false, match: [/template\.html$/] })) {
    const dir = dirname(entry.path);
    await assertStaticPage(dir); // a pages/<name>/ folder cannot be an island
    const sel = basename(dir);
    const relDir = relative(srcDir, dir).replace(/\\/g, "/");
    // parse + serialize ONCE (the only place tree-sitter runs); record for the SSR registry.
    const ast = serialize(await parseTemplate(await Deno.readTextFile(entry.path)));
    templates[relDir] = ast;
    const tpl = JSON.stringify(ast);
    const logic = join(dir, "logic.ts");
    if (!(await fileExists(logic))) {
      // not an island → a static component. Ship its template to the client registry
      // UNLESS it's a routed page root (a page isn't embedded as a child of an island).
      if (!isPageRoot(relDir)) {
        const def: Static = { sel, tpl, scope: componentScopeId(relDir) };
        const local = pageLocalOf(relDir);
        if (local) {
          // page-local (pages/<page>/components/<name>/): shadow a same-basename global
          // WITHIN this page only. Keyed by (page → selector), so two pages' same-basename
          // page-locals coexist (no clobber). A duplicate within ONE page is unshippable.
          let m = pageStatics.get(local.page);
          if (!m) pageStatics.set(local.page, (m = new Map()));
          if (m.has(sel)) {
            throw new Error(
              `sprig build: duplicate static selector "${sel}" within page "${local.page}". ` +
                `Two distinct page-local component folders share the basename "${sel}". Rename one.`,
            );
          }
          m.set(sel, def);
        } else {
          // global (shared/shell/page) static — globally unique by basename. Two distinct
          // global folders sharing a basename cannot both be shipped under one selector key
          // (the old silent last-write-wins) → fail loud, like the duplicate-island error.
          const prev = globalStaticDir.get(sel);
          if (prev) {
            throw new Error(
              `sprig build: duplicate static selector "${sel}" — both "${prev}" and "${relDir}" ` +
                `are global static components sharing the basename "${sel}". The client registry ` +
                `keys globals by selector, so they cannot share a name. Rename one folder, or make ` +
                `one a page-local component (pages/<page>/components/${sel}/) to shadow it per page.`,
            );
          }
          globalStaticDir.set(sel, relDir);
          globalStatics.set(sel, def);
        }
      }
      continue;
    }
    // A route's SERVER-ONLY logic (onServerLoad, no browser hook) runs at SSR for its data but never
    // hydrates — ship NO client entry (its template is already registered above). A browser hook
    // (onBrowserLoad) makes it a normal client island.
    if (isServerOnlyRouteLogic(await Deno.readTextFile(logic))) continue;
    const prev = seen.get(sel);
    if (prev) {
      throw new Error(
        `sprig build: duplicate island selector "${sel}" — both "${prev}" and "${relDir}" ` +
          `are islands sharing the basename "${sel}". Islands register/hydrate by selector, ` +
          `so they cannot share a name. Rename one folder.`,
      );
    }
    seen.set(sel, relDir);
    islands.push({ sel, logic, tpl, scope: componentScopeId(relDir) });
  }

  // 2. generate entries (the loader + one per island). The loader ALWAYS imports the HMR
  //    client and starts it only when cfg.hmr is set (the dev server's out-of-band activation
  //    flag) — so the SSE client is compiled into every build but dormant in prod. Island
  //    chunks ALWAYS bake their AST; the dormant receiver refreshes it in dev (see hydrate.ts).
  await Deno.mkdir(genDir, { recursive: true });
  await Deno.writeTextFile(
    join(genDir, "client.ts"),
    [
      `// GENERATED by sprig build — the eager loader.`,
      `import { bootstrapIslands, registerComponent, registerPageComponent, setupSoftNav, type SprigConfig } from ${q(hydratePath)};`,
      `import { startHmr } from ${q(hmrPath)};`,
      `const cfg = JSON.parse(document.getElementById("__sprig_config")?.textContent ?? "{}") as SprigConfig;`,
      // dormant in prod: startHmr (and enableHmr inside it) run ONLY when the dev server
      // activated HMR by emitting cfg.hmr. Must precede bootstrapIslands so islands register
      // as live instances (enableHmr flips the flag registerIsland/hydrateIsland read).
      `if (cfg.hmr) startHmr(cfg.base);`,
      // register GLOBAL static component templates (keyed by selector) so islands compose them
      ...[...globalStatics.values()].map((s) =>
        `registerComponent(${JSON.stringify(s.sel)}, { template: ${s.tpl}, scope: ${JSON.stringify(s.scope)} });`
      ),
      // register PAGE-LOCAL static templates (keyed by page → selector) — these shadow a
      // same-basename global WITHIN their page, mirroring the server's registryForPage.
      ...[...pageStatics.entries()].flatMap(([page, m]) =>
        [...m.values()].map((s) =>
          `registerPageComponent(${JSON.stringify(page)}, ${JSON.stringify(s.sel)}, { template: ${s.tpl}, scope: ${JSON.stringify(s.scope)} });`
        )
      ),
      `const run = () => { bootstrapIslands(cfg); setupSoftNav(cfg); };`,
      `if (document.readyState === "loading") addEventListener("DOMContentLoaded", run); else run();`,
      ``,
    ].join("\n"),
  );
  for (const isl of islands) {
    // ALWAYS bake the AST (prod shape). registerIsland refreshes it from the dev server only
    // while HMR is active (the dormant receiver in hydrate.ts) — so this chunk is byte-identical
    // in dev and prod, and a dev hard reload still hydrates the freshly-parsed template.
    const lines = [
      `// GENERATED by sprig build — the ${isl.sel} island chunk.`,
      `import { registerIsland, makeClassSetup } from ${q(hydratePath)};`,
      `import logic from ${q(isl.logic)};`,
      // a class default-export has no .setup → adapt it; { setup } objects use .setup
      `const __setup = logic.setup ?? makeClassSetup(logic);`,
      `registerIsland(${JSON.stringify(isl.sel)}, { setup: __setup, template: ${isl.tpl}, scope: ${JSON.stringify(isl.scope)} });`,
      ``,
    ];
    await Deno.writeTextFile(join(genDir, `isl.${isl.sel}.ts`), lines.join("\n"));
  }

  // 3. clean stale JS, then bundle ALL entries with code-splitting
  await Deno.mkdir(outDir, { recursive: true });
  for await (const e of Deno.readDir(outDir)) {
    if (e.isFile && (e.name.endsWith(".js") || e.name.endsWith(".js.map"))) {
      await Deno.remove(join(outDir, e.name));
    }
  }
  // Tailwind (styles.css → scoped → app.css) is disjoint from the JS bundle (different inputs on
  // disk, different output files). Start it NOW so it runs concurrently with `deno bundle` instead
  // of strictly after it — awaited below before the content-hash (which stats app.css). NB: only
  // ONE build() runs this per process, so its shared Tailwind scratch dir isn't contended here.
  const cssDone = buildCss(srcDir, outDir);
  cssDone.catch(() => {}); // real failure still surfaces at `await cssDone`; suppress pre-await window
  const entries = [join(genDir, "client.ts"), ...islands.map((i) => join(genDir, `isl.${i.sel}.ts`))];
  // Run the bundle under a map that forces @mrg-keystone/sprig to the CLI's ONE runtime (see
  // forcedImportMap): this is what makes single-core structural rather than merely gated. The
  // map lives in genDir, which is removed right after the bundle.
  const mapPath = join(genDir, "import-map.json");
  await Deno.writeTextFile(mapPath, JSON.stringify(await forcedImportMap(srcDir)));
  const res = await new Deno.Command("deno", {
    args: ["bundle", "--platform", "browser", "--minify", "--code-splitting", "--import-map", mapPath, "--outdir", outDir, ...entries],
    stdout: "piped",
    stderr: "piped",
  }).output();
  if (!res.success) {
    throw new Error("client bundle failed:\n" + new TextDecoder().decode(res.stderr));
  }
  await Deno.remove(genDir, { recursive: true }).catch(() => {});

  // 3b. GATE: the bundle MUST carry exactly one copy of the runtime. Code-splitting dedups
  // @mrg-keystone/sprig into a single shared chunk ONLY when every entry resolves it to the SAME
  // module; a version/pin drift (the CLI's runtime vs the app's @mrg-keystone/sprig) yields TWO runtime
  // chunks — a "dual-core" bundle whose islands all die at hydration with `inject() must be
  // called synchronously` (the module-global DI context can't cross two copies). That failure is
  // silent at build + typecheck and only shows in the browser after deploy, so catch it HERE,
  // loudly, at the moment it's created — never ship it.
  await assertSingleRuntime(outDir);

  // 4. per-component styles.css → scoped (view encapsulation) → Tailwind → app.css
  //    (kicked off concurrently with the bundle above; just join it here).
  await cssDone;

  // 4b. the SSR registry: every component's serialized template, keyed by relDir, so the
  //     server renders prebuilt ASTs and never loads the wasm parser at runtime.
  // The bootstrap shell (sibling of srcDir) is serialized under the shell key so PROD renders
  // it prebuilt — no runtime tree-sitter — exactly like the old src/shell component was.
  const shellTpl = join(srcDir, "..", "bootstrap", "template.html");
  if (await fileExists(shellTpl)) {
    // serialize only the shell's <body> — the <head> is lifted out raw at render time (the parser
    // is a fragment grammar and would reject a full <!DOCTYPE>/<html>/<head> document).
    const { body } = splitShellHtml(await Deno.readTextFile(shellTpl));
    templates["shell"] = serialize(await parseTemplate(body));
  }
  await Deno.writeTextFile(join(outDir, "templates.json"), JSON.stringify(templates));

  // 4b. copy the UI package's own static assets — assets/** (fonts, images, favicon: anything the app
  // serves verbatim) — into the served outDir, so they answer at <base>/_assets/** next to the bundle.
  // No transform: a font at assets/fonts/x.woff2 serves at <base>/_assets/fonts/x.woff2. This is the
  // framework's place for app-owned static files (the bundle output is generated; assets/ is authored).
  const assetsDir = join(srcDir, "..", "assets");
  if (await fileExists(assetsDir)) {
    for await (const e of walk(assetsDir, { includeDirs: false })) {
      const dest = join(outDir, relative(assetsDir, e.path));
      await Deno.mkdir(dirname(dest), { recursive: true });
      await Deno.copyFile(e.path, dest);
    }
  }

  // 5. collect outputs (.js + app.css) + hash them for the ?v= cache-bust
  const files: string[] = [];
  let total = 0;
  for await (const e of Deno.readDir(outDir)) {
    if (e.isFile && (e.name.endsWith(".js") || e.name === "app.css")) {
      files.push(e.name);
      total += (await Deno.stat(join(outDir, e.name))).size;
    }
  }
  const chunks = files.filter((f) => f.startsWith("chunk-")).sort();
  // The cache-bust version is the static dir's content hash — the SSR recomputes it on
  // demand (mod.ts readVersion), so the build leaves NO manifest file beside static/;
  // everything the build produces lives inside the one output folder.
  const hash = await shortHash(files.slice().sort().map((f) => join(outDir, f)));
  return { islands: islands.map((i) => i.sel), chunks, out: join(outDir, "client.js"), bytes: total, hash };
}

/** Collect each component's styles.css, scope it for view encapsulation, then run
 *  Tailwind (expands @apply + emits utilities scanned from the templates) → app.css. */
export async function buildCss(srcDir: string, outDir: string): Promise<void> {
  const parts: string[] = [];
  for await (const entry of walk(srcDir, { includeDirs: false, match: [/styles\.css$/] })) {
    const dir = dirname(entry.path);
    const relDir = relative(srcDir, dir).replace(/\\/g, "/");
    const css = await Deno.readTextFile(entry.path);
    // scope by the component's UNIQUE path (matches mod.ts's componentScopeId) so two
    // same-basename folders never share a scope attr → no cross-folder CSS leak.
    parts.push(`/* ${relDir} (scoped) */\n${scopeCss(css, componentScopeId(relDir))}`);
  }
  // The app shell in the sibling bootstrap/ entry folder contributes its global stylesheet
  // too (scoped under the shell selector to match the shell template's scope attr — its rules
  // are document-global :global(...), so the scoping is a no-op, but the id stays consistent).
  const shellCss = join(srcDir, "..", "bootstrap", "styles.css");
  if (await fileExists(shellCss)) {
    parts.push(`/* bootstrap shell (scoped) */\n${scopeCss(await Deno.readTextFile(shellCss), componentScopeId("shell"))}`);
  }
  // Run the Tailwind CLI from a persistent cache dir OUTSIDE the repo: it needs its
  // own deno.json (nodeModulesDir:auto) to resolve `@import "tailwindcss"`, but a
  // deno.json inside the workspace trips Deno's "config must be a workspace member"
  // check. Outside the repo, node_modules persists across builds (fast after first).
  const home = Deno.env.get("HOME") || Deno.env.get("TMPDIR") || "/tmp";
  const twDir = join(home, ".cache", "sprig-tailwind");
  await Deno.mkdir(twDir, { recursive: true });
  // Per-build input file, keyed by outDir, so a CONCURRENT app build + workbench build don't clobber
  // each other's input.css in this SHARED cache dir — node_modules stays shared (the speed win).
  const twKey = ([...outDir].reduce((h, c) => (Math.imul(h, 31) + c.charCodeAt(0)) | 0, 0) >>> 0).toString(36);
  const inputPath = join(twDir, `input-${twKey}.css`);
  // deno.json is identical every build (fixed tailwind/daisyui pins) — write it ONLY when missing/
  // stale, so two concurrent builds don't race on it (a torn read would break Tailwind's npm resolve).
  const denoJson = JSON.stringify({
    nodeModulesDir: "auto",
    // daisyUI is pinned HERE (sprig's cache), never the app's deno.json — so the CLI compiles
    // the daisyUI version SPRIG owns, regardless of what the app declares (declares = types only).
    imports: { "@tailwindcss/cli": "npm:@tailwindcss/cli@^4", "tailwindcss": "npm:tailwindcss@^4", "daisyui": "npm:daisyui@^5" },
  });
  if ((await Deno.readTextFile(join(twDir, "deno.json")).catch(() => "")) !== denoJson) {
    await Deno.writeTextFile(join(twDir, "deno.json"), denoJson);
  }
  // Design tokens: a src/css-variables.json (if present) compiles to a global @theme
  // (utility-generating tokens) + :root (the rest) + [data-theme] variant blocks,
  // spliced in BEFORE the component parts so it bypasses scopeCss and stays document-
  // global. Opt-in: no file → byte-identical to the previous build.
  const tokenCss = await cssFromVariables(srcDir);
  // Also let Tailwind scan the sibling bootstrap/ shell (it's outside srcDir) so utility
  // classes used in the app-shell template emit into app.css.
  const bootstrapDir = join(srcDir, "..", "bootstrap");
  const shellSource = (await fileExists(join(bootstrapDir, "template.html")))
    ? `@source "${bootstrapDir}/**/*.html";\n`
    : "";
  // daisyUI as a Tailwind plugin. themes:false is CRITICAL — daisyUI ships light/dark themes that
  // set --color-* on :root, and since sprig apps define those SAME names in css-variables.json,
  // daisyUI's defaults would otherwise override the app's brand theme (e.g. flip a dark app white).
  // With no daisyUI themes, its components read the app's tokens and inherit the app's brand.
  // The ONLY bespoke global CSS an app gets is CLI-injected here (apps declare tokens, not globals):
  // a full-height root so the shell can fill the viewport. Everything else is Tailwind preflight.
  // The framework's BASE LAYER — the only global CSS an app needs beyond its @theme tokens, so no app
  // stylesheet is required. It applies the app's font/color tokens to the document SEMANTICALLY, with
  // fallbacks, so an app that defines them in css-tokens.json (--font-body/-display/-mono, daisyUI's
  // --color-base-*) gets styled document text, headings, a `.tabular` numeric helper, and a
  // reduced-motion guard — while an app that defines none still renders on system defaults. Injected
  // unlayered (after Tailwind's @layer base) so it wins over Preflight.
  const globalReset = `html, body { height: 100%; }
body {
  font-family: var(--font-body, var(--font-sans, ui-sans-serif, system-ui, sans-serif));
  background: var(--color-base-100, Canvas);
  color: var(--color-base-content, CanvasText);
  -webkit-font-smoothing: antialiased;
}
h1, h2, h3, h4, h5, h6 { font-family: var(--font-display, inherit); letter-spacing: -0.01em; }
.tabular { font-family: var(--font-mono, ui-monospace, monospace); font-variant-numeric: tabular-nums; }
@media (prefers-reduced-motion: reduce) {
  *, *::before, *::after { animation-duration: 0.01ms !important; transition-duration: 0.01ms !important; }
}`;
  const input = `@import "tailwindcss";\n@plugin "daisyui" { themes: false; }\n@source "${srcDir}/**/*.html";\n${shellSource}${globalReset}\n` +
    `${tokenCss ? tokenCss + "\n" : ""}${parts.join("\n\n")}\n`;
  await Deno.writeTextFile(inputPath, input);
  const res = await new Deno.Command("deno", {
    args: [
      "run", "-A", "--node-modules-dir=auto",
      "npm:@tailwindcss/cli@^4", "-i", inputPath, "-o", join(outDir, "app.css"), "--minify",
    ],
    cwd: twDir,
    stdout: "piped",
    stderr: "piped",
  }).output();
  if (!res.success) {
    throw new Error("tailwind css build failed:\n" + new TextDecoder().decode(res.stderr));
  }
}

/** Tailwind v4 theme namespaces that generate utilities. A token in one of these,
 *  with a STATIC value, belongs in @theme (so Tailwind emits both the :root var and
 *  the matching utilities, e.g. bg-primary / text-step-2 / rounded-box). */
const TW_THEME_NAMESPACES = [
  "--color-", "--font-", "--text-", "--font-weight-", "--tracking-", "--leading-",
  "--spacing-", "--radius-", "--shadow-", "--inset-shadow-", "--drop-shadow-",
  "--text-shadow-", "--blur-", "--perspective-", "--aspect-", "--ease-", "--animate-",
  "--breakpoint-", "--container-",
];

/** A token routes to @theme iff it sits in a utility-generating namespace AND its value
 *  is static. A value that references another custom property (var(...), e.g. a color-mix
 *  tint) must stay a plain :root var so it re-resolves live when a [data-theme] swaps the
 *  property it depends on — exactly how the alfred shell hand-split its tokens. */
function isUtilityToken(key: string, value: string): boolean {
  return !value.includes("var(") && TW_THEME_NAMESPACES.some((ns) => key.startsWith(ns));
}

export interface CssVariables {
  /** The theme whose values become the document baseline (:root + @theme). Required
   *  when more than one theme is defined; optional (and implied) for a single theme. */
  default?: string;
  /** theme name → { "--token": "value", …, optional "color-scheme": "light"|"dark" }. */
  themes: Record<string, Record<string, string>>;
}

/** Compile a css-variables.json config into global CSS: the default theme becomes a
 *  Tailwind @theme block (utility tokens) + a :root block (everything else), and every
 *  other theme becomes a [data-theme="name"] override block. Pure + exported for tests.
 *
 *  Governance: ONLY custom properties (--*) and the reserved `color-scheme` key are
 *  allowed — anything else throws, so the global token surface can never accrue stray
 *  rules. Resets come from Tailwind Preflight; non-token base styles live in a shell. */
export function emitThemeCss(cfg: CssVariables): string {
  if (!cfg || typeof cfg !== "object" || !cfg.themes || typeof cfg.themes !== "object") {
    throw new Error(`css-variables.json: expected an object shaped { "themes": { … } }`);
  }
  const names = Object.keys(cfg.themes);
  if (names.length === 0) throw new Error(`css-variables.json: "themes" has no entries`);
  const def = cfg.default ?? (names.length === 1 ? names[0] : undefined);
  if (!def) {
    throw new Error(
      `css-variables.json: ${names.length} themes (${names.join(", ")}) but no "default" — ` +
        `set "default" to the theme that should be the document baseline.`,
    );
  }
  if (!cfg.themes[def]) {
    throw new Error(`css-variables.json: "default" is "${def}", but no theme has that name`);
  }
  for (const name of names) {
    const t = cfg.themes[name];
    if (!t || typeof t !== "object") {
      throw new Error(`css-variables.json: theme "${name}" must be an object of token → value`);
    }
    for (const [k, v] of Object.entries(t)) {
      if (typeof v !== "string") {
        throw new Error(`css-variables.json: ${name}["${k}"] must be a string, got ${typeof v}`);
      }
      if (k !== "color-scheme" && !k.startsWith("--")) {
        throw new Error(
          `css-variables.json: "${k}" in theme "${name}" is not allowed — only custom ` +
            `properties (--*) and the reserved "color-scheme" key may appear here.`,
        );
      }
    }
  }

  const decl = (k: string, v: string) => `  ${k}: ${v};`;
  const themeDecls: string[] = [];
  const rootDecls: string[] = [];
  for (const [k, v] of Object.entries(cfg.themes[def])) {
    if (k !== "color-scheme" && isUtilityToken(k, v)) themeDecls.push(decl(k, v));
    else rootDecls.push(decl(k, v));
  }
  let out = "";
  if (themeDecls.length) out += `@theme {\n${themeDecls.join("\n")}\n}\n`;
  if (rootDecls.length) out += `:root {\n${rootDecls.join("\n")}\n}\n`;
  for (const name of names) {
    if (name === def) continue;
    const decls = Object.entries(cfg.themes[name]).map(([k, v]) => decl(k, v));
    out += `[data-theme="${name}"] {\n${decls.join("\n")}\n}\n`;
  }
  return out;
}

/** Read <srcDir>/css-variables.json (opt-in) and compile it to global CSS; "" if absent. */
async function cssFromVariables(srcDir: string): Promise<string> {
  // Prefer bootstrap/css-tokens.json (tokens live with the app shell); fall back to the legacy
  // src/css-variables.json so existing apps build byte-identically. Absent → unchanged build.
  const raw = await Deno.readTextFile(join(srcDir, "..", "bootstrap", "css-tokens.json"))
    .catch(() => Deno.readTextFile(join(srcDir, "css-variables.json")))
    .catch(() => "");
  if (!raw) return "";
  let cfg: CssVariables;
  try {
    cfg = JSON.parse(raw);
  } catch (e) {
    throw new Error(`css-variables.json: invalid JSON — ${e instanceof Error ? e.message : e}`);
  }
  return emitThemeCss(cfg);
}

/** Build the import map the client bundle runs under: the APP's own imports (so island
 *  logic resolves its app specifiers — `$.services/…`, etc.) with the sprig runtime FORCED
 *  to the CLI's own copy. This is the structural fix for the dual-core bundle: without it the
 *  CLI's generated loader/`hydrate.ts` resolve `@mrg-keystone/sprig` through the CLI's version while
 *  the island `logic.ts` resolves it through the app's pin — two `core.ts` ⇒ two runtime
 *  chunks ⇒ every island dies at hydration. Forcing BOTH to the one CLI runtime makes a single
 *  shared runtime chunk guaranteed, regardless of what (if anything) the app pins.
 *
 *  `--import-map` REPLACES the app's deno.json map (it does not merge), so we reconstruct the
 *  app's effective imports here — walking up from `srcDir`, nearest-wins, resolving relative
 *  values to absolute file URLs so the map is location-independent — then overlay the runtime. */
export async function forcedImportMap(srcDir: string): Promise<{ imports: Record<string, string> }> {
  const layers: Array<{ dir: string; imports: Record<string, string> }> = [];
  let dir = resolvePath(srcDir);
  for (;;) {
    for (const name of ["deno.json", "deno.jsonc"]) {
      const p = join(dir, name);
      if (await fileExists(p)) {
        try {
          const cfg = JSON.parse(await Deno.readTextFile(p)) as { imports?: Record<string, string> };
          if (cfg.imports) layers.push({ dir, imports: cfg.imports });
        } catch { /* unreadable/!json config → skip this layer */ }
        break;
      }
    }
    const parent = dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  const imports: Record<string, string> = {};
  // apply ancestors first, the nearest config last, so a member's mapping wins over the root's
  for (const layer of layers.reverse()) {
    for (const [k, v] of Object.entries(layer.imports)) {
      if (!/^\.\.?\//.test(v)) {
        imports[k] = v; // jsr:/npm:/https:/bare — keep as-is
        continue;
      }
      // relative → absolute file URL. A PREFIX mapping (value ends with "/") must keep its
      // trailing slash or deno rejects the whole import map ("prefix mapping must end in /");
      // resolvePath strips it, so restore it.
      let abs = toFileUrl(resolvePath(layer.dir, v)).href;
      if (v.endsWith("/") && !abs.endsWith("/")) abs += "/";
      imports[k] = abs;
    }
  }
  // FORCE the runtime to the CLI's own modules — one core.ts + one signals for every entry.
  // `new URL(..., import.meta.url)` resolves against THIS file whether the CLI runs from a
  // local checkout (file://) or JSR (https://), the same trick the generated entries already use.
  imports["@mrg-keystone/sprig"] = new URL("../core.ts", import.meta.url).href;
  imports["@preact/signals-core"] = "npm:@preact/signals-core@^1.8.0";
  return { imports };
}

/** The once-per-runtime sentinel core.ts writes at module init (`g.__sprig_runtime`).
 *  It is a property access, which esbuild's minifier does NOT rename, so counting the
 *  emitted chunks that contain it counts copies of the sprig runtime in the bundle. */
const RUNTIME_SENTINEL = "__sprig_runtime";

/** Fail the build if the emitted client bundle carries MORE THAN ONE copy of the sprig
 *  runtime (a "dual-core" bundle). Exactly one copy is the invariant the DI + hydration model
 *  depends on; two means the client loader and the island chunks resolved @mrg-keystone/sprig to
 *  different versions and esbuild could not dedup them, so every island would fail to hydrate
 *  in the browser. Exported for direct testing. (Only >1 fails: a count of 0 would mean the
 *  sentinel moved, which is a framework change, not a user's dual-core — don't block builds on
 *  it.) */
export async function assertSingleRuntime(outDir: string): Promise<void> {
  const carriers: string[] = [];
  for await (const e of Deno.readDir(outDir)) {
    if (!e.isFile || !e.name.endsWith(".js")) continue;
    if ((await Deno.readTextFile(join(outDir, e.name))).includes(RUNTIME_SENTINEL)) {
      carriers.push(e.name);
    }
  }
  if (carriers.length > 1) {
    throw new Error(
      `sprig build: DUAL-CORE bundle — the sprig runtime was emitted into ${carriers.length} ` +
        `chunks (${carriers.sort().join(", ")}), but it must be exactly one. Two copies means the ` +
        `island logic resolved @mrg-keystone/sprig to a DIFFERENT copy than the CLI's loader/hydrate, so ` +
        `code-splitting could not dedup them. In the browser every island would fail to hydrate ` +
        `with "inject() must be called synchronously" — the DI context is module-global and cannot ` +
        `cross two runtime copies. Fix: REMOVE @mrg-keystone/sprig (and @mrg-keystone/sprig/) from the app's ` +
        `deno.json — the CLI supplies the one runtime. In a Deno workspace, remove it from the ` +
        `MEMBER that holds the islands (e.g. ui/deno.json): a member's own pin scopes the island ` +
        `logic to a second copy that the CLI's import map cannot override.`,
    );
  }
}

async function fileExists(p: string): Promise<boolean> {
  try {
    await Deno.stat(p);
    return true;
  } catch {
    return false;
  }
}

/** A routed page root (pages/<page>/ or pages/_preview/<id>/) — NOT a page-local
 *  component (pages/<page>/components/<x>/). Page roots aren't embedded as children
 *  of islands, so their templates aren't shipped to the client registry. */
function isPageRoot(relDir: string): boolean {
  const parts = relDir.split("/");
  return parts[0] === "pages" && parts[parts.length - 2] !== "components";
}
function q(s: string): string {
  return JSON.stringify(s);
}

if (import.meta.main) {
  // import.meta.dirname is undefined for a remote module (never throws); this direct-run entry
  // only makes sense from a working tree, so fall back to the file:// path form when present.
  const here = import.meta.dirname ?? dirname(fromFileUrl(import.meta.url));
  const srcDir = join(here, "../../src"); // ui/src
  const outDir = join(Deno.cwd(), "static");
  const r = await buildClient(srcDir, outDir);
  console.log(
    `sprig build: ${r.islands.length} island chunk(s) [${r.islands.join(", ")}] + ` +
      `${r.chunks.length} shared chunk(s) → ${outDir} (${(r.bytes / 1024).toFixed(1)}kb total, v=${r.hash})`,
  );
}
