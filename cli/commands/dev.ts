import { Command } from "@cliffy/command";
import { fromFileUrl, join, resolve } from "#std/path";
import { discover } from "../../server/src/core/business/discover/mod.ts";
import { buildClient } from "../../framework/.sprig/compiler/build.ts";
import { generatePreviews } from "../lib/generate-previews.ts";
import { materializeWorkbench } from "../lib/workbench.ts";
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

    // 3. build the workbench app IN-PROCESS (code-split islands + scope CSS + the HMR client) →
    //    <wbRoot>/static. Previously this shelled out `deno run framework/cli.ts build`, which
    //    cold-loads the ENTIRE cli graph (compiler + keep + the 561KB vendored apexcharts) it never
    //    needs — ~230ms warm, seconds cold. buildClient is the whole non-rune build; it derives its
    //    own forcedImportMap from <wbApp>/src, so no --config subprocess is needed.
    const built = await buildClient(join(wbApp, "src"), join(wbRoot, "static"));
    console.log(
      `sprig build: ${built.islands.length} island chunk(s) [${built.islands.join(", ")}] + ` +
        `${built.chunks.length} shared chunk(s) → ${join(wbRoot, "static")} (${(built.bytes / 1024).toFixed(1)}kb, v=${built.hash})`,
    );

    // 4. serve the single origin: the sprig shell + the generated previews + the in-process
    //    keep backend (discovery for the sidebar + the test runner), wrapped in the compiler's
    //    dev server (serve-dev.ts) so editing a component hot-swaps it in the stage — HMR.
    //    SPRIG_WB_ROOT tells serve-dev.ts which per-key app + static to serve.
    const port = Number(Deno.env.get("PORT") ?? 8000);
    const child = new Deno.Command("deno", {
      // --config the GENERATED workbench deno.json (not REPO's): it carries the project's `$.*`
      // aliases ($, $.services/, $.pages/, …) that serve-dev.ts's createRenderer needs to
      // dynamically import each preview target. Without it the SSR import resolves `$.services/*`
      // against REPO/deno.json (which has no `$.*`) and dies with "not in import map". The build
      // step above already resolves these via the app's config; the serve step must match.
      args: ["serve", "-A", "--unstable-kv", "--config", join(wbApp, "deno.json"), `--port=${port}`, resolve(REPO, "serve-dev.ts")],
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

    // IPv4-explicit on purpose: `deno serve` binds 0.0.0.0 (IPv4 only), while browsers and
    // fetch resolve `localhost` → ::1 first — in environments with a stale ::1 listener that
    // 404s, every request silently misses this server. Print (and open) the exact address.
    const url = `http://127.0.0.1:${port}/`;
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
