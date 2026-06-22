// Terminal formatting: problem reports, the `list` table, and test-run output.
import { colors } from "@cliffy/ansi/colors";
import { Table } from "@cliffy/table";
import type {
  ComponentEntry,
  Problem,
} from "../../server/src/core/business/discover/mod.ts";
import type { TestReport } from "../../server/src/core/business/runner/mod.ts";

const HEAD: Record<Problem["kind"], string> = {
  "fixture-json": "malformed fixture.json",
  "case-json": "malformed case JSON",
  "component-file": "unresolved component file",
  "component-export": "component export not found",
  "unsupported": "feature not yet supported",
};

const rel = (p: string, root: string) =>
  p.startsWith(root + "/") ? p.slice(root.length + 1) : p;

/** A human-readable batch of discovery problems; paths shown relative to root. */
export function formatProblems(problems: Problem[], root: string): string {
  return problems
    .map((p) =>
      `  ${colors.yellow("⚠ " + HEAD[p.kind])}\n      ${
        rel(p.path, root)
      }\n      ${p.detail}`
    )
    .join("\n\n");
}

/** Render discovered components as a table (used by `isolate list`). */
export function renderList(entries: ComponentEntry[], root: string): void {
  const total = entries.reduce((n, e) => n + e.cases.length, 0);
  console.log(
    colors.bold(`isolate`) +
      `  —  ${entries.length} component(s), ${total} case(s) under ${root}\n`,
  );
  new Table()
    .header(
      ["Component", "Kind", "Category", "Cases", "Tests"].map((h) =>
        colors.dim(h)
      ),
    )
    .body(
      entries.map((e) => [
        e.label,
        e.kind === "island" ? colors.cyan("island") : "static",
        e.category,
        String(e.cases.length),
        String(e.cases.reduce((n, c) => n + c.tests.length, 0)),
      ]),
    )
    .padding(2)
    .render();
  console.log("");
  for (const e of entries) {
    for (const c of e.cases) {
      const t = c.tests.length ? colors.dim(` (${c.tests.length} test)`) : "";
      console.log(
        `  ${colors.dim(e.label + " ›")} ${c.name}  →  ${c.route}${t}`,
      );
    }
  }
}

/** Print a test report (human-readable). Returns nothing — caller sets exit code. */
export function printReport(report: TestReport, root: string): void {
  if (!report.ran) {
    console.error(
      colors.red("✗ Couldn't run tests:\n") + (report.error ?? "unknown error"),
    );
    return;
  }
  for (const t of report.testResults) {
    const head = t.caseName ? colors.dim(t.caseName + " › ") : "";
    if (t.ok) {
      console.log(`  ${colors.green("✓")} ${head}${t.title}`);
    } else {
      const where = rel(t.file, root) + (t.line ? `:${t.line}` : "");
      console.log(
        `  ${colors.red("✗")} ${head}${t.title}   ${
          colors.dim("(" + where + ")")
        }`,
      );
      if (t.error) {
        console.log(t.error.split("\n").map((l) => "      " + l).join("\n"));
      }
      if (t.screenshot) console.log(`      ↳ screenshot: ${t.screenshot}`);
    }
  }
  const summary = `${report.passed}/${report.total} passed` +
    (report.failed ? `, ${report.failed} failed` : "");
  console.log(
    "\n" + (report.failed ? colors.red(summary) : colors.green(summary)) + ".",
  );
}
