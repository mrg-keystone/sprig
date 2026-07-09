// Per-run workbench materialization, shared by `isolate dev` and `isolate test`.
// SPRIG_WB_ROOT keys a private copy of the install's `app/` template so no two
// projects/branches — or two PARALLEL AGENTS in one project — ever share
// `app/src/_preview` or the build output. (`isolate test` historically ignored
// this and always regenerated the shared install workbench: concurrent test
// runs deleted each other's just-generated previews mid-navigation.)
import { join, resolve, toFileUrl } from "#std/path";
import { copy, ensureDir, exists } from "#std/fs";

const REPO = new URL("../../", import.meta.url);
const REPO_DIR = REPO.pathname;

/** Read a JSON file, or {} if missing/unparseable. */
async function readJson(p: string): Promise<{ imports?: Record<string, string>; [k: string]: unknown }> {
  try {
    return JSON.parse(await Deno.readTextFile(p));
  } catch {
    return {};
  }
}

/** Write the workbench app's deno.json so the client build resolves the PROJECT's `$.*` aliases
 *  (islands import `$.services/…`) — forcedImportMap walks up from `<wbApp>/src` and reads this.
 *  The app was copied OUT of the install tree, so the template's relative `@mrg-keystone/sprig/*` are re-pinned
 *  to the install by absolute URL. Rewritten every run (the project — hence `$` — can change). */
export async function writeWorkbenchConfig(wbApp: string, projectDir: string): Promise<void> {
  const tmpl = await readJson(join(REPO_DIR, "app", "deno.json"));
  const proj = await readJson(join(projectDir, "deno.json"));
  const imports: Record<string, string> = { ...(tmpl.imports ?? {}) };
  for (const [k, v] of Object.entries(proj.imports ?? {})) {
    if (k === "@mrg-keystone/sprig" || k === "@mrg-keystone/sprig/keep") continue; // the install owns the one runtime
    if (typeof v === "string" && /^\.\.?\//.test(v)) {
      let abs = toFileUrl(resolve(projectDir, v)).href;
      if (v.endsWith("/") && !abs.endsWith("/")) abs += "/"; // preserve a prefix mapping's trailing slash
      imports[k] = abs;
    } else {
      imports[k] = v;
    }
  }
  imports["@mrg-keystone/sprig"] = toFileUrl(join(REPO_DIR, "framework", ".sprig", "core.ts")).href;
  imports["@mrg-keystone/sprig/keep"] = toFileUrl(join(REPO_DIR, "packages", "keep", "mod.ts")).href;
  await Deno.writeTextFile(join(wbApp, "deno.json"), JSON.stringify({ ...tmpl, imports }, null, 2));
}

/** Materialize (or reuse) the per-key workbench app by copying the install's `app/` template into
 *  `<wbRoot>/app`. Copy is cached by the install version (a stamp file) so switching back to a repo
 *  is instant; the generated `_preview`/`css-variables.json` scratch is dropped so nothing stale
 *  from the copy source leaks in (generatePreviews rewrites `_preview` fresh right after). */
export async function materializeWorkbench(wbRoot: string, projectDir: string): Promise<string> {
  const wbApp = join(wbRoot, "app");
  if (wbRoot !== REPO_DIR && wbRoot !== REPO_DIR.replace(/\/$/, "")) {
    const version = String((await readJson(join(REPO_DIR, "deno.json"))).version ?? "0");
    const stamp = join(wbApp, ".template-version");
    const fresh = (await exists(join(wbApp, "src", "main.ts"))) &&
      (await Deno.readTextFile(stamp).catch(() => "")) === version;
    if (!fresh) {
      await Deno.remove(wbApp, { recursive: true }).catch(() => {});
      await ensureDir(wbRoot);
      await copy(join(REPO_DIR, "app"), wbApp, { overwrite: true });
      for (const scratch of [["src", "_preview"], ["src", "pages", "_preview"], ["src", "css-variables.json"], ["static"]]) {
        await Deno.remove(join(wbApp, ...scratch), { recursive: true }).catch(() => {});
      }
      await Deno.writeTextFile(stamp, version);
    }
  }
  await writeWorkbenchConfig(wbApp, projectDir);
  return wbApp;
}
