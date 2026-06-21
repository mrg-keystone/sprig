import { Command } from "@cliffy/command";
import { resolve } from "#std/path";
import { discover } from "../../server/src/core/business/discover/mod.ts";
import { runTests } from "../../server/src/core/business/runner/mod.ts";
import { ensureRunner } from "../lib/runner.ts";
import { materialize } from "../lib/materialize.ts";
import { startServer } from "../lib/process.ts";
import { formatProblems, printReport } from "../lib/format.ts";

export const testCmd = new Command()
  .description("Run every case's Playwright tests headlessly.")
  .arguments("[filter:string]")
  .option("-j, --json", "Output the full report as JSON (for agents/CI).")
  .option(
    "--base-url <url:string>",
    "Reuse a running preview server instead of spawning one.",
  )
  .action(async (opts, filter) => {
    const o = opts as unknown as {
      root: string;
      json?: boolean;
      baseUrl?: string;
    };
    const root = resolve(o.root);
    const { entries, problems } = await discover(root);

    // Fail fast: a misconfigured suite must never report green. No --force here.
    if (problems.length) {
      if (o.json) {
        console.log(
          JSON.stringify(
            { ok: false, ran: false, total: 0, testResults: [], problems },
            null,
            2,
          ),
        );
      } else {
        console.error(
          `✗ isolate found ${problems.length} config problem(s):\n\n${
            formatProblems(problems, root)
          }\n`,
        );
      }
      Deno.exit(1);
    }

    // Collect the cases' spec files (+ optional filter on path OR component/case).
    const byCase = new Map<string, string>();
    for (const e of entries) {
      for (const c of e.cases) {
        for (const t of c.tests) byCase.set(t.file, `${e.label}/${c.name}`);
      }
    }
    let files = [...byCase.keys()];
    if (filter) {
      const f = filter as string;
      files = files.filter((p) =>
        p.includes(f) || (byCase.get(p) ?? "").includes(f)
      );
    }
    if (files.length === 0) {
      console.log(
        o.json
          ? JSON.stringify({ ok: true, ran: false, total: 0, testResults: [] })
          : "No matching tests.",
      );
      return;
    }

    if (!(await ensureRunner())) {
      const msg =
        "Playwright runner unavailable (~/.isolate-runner) — see the warning above.";
      if (o.json) {
        console.log(
          JSON.stringify(
            { ok: false, ran: false, total: 0, testResults: [], error: msg },
            null,
            2,
          ),
        );
      } else console.error(`✗ ${msg}`);
      Deno.exit(1);
    }

    const { appDir } = await materialize(root);

    let child: Deno.ChildProcess | undefined;
    let baseUrl = o.baseUrl;
    if (!baseUrl) {
      if (!o.json) console.error("Starting preview server…");
      const s = await startServer(appDir);
      child = s.child;
      baseUrl = s.baseURL;
    }

    try {
      const report = await runTests({
        files,
        baseUrl,
        projectRoot: root,
        config: `${appDir}/playwright.config.ts`,
      });
      if (o.json) console.log(JSON.stringify(report, null, 2));
      else printReport(report, root);
      Deno.exit(report.ran && report.failed === 0 ? 0 : 1);
    } catch (e) {
      // runTests raises fault slugs (no-match/runner-unavailable/timeout).
      const msg = (e as Error).message;
      if (o.json) {
        console.log(
          JSON.stringify(
            { ok: false, ran: false, total: 0, testResults: [], error: msg },
            null,
            2,
          ),
        );
      } else console.error(`✗ test run failed: ${msg}`);
      Deno.exit(1);
    } finally {
      if (child) {
        try {
          child.kill("SIGTERM");
        } catch { /* dead */ }
      }
    }
  });
