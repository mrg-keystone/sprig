import { assert, assertEquals, assertRejects } from "#std/assert";
import {
  parseReport,
  runSpec,
  runTests,
  specReason,
} from "./mod.ts";

const enc = (s: string) => new TextEncoder().encode(s);

// deno-lint-ignore no-explicit-any
const withSpec = (file: string): any => ({
  entries: [{
    cases: [{ name: "c", route: "/r", tests: [{ name: "t", file }] }],
  }],
  problems: [],
});

Deno.test("specReason — inside/outside/non-spec", () => {
  assertEquals(specReason("/root/a.spec.ts", "/root"), null);
  assert(specReason("/etc/passwd", "/root")?.includes("outside"));
  assert(specReason("/root/a.ts", "/root")?.includes(".spec"));
});

Deno.test("runTests — no selector + no specs => empty green report", async () => {
  const r = await runTests({ projectRoot: "/root" }, {
    discover: () => Promise.resolve({ entries: [], problems: [] }),
  });
  assertEquals(r, {
    ok: true,
    ran: false,
    total: 0,
    passed: 0,
    failed: 0,
    testResults: [],
    problems: [],
  });
});

Deno.test("runTests — selector matches zero => no-match", async () => {
  await assertRejects(
    () => runTests({ projectRoot: "/root", filter: "zzz" }, {
      discover: () => Promise.resolve(withSpec("/root/a.spec.ts")),
    }),
    Error,
    "no-match",
  );
});

Deno.test("runTests — specs but no runner => runner-unavailable", async () => {
  await assertRejects(
    () =>
      runTests({ projectRoot: "/root", files: ["/root/a.spec.ts"] }, {
        runnerPresent: () => Promise.resolve(false),
      }),
    Error,
    "runner-unavailable",
  );
});

Deno.test("runTests — parses a Playwright JSON report", async () => {
  const json = JSON.stringify({
    suites: [{
      file: "/root/a.spec.ts",
      specs: [{ title: "adds", line: 3, ok: true, tests: [{ results: [{}] }] }],
    }],
  });
  const r = await runTests({ projectRoot: "/root", files: ["/root/a.spec.ts"] }, {
    runnerPresent: () => Promise.resolve(true),
    runSpec: () => Promise.resolve({ stdout: enc(json), stderr: enc("") }),
  });
  assertEquals(r.total, 1);
  assertEquals(r.passed, 1);
  assertEquals(r.ok, true);
  assertEquals(r.testResults[0].title, "adds");
});

Deno.test("runSpec — aborts and throws timeout", async () => {
  await assertRejects(
    () => runSpec("sleep", ["5"], {}, 50),
    Error,
    "timeout",
  );
});

Deno.test("parseReport — surfaces top-level load errors", () => {
  const json = JSON.stringify({
    suites: [],
    errors: [{ message: "Error: Cannot find package '@std/expect'" }],
  });
  const r = parseReport(enc(json), enc(""), new Map(), "/root");
  assertEquals(r.ok, false);
  assertEquals(r.ran, false);
  assertEquals(r.total, 0);
  assert(r.error?.includes("@std/expect"));
});

Deno.test("runTests — parsed-but-empty report carries the didn't-load hint", async () => {
  const r = await runTests({ projectRoot: "/root", files: ["/root/a.spec.ts"] }, {
    runnerPresent: () => Promise.resolve(true),
    runSpec: () =>
      Promise.resolve({ stdout: enc(JSON.stringify({ suites: [] })), stderr: enc("") }),
  });
  assertEquals(r.ran, false);
  assert(r.error?.includes("@playwright/test"));
  assert(r.error?.includes("1 spec file(s)"));
});

Deno.test("parseReport — counts failures", () => {
  const json = JSON.stringify({
    suites: [{
      file: "x.spec.ts",
      specs: [
        { title: "a", ok: true, tests: [{ results: [{}] }] },
        {
          title: "b",
          ok: false,
          tests: [{ results: [{ error: { message: "nope" } }] }],
        },
      ],
    }],
  });
  const r = parseReport(enc(json), enc(""), new Map(), "/root");
  assertEquals(r.total, 2);
  assertEquals(r.passed, 1);
  assertEquals(r.failed, 1);
  assertEquals(r.ok, false);
});
