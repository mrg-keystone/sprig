import { Command } from "@cliffy/command";
import { fromFileUrl, resolve } from "#std/path";
import { discover } from "../../server/src/core/business/discover/mod.ts";
import { runTests } from "../../server/src/core/business/runner/mod.ts";
import { ensureRunner } from "../lib/runner.ts";
import { generatePreviews } from "../lib/generate-previews.ts";
import { formatProblems, printReport } from "../lib/format.ts";

const REPO = fromFileUrl(new URL("../../", import.meta.url));

/** Spawn `deno serve serve.ts` and resolve once it answers. */
async function startServer(projectRoot: string): Promise<{ child: Deno.ChildProcess; baseURL: string }> {
  const port = 3000 + Math.floor(Math.random() * 4000);
  const child = new Deno.Command("deno", {
    args: ["serve", "-A", "--unstable-kv", `--port=${port}`, resolve(REPO, "serve.ts")],
    cwd: REPO,
    env: { ...Deno.env.toObject(), ISOLATE_PROJECT: projectRoot },
    stdout: "null",
    stderr: "null",
  }).spawn();
  const baseURL = `http://localhost:${port}`;
  for (let i = 0; i < 60; i++) {
    try {
      const r = await fetch(baseURL + "/", { signal: AbortSignal.timeout(500) });
      await r.body?.cancel();
      if (r.ok) break;
    } catch { /* not up yet */ }
    await new Promise((res) => setTimeout(res, 250));
  }
  return { child, baseURL };
}

export const testCmd = new Command()
  .description("Run every case's Playwright tests headlessly.")
  .arguments("[filter:string]")
  .option("-j, --json", "Output the full report as JSON (for agents/CI).")
  .option("--base-url <url:string>", "Reuse a running preview server instead of spawning one.")
  .action(async (opts, filter) => {
    const o = opts as unknown as { root: string; json?: boolean; baseUrl?: string };
    const root = resolve(o.root);
    const { entries, problems } = await discover(root);

    // Fail fast on real config errors; _mocks "unsupported" notes are advisory.
    const fatal = problems.filter((p) => p.kind !== "unsupported");
    if (fatal.length) {
      if (o.json) {
        console.log(JSON.stringify({ ok: false, ran: false, total: 0, testResults: [], problems: fatal }, null, 2));
      } else {
        console.error(`✗ isolate found ${fatal.length} config problem(s):\n\n${formatProblems(fatal, root)}\n`);
      }
      Deno.exit(1);
    }

    const byCase = new Map<string, string>();
    for (const e of entries) {
      for (const c of e.cases) for (const t of c.tests) byCase.set(t.file, `${e.label}/${c.name}`);
    }
    let files = [...byCase.keys()];
    if (filter) {
      const f = filter as string;
      files = files.filter((p) => p.includes(f) || (byCase.get(p) ?? "").includes(f));
    }
    if (files.length === 0) {
      console.log(o.json ? JSON.stringify({ ok: true, ran: false, total: 0, testResults: [] }) : "No matching tests.");
      return;
    }

    if (!(await ensureRunner())) {
      const msg = "Playwright runner unavailable (~/.isolate-runner) — see the warning above.";
      if (o.json) console.log(JSON.stringify({ ok: false, ran: false, total: 0, testResults: [], error: msg }, null, 2));
      else console.error(`✗ ${msg}`);
      Deno.exit(1);
    }

    // Generate the sprig previews + build the workbench app (so the specs have routes to hit).
    await generatePreviews(entries, resolve(REPO, "app/src"));
    const build = await new Deno.Command("deno", {
      args: ["run", "-A", resolve(REPO, "framework/cli.ts"), "build", "app"],
      cwd: REPO,
      stdout: "null",
      stderr: "inherit",
    }).output();
    if (!build.success) Deno.exit(build.code);

    let child: Deno.ChildProcess | undefined;
    let baseUrl = o.baseUrl;
    if (!baseUrl) {
      if (!o.json) console.error("Starting preview server…");
      const s = await startServer(root);
      child = s.child;
      baseUrl = s.baseURL;
    }

    try {
      const report = await runTests({ files, baseUrl, projectRoot: root });
      if (o.json) console.log(JSON.stringify(report, null, 2));
      else printReport(report, root);
      Deno.exit(report.ran && report.failed === 0 ? 0 : 1);
    } catch (e) {
      const msg = (e as Error).message;
      if (o.json) console.log(JSON.stringify({ ok: false, ran: false, total: 0, testResults: [], error: msg }, null, 2));
      else console.error(`✗ test run failed: ${msg}`);
      Deno.exit(1);
    } finally {
      if (child) {
        try {
          child.kill("SIGTERM");
        } catch { /* dead */ }
      }
    }
  });
