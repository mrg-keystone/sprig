// Dev composition root for `sprig isolate` — the SAME serveSprig(app + keep backend) as
// serve.ts, but wrapped in the compiler's dev server so component edits hot-swap. `sprig
// isolate` (cli dev) builds the workbench with --dev (which injects the HMR client) and spawns
// this under `deno serve` with SPRIG_DEV=1 + ISOLATE_PROJECT set.
//
// Two watchers cooperate: createDevServer watches the WORKBENCH src (app/src) and pushes HMR
// (template hot-swap / css swap / rebuild+reload); the project watcher below mirrors edits to
// the user's components into app/src/_preview/targets/* — which lands under app/src, so the
// dev server picks it up and hot-swaps. Structural changes (isolate/ cases, new components)
// re-discover + re-generate the previews.
import { serveSprig } from "@sprig/keep";
import { createDevServer } from "./framework/.sprig/compiler/dev.ts";
import { api } from "./server/bootstrap/mod.ts";
import { app, renderer } from "./app/src/main.ts";
import { discover } from "./server/src/core/business/discover/mod.ts";
import { generatePreviews } from "./cli/lib/generate-previews.ts";
import { basename, dirname, fromFileUrl, join, relative } from "@std/path";

const root = dirname(fromFileUrl(import.meta.url)); // the install root (repo or ~/.sprig)
const appSrc = join(root, "app", "src");
const outDir = join(root, "static");

const handler = serveSprig({ keep: api, app, base: "" });
const dev = createDevServer({ renderer, base: "", outDir, handler });

const project = Deno.env.get("ISOLATE_PROJECT");
if (project) watchProject(join(project, "src"), project);

/** Mirror a user-project edit into the workbench previews so the dev server hot-swaps it.
 *  A component file (template/styles/logic) edit is copied straight into its existing
 *  `_preview/targets/<sel>/` — anything else (an isolate/ case, a brand-new component) falls
 *  back to a full re-discover + re-generate. */
async function watchProject(srcDir: string, projectRoot: string): Promise<void> {
  const sanitize = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "");
  const targetsDir = join(appSrc, "_preview", "targets");
  const COMPONENT_FILES = new Set(["template.html", "styles.css", "logic.ts"]);

  const flush = async (batch: string[]): Promise<void> => {
    let structural = false;
    for (const p of batch) {
      const rel = relative(srcDir, p);
      if (rel.split(/[/\\]/).includes("isolate")) { // a case fixture/JSON/spec changed
        structural = true;
        continue;
      }
      const file = basename(p);
      if (!COMPONENT_FILES.has(file)) {
        structural = true; // a non-component file (or dir) changed → re-derive
        continue;
      }
      const dest = join(targetsDir, sanitize(basename(dirname(p))), file);
      try {
        await Deno.stat(dirname(dest)); // an existing preview target → mirror in place
        await Deno.copyFile(p, dest);
      } catch {
        structural = true; // not a known target (new component) → re-generate
      }
    }
    if (structural) {
      try {
        const { entries } = await discover(projectRoot);
        await generatePreviews(entries, appSrc, srcDir);
      } catch (e) {
        console.error("isolate: preview re-generation failed —", e instanceof Error ? e.message : e);
      }
    }
  };

  const pending = new Set<string>();
  let timer: ReturnType<typeof setTimeout> | undefined;
  for await (const ev of Deno.watchFs(srcDir)) {
    if (ev.kind === "access") continue;
    for (const p of ev.paths) pending.add(p);
    clearTimeout(timer);
    timer = setTimeout(() => {
      const batch = [...pending];
      pending.clear();
      flush(batch).catch((e) => console.error("isolate watch:", e));
    }, 80);
  }
}

export default { fetch: (req: Request, info: Deno.ServeHandlerInfo): Promise<Response> | Response => dev.fetch(req, info) };
