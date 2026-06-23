import { Command } from "@cliffy/command";
import { fromFileUrl, resolve } from "#std/path";
import { discover } from "../../server/src/core/business/discover/mod.ts";
import { generatePreviews } from "../lib/generate-previews.ts";
import { ensureRunner } from "../lib/runner.ts";
import { onShutdown, openBrowser } from "../lib/process.ts";
import { formatProblems } from "../lib/format.ts";

const REPO = fromFileUrl(new URL("../../", import.meta.url)); // repo root (workbench app + framework live here)

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

    // 2. generate one sprig preview per case into the workbench app (no Vite, no copy-a-Fresh-app)
    const appSrc = resolve(REPO, "app/src");
    const n = await generatePreviews(entries, appSrc, resolve(root, "src"));
    console.log(`Generated ${n} preview page(s) for ${entries.length} component(s).`);

    // 3. build the workbench app in DEV mode (code-split islands + scope CSS + the HMR client) → static/
    const build = await new Deno.Command("deno", {
      args: ["run", "-A", resolve(REPO, "framework/cli.ts"), "build", "app", "--dev"],
      cwd: REPO,
      stdout: "inherit",
      stderr: "inherit",
    }).output();
    if (!build.success) Deno.exit(build.code);

    // 4. serve the single origin: the sprig shell + the generated previews + the in-process
    //    keep backend (discovery for the sidebar + the test runner), wrapped in the compiler's
    //    dev server (serve-dev.ts) so editing a component hot-swaps it in the stage — HMR.
    const port = Number(Deno.env.get("PORT") ?? 8000);
    const child = new Deno.Command("deno", {
      args: ["serve", "-A", "--unstable-kv", `--port=${port}`, resolve(REPO, "serve-dev.ts")],
      cwd: REPO,
      env: { ...Deno.env.toObject(), ISOLATE_PROJECT: root, SPRIG_DEV: "1" },
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
