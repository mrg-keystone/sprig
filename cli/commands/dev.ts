import { Command } from "@cliffy/command";
import { resolve } from "#std/path";
import { fromFileUrl } from "#std/path";
import { discover } from "../../server/src/core/business/discover/mod.ts";
import { ensureRunner } from "../lib/runner.ts";
import { materialize } from "../lib/materialize.ts";
import { onShutdown, openBrowser, pump, URL_RE } from "../lib/process.ts";
import { formatProblems } from "../lib/format.ts";

const SERVER_DIR = fromFileUrl(new URL("../../server", import.meta.url));

export const devCmd = new Command()
  .description("Build & serve the preview app; open the browser.")
  .option("--no-open", "Don't auto-open the browser.")
  .option(
    "-f, --force",
    "Preview the valid components even if some configs are malformed.",
  )
  .action(async (opts) => {
    const o = opts as unknown as {
      root: string;
      open: boolean;
      force?: boolean;
    };
    const root = resolve(o.root);
    const { entries, problems } = await discover(root);
    if (entries.length === 0) {
      console.log(
        "Nothing to isolate — no component has an isolate/ folder yet.",
      );
      return;
    }
    if (problems.length) {
      console.error(
        `✗ isolate found ${problems.length} config problem(s):\n\n${
          formatProblems(problems, root)
        }\n`,
      );
      if (!o.force) {
        console.error(
          "Fix these and re-run, or `isolate dev --force` to preview the valid ones anyway.",
        );
        Deno.exit(1);
      }
      console.error("Continuing anyway (--force).\n");
    }

    await ensureRunner();
    console.log(
      `Setting up an isolate app for ${entries.length} component(s)…`,
    );
    const { appDir, scaffolded } = await materialize(root);
    if (scaffolded) console.log(`Scaffolded a fresh app at ${appDir}`);

    // The keep API server (the preview's /api/run proxies to it for the run button).
    const keepPort = 9595;
    const keep = new Deno.Command("deno", {
      args: ["run", "-A", "bootstrap/mod.ts"],
      cwd: SERVER_DIR,
      env: { ...Deno.env.toObject(), PORT: String(keepPort) },
      stdout: "null",
      stderr: "null",
    }).spawn();

    // The Fresh preview app (Vite), pointed at the keep server.
    const child = new Deno.Command("deno", {
      args: ["task", "dev"],
      cwd: appDir,
      env: {
        ...Deno.env.toObject(),
        ISOLATE_KEEP_URL: `http://localhost:${keepPort}`,
      },
      stdout: "piped",
      stderr: "piped",
    }).spawn();

    const cleanup = onShutdown(() => {
      for (const c of [child, keep]) {
        try {
          c.kill("SIGTERM");
        } catch { /* already dead */ }
      }
    });

    let opened = false;
    const onLine = (line: string) => {
      const m = line.match(URL_RE);
      if (m && !opened) {
        opened = true;
        console.log(`\n  ◆ isolate ready → ${m[0]}\n     app: ${appDir}\n`);
        if (o.open) openBrowser(m[0]);
      }
    };

    try {
      await Promise.all([
        pump(child.stdout, onLine),
        pump(child.stderr, onLine),
      ]);
      await child.status;
    } finally {
      cleanup();
    }
  });
