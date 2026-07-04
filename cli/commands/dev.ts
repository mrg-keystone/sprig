import { Command } from "@cliffy/command";
import { fromFileUrl, join, resolve, toFileUrl } from "#std/path";
import { copy, ensureDir, exists } from "#std/fs";
import { discover } from "../../server/src/core/business/discover/mod.ts";
import { generatePreviews } from "../lib/generate-previews.ts";
import { ensureRunner } from "../lib/runner.ts";
import { onShutdown, openBrowser } from "../lib/process.ts";
import { formatProblems } from "../lib/format.ts";

const REPO = fromFileUrl(new URL("../../", import.meta.url)); // install root (framework + app template live here)

/** The workbench working dir for this run — per repo-branch (`sprig dev` sets SPRIG_WB_ROOT via
 *  spawnWorkbench), so no two projects/branches ever share `app/src/_preview` or the build output.
 *  A bare `isolate dev` (no supervisor) falls back to the legacy shared install dir. */
function workbenchRoot(): string {
  return Deno.env.get("SPRIG_WB_ROOT") ?? REPO;
}

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
 *  The app was copied OUT of the install tree, so the template's relative `@sprig/*` are re-pinned
 *  to the install by absolute URL. Rewritten every run (the project — hence `$` — can change). */
async function writeWorkbenchConfig(wbApp: string, projectDir: string): Promise<void> {
  const tmpl = await readJson(join(REPO, "app", "deno.json"));
  const proj = await readJson(join(projectDir, "deno.json"));
  const imports: Record<string, string> = { ...(tmpl.imports ?? {}) };
  for (const [k, v] of Object.entries(proj.imports ?? {})) {
    if (k === "@sprig/core" || k === "@sprig/keep") continue; // the install owns the one runtime
    if (typeof v === "string" && /^\.\.?\//.test(v)) {
      let abs = toFileUrl(resolve(projectDir, v)).href;
      if (v.endsWith("/") && !abs.endsWith("/")) abs += "/"; // preserve a prefix mapping's trailing slash
      imports[k] = abs;
    } else {
      imports[k] = v;
    }
  }
  imports["@sprig/core"] = toFileUrl(join(REPO, "framework", ".sprig", "core.ts")).href;
  imports["@sprig/keep"] = toFileUrl(join(REPO, "packages", "keep", "mod.ts")).href;
  await Deno.writeTextFile(join(wbApp, "deno.json"), JSON.stringify({ ...tmpl, imports }, null, 2));
}

/** Materialize (or reuse) the per-key workbench app by copying the install's `app/` template into
 *  `<wbRoot>/app`. Copy is cached by the install version (a stamp file) so switching back to a repo
 *  is instant; the generated `_preview`/`css-variables.json` scratch is dropped so nothing stale
 *  from the copy source leaks in (generatePreviews rewrites `_preview` fresh right after). */
async function materializeWorkbench(wbRoot: string, projectDir: string): Promise<string> {
  const wbApp = join(wbRoot, "app");
  if (wbRoot !== REPO) {
    const version = String((await readJson(join(REPO, "deno.json"))).version ?? "0");
    const stamp = join(wbApp, ".template-version");
    const fresh = (await exists(join(wbApp, "src", "main.ts"))) &&
      (await Deno.readTextFile(stamp).catch(() => "")) === version;
    if (!fresh) {
      await Deno.remove(wbApp, { recursive: true }).catch(() => {});
      await ensureDir(wbRoot);
      await copy(join(REPO, "app"), wbApp, { overwrite: true });
      for (const scratch of [["src", "_preview"], ["src", "pages", "_preview"], ["src", "css-variables.json"], ["static"]]) {
        await Deno.remove(join(wbApp, ...scratch), { recursive: true }).catch(() => {});
      }
      await Deno.writeTextFile(stamp, version);
    }
  }
  await writeWorkbenchConfig(wbApp, projectDir);
  return wbApp;
}

export const devCmd = new Command()
  .description("Discover a sprig project's components, generate previews, and serve the workbench.")
  .option("--no-open", "Don't auto-open the browser.")
  .option("-f, --force", "Preview the valid components even if some configs are malformed.")
  .action(async (opts) => {
    const o = opts as unknown as { root: string; open: boolean; force?: boolean };
    const root = resolve(o.root);

    // 1. discover the sprig folder-components + their isolate/ fixtures
    const { entries, problems } = await discover(root);
    if (entries.length === 0) {
      console.log("Nothing to isolate — no folder-component has an isolate/ folder yet.");
      return;
    }
    // "unsupported" notes (e.g. a case using the not-yet-supported _mocks) are
    // advisory — the case still previews. Only real config errors are fatal.
    const fatal = problems.filter((p) => p.kind !== "unsupported");
    const advisory = problems.filter((p) => p.kind === "unsupported");
    if (advisory.length) {
      console.error(`ℹ ${advisory.length} case(s) use features not yet supported (rendered without them):\n\n${formatProblems(advisory, root)}\n`);
    }
    if (fatal.length) {
      console.error(`✗ isolate found ${fatal.length} config problem(s):\n\n${formatProblems(fatal, root)}\n`);
      if (!o.force) {
        console.error("Fix these and re-run, or `isolate dev --force` to preview the valid ones anyway.");
        Deno.exit(1);
      }
      console.error("Continuing anyway (--force).\n");
    }

    await ensureRunner();

    // 2. materialize this repo-branch's OWN workbench dir, then generate one sprig preview per case
    //    into it (no Vite, no copy-a-Fresh-app). Keyed by SPRIG_WB_ROOT so a second project/branch
    //    can never clobber these previews or the build output.
    const wbRoot = workbenchRoot();
    const wbApp = await materializeWorkbench(wbRoot, root);
    const appSrc = join(wbApp, "src");
    const n = await generatePreviews(entries, appSrc, resolve(root, "src"));
    console.log(`Generated ${n} preview page(s) for ${entries.length} component(s).`);

    // 3. build the workbench app (code-split islands + scope CSS + the HMR client) → <wbRoot>/static.
    //    cwd = wbRoot so the build's default outDir lands there; --config pins the install's runtime
    //    deps + node_modules (the copied app lives outside the install workspace).
    const build = await new Deno.Command("deno", {
      args: ["run", "-A", "--config", join(REPO, "deno.json"), resolve(REPO, "framework/cli.ts"), "build", wbApp],
      cwd: wbRoot,
      stdout: "inherit",
      stderr: "inherit",
    }).output();
    if (!build.success) Deno.exit(build.code);

    // 4. serve the single origin: the sprig shell + the generated previews + the in-process
    //    keep backend (discovery for the sidebar + the test runner), wrapped in the compiler's
    //    dev server (serve-dev.ts) so editing a component hot-swaps it in the stage — HMR.
    //    SPRIG_WB_ROOT tells serve-dev.ts which per-key app + static to serve.
    const port = Number(Deno.env.get("PORT") ?? 8000);
    const child = new Deno.Command("deno", {
      args: ["serve", "-A", "--unstable-kv", `--port=${port}`, resolve(REPO, "serve-dev.ts")],
      cwd: REPO,
      env: { ...Deno.env.toObject(), ISOLATE_PROJECT: root, SPRIG_DEV: "1", SPRIG_WB_ROOT: wbRoot },
      stdout: "inherit",
      stderr: "inherit",
      stdin: "inherit",
    }).spawn();

    const cleanup = onShutdown(() => {
      try {
        child.kill("SIGTERM");
      } catch { /* already dead */ }
    });

    const url = `http://localhost:${port}/`;
    console.log(`\n  ◆ isolate ready → ${url}\n     project: ${root}\n`);
    if (o.open) {
      setTimeout(() => openBrowser(url), 1200);
    }

    try {
      await child.status;
    } finally {
      cleanup();
    }
  });
