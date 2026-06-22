// Generate sprig preview pages from a discovery manifest — the sprig-native
// replacement for materialize.ts. For each discovered case it generates a static
// preview page that renders the target component DIRECTLY plus the shared
// <stage-bridge> island (the bridge can't host the target as a child on the client,
// so they are siblings). The target component is copied into
// app/src/_preview/targets/<alias>/ with a dash-cased selector (`x-<name>`) so it
// never shadows a native element like <button>. A manifest.gen.ts of
// { routes, modules } is spread into app/src/main.ts. The app then builds (islands
// code-split) and serves under one serveSprig origin — no Vite, no Fresh.
import { basename, dirname, join } from "#std/path";
import { ensureDir, exists, walk } from "#std/fs";
import type { CaseDef, ComponentEntry } from "../../server/src/core/business/discover/mod.ts";

const sanitize = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "");

// framework tags that are never project components
const RESERVED = new Set(["router-outlet", "ng-content", "ng-container", "stage-bridge"]);
const DASH_TAG = /<([a-z][a-z0-9]*(?:-[a-z0-9]+)+)[\s/>]/g;

/** Copy a folder-component (template + styles + logic) into <targetsDir>/<name>. */
async function copyComponent(srcDir: string, name: string, targetsDir: string): Promise<void> {
  const dest = join(targetsDir, name);
  await ensureDir(dest);
  await Deno.copyFile(join(srcDir, "template.html"), join(dest, "template.html"));
  if (await exists(join(srcDir, "styles.css"))) await Deno.copyFile(join(srcDir, "styles.css"), join(dest, "styles.css"));
  if (await exists(join(srcDir, "logic.ts"))) await Deno.copyFile(join(srcDir, "logic.ts"), join(dest, "logic.ts"));
}

/** Find a folder-component by selector (folder basename) anywhere under projectSrc. */
async function findComponentDir(sel: string, projectSrc: string): Promise<string | null> {
  for await (const e of walk(projectSrc, { includeDirs: false, match: [/template\.html$/] })) {
    if (basename(dirname(e.path)) === sel) return dirname(e.path);
  }
  return null;
}

/** Copy every component a target's template references (custom dash-tags), recursively. */
async function copyDeps(compDir: string, projectSrc: string, targetsDir: string, done: Set<string>): Promise<void> {
  const src = await Deno.readTextFile(join(compDir, "template.html"));
  for (const m of src.matchAll(DASH_TAG)) {
    const tag = m[1];
    if (RESERVED.has(tag) || done.has(tag)) continue;
    const depDir = await findComponentDir(tag, projectSrc);
    if (!depDir) continue;
    done.add(tag);
    await copyComponent(depDir, tag, targetsDir);
    await copyDeps(depDir, projectSrc, targetsDir, done); // transitive deps
  }
}

/** The target tag for a case: each static prop is bound to the resolver's caseData
 *  (so a control edit — arriving as a query override the resolver merges — re-renders
 *  the target), plus the innerHtml as `content`. Island signals are applied live by
 *  the bridge, so island targets get no input bindings. */
function targetTag(alias: string, e: ComponentEntry, c: CaseDef): string {
  const attrs: string[] = [];
  if (e.kind !== "island") {
    for (const k of Object.keys(c.props)) attrs.push(`[${k}]="caseData.props.${k}"`);
    if (typeof c.innerHtml === "string") attrs.push(`[content]="caseData.innerHtml"`);
  }
  return `<${alias} ${attrs.join(" ")}></${alias}>`.replace(/\s+>/, ">");
}

export async function generatePreviews(entries: ComponentEntry[], appSrcDir: string, projectSrc: string): Promise<number> {
  const previewPagesDir = join(appSrcDir, "pages", "_preview");
  const targetsDir = join(appSrcDir, "_preview", "targets");
  for (const d of [previewPagesDir, join(appSrcDir, "_preview")]) {
    if (await exists(d)) await Deno.remove(d, { recursive: true });
  }
  await ensureDir(previewPagesDir);
  await ensureDir(targetsDir);

  const routes: { path: string; load: string }[] = [];
  const moduleLines: string[] = [];
  const copiedDeps = new Set<string>(); // dep selectors copied (shared across targets)
  let pages = 0;

  for (const e of entries) {
    const selector = sanitize(e.label); // real selector (the renderer guards native names)

    // copy the target folder-component (template + styles + logic), then copy every
    // component its template references (e.g. the counter's <ui-button>/<count-display>).
    await copyComponent(e.dir, selector, targetsDir);
    await copyDeps(e.dir, projectSrc, targetsDir, copiedDeps);

    const meta = {
      name: e.label,
      selector,
      background: e.background,
      controlDefs: e.controlDefs,
      subControlDefs: e.subControlDefs, // per-child-component control widgets
      subTargets: e.subTargets, // CSS selector per instance group (direct-DOM controls)
    };

    for (const c of e.cases) {
      const pageId = "pv-" + sanitize(e.slug) + "-" + sanitize(c.name);
      const pDir = join(previewPagesDir, pageId);
      await ensureDir(pDir);
      // the target rendered directly + the bridge as a sibling
      await Deno.writeTextFile(
        join(pDir, "template.html"),
        `<div class="iso-stage-page">\n  ${targetTag(selector, e, c)}\n  ` +
          `<stage-bridge [meta]="meta" [caseData]="caseData"></stage-bridge>\n</div>\n`,
      );
      const baseCase = { props: c.props, signals: c.signals ?? {}, innerHtml: c.innerHtml ?? null, mocks: c.mocks ?? {} };
      routes.push({ path: c.route.replace(/^\//, ""), load: `./pages/_preview/${pageId}` });
      moduleLines.push(
        `  ${JSON.stringify("./pages/_preview/" + pageId)}: { resolve: (ctx) => previewResolve(${JSON.stringify(meta)}, ${JSON.stringify(baseCase)}, ctx) },`,
      );
      pages++;
    }
  }

  const manifest = [
    `// GENERATED by isolate — sprig preview routes + resolvers. Do not edit.`,
    `import type { Route, ResolveCtx } from "@sprig/core";`,
    `import { previewResolve } from "../../lib/preview-resolve.ts";`,
    ``,
    `export const routes: Route[] = ${JSON.stringify(routes, null, 0)};`,
    ``,
    `// deno-lint-ignore-file no-explicit-any`,
    `export const modules: Record<string, { resolve: (ctx: ResolveCtx) => any }> = {`,
    ...moduleLines,
    `};`,
    ``,
  ].join("\n");
  await Deno.writeTextFile(join(previewPagesDir, "manifest.gen.ts"), manifest);
  return pages;
}
