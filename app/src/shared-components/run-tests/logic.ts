// run-tests — per-case "▸ run" button + pass/fail dots, ported from RunTests.tsx.
// An island embedded by the (static) gallery page; its `tests` input is the
// case's spec files. Runs over the network channel /api/http/post-test-run.
import { defineComponent, signal } from "@sprig/core";

interface Res {
  title: string;
  ok: boolean;
  error?: string;
}

export default defineComponent({
  inputs: ["tests"],
  setup: (ctx) => {
    const tests = ctx.input<string[]>("tests", []);
    const status = signal("idle");
    const results = signal<Res[]>([]);
    const ok = signal<boolean | null>(null);
    const error = signal<string | null>(null);

    const hasTests = () => (tests() ?? []).length > 0;

    const run = async () => {
      status.set("running");
      results.set([]);
      ok.set(null);
      error.set(null);
      try {
        const res = await fetch("/api/http/post-test-run", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ files: tests(), baseUrl: location.origin }),
        });
        const j = await res.json();
        results.set(j.testResults || j.results || []);
        ok.set(!!j.ok);
        // a run with no per-test results carries its reason in j.error
        if (!j.ok && results().length === 0) {
          error.set(j.error || ("run failed (HTTP " + res.status + ")"));
        }
      } catch (e) {
        ok.set(false);
        error.set("couldn't reach the runner — " + ((e as Error).message || e));
      }
      status.set("done");
    };

    const errorFirstLine = () => (error() || "error").split("\n")[0];

    return { tests, status, results, ok, error, hasTests, run, errorFirstLine };
  },
});
