// isolate — spin up a standalone preview for any component that has an
// `isolate/` folder. Run it from inside a Fresh project:
//
//   isolate list              # list discovered components + their cases
//   isolate dev               # build/serve ~/isolate/<app> with symlinks
//   isolate dev --no-open     # …without auto-opening the browser
//   isolate dev --root PATH   # …against a Fresh app elsewhere (default: cwd)
//   isolate test [filter]     # run cases' Playwright tests headlessly (--json for agents)
//
import { type ComponentEntry, discover } from "./discover.ts";
import { setupApp } from "./scaffold.ts";
import { resolve } from "jsr:@std/path@^1";

/** The Fresh project to isolate: `--root <path>` if given, else the current directory. */
function projectRoot(): string {
  const i = Deno.args.indexOf("--root");
  if (i >= 0 && Deno.args[i + 1]) return resolve(Deno.args[i + 1]);
  return Deno.cwd();
}

function describe(e: ComponentEntry): string {
  const kind = e.kind === "island" ? "island · hydrated" : "static";
  const cases = e.cases.length
    ? e.cases.map((c) => {
      const t = c.tests.length
        ? ` (${c.tests.length} test${c.tests.length > 1 ? "s" : ""})`
        : "";
      return `${c.name} → ${c.route}${t}`;
    }).join("\n             ")
    : "(no cases yet)";
  return [
    `• ${e.label}  [${e.target} · ${kind}]  category=${e.category}  folder=${
      e.folder || "—"
    }`,
    `    cases:   ${cases}`,
  ].join("\n");
}

async function cmdList() {
  const root = projectRoot();
  const entries = await discover(root);
  if (entries.length === 0) {
    console.log(
      "No isolatable components found.\n" +
        "Add an isolate/ folder to a component, e.g. components/button/isolate/.",
    );
    return;
  }
  const total = entries.reduce((n, e) => n + e.cases.length, 0);
  console.log(
    `Found ${entries.length} component(s), ${total} case(s) under ${root}:\n`,
  );
  console.log(entries.map(describe).join("\n\n"));
}

/** Stream a child pipe to our stdout, invoking onLine for each complete line. */
async function pump(
  stream: ReadableStream<Uint8Array>,
  onLine: (line: string) => void,
) {
  const reader = stream.getReader();
  const dec = new TextDecoder();
  let buf = "";
  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    await Deno.stdout.write(value);
    buf += dec.decode(value, { stream: true });
    let i: number;
    while ((i = buf.indexOf("\n")) >= 0) {
      onLine(buf.slice(0, i));
      buf = buf.slice(i + 1);
    }
  }
}

async function pathExists(p: string): Promise<boolean> {
  try {
    await Deno.stat(p);
    return true;
  } catch {
    return false;
  }
}

// The `isolate-events` test helper: bridges the page's RxJS event stream into a
// Node-side Observable so specs can assert on the events a component emits.
const EVENTS_HELPER =
  `import { filter, firstValueFrom, ReplaySubject, take, timeout } from "rxjs";

/**
 * Bridge the page's event stream into a Node-side RxJS Observable.
 * Call BEFORE page.goto so the binding is installed first. A ReplaySubject buffers
 * every event, so \`expect\` matches events whether they already fired or fire next.
 *
 *   const ev = await capture(page);
 *   await page.goto(url);
 *   await page.locator("#submit").click();
 *   await ev.expect((e) => e.source === "button#submit" && e.type === "click");
 */
export async function capture(page) {
  const subject = new ReplaySubject();
  await page.exposeBinding("__isolateEmit", (_source, evt) => subject.next(evt));
  const events$ = subject.asObservable();
  return {
    events$,
    /** First event matching \`predicate\` (past or future); rejects after \`opts.timeout\` ms (default 2000). */
    expect(predicate, opts = {}) {
      return firstValueFrom(events$.pipe(filter(predicate), take(1), timeout(opts.timeout ?? 2000)));
    },
  };
}
`;

/** Ensure ~/.isolate-runner has @playwright/test, rxjs, and the isolate-events helper. */
async function ensureRunner() {
  const home = Deno.env.get("HOME");
  if (!home) return;
  const dir = `${home}/.isolate-runner`;
  const mods = `${dir}/node_modules`;
  await Deno.mkdir(dir, { recursive: true });
  if (!(await pathExists(`${dir}/package.json`))) {
    await new Deno.Command("npm", {
      args: ["init", "-y"],
      cwd: dir,
      stdout: "null",
      stderr: "null",
    }).output();
  }

  // 1. @playwright/test (matched to the system playwright version when available).
  if (!(await pathExists(`${mods}/.bin/playwright`))) {
    console.log("Setting up the Playwright runner (one-time)…");
    let ver = "latest";
    try {
      const v = await new Deno.Command("playwright", {
        args: ["--version"],
        stdout: "piped",
        stderr: "null",
      }).output();
      const m = new TextDecoder().decode(v.stdout).match(/(\d+\.\d+\.\d+)/);
      if (m) ver = m[1];
    } catch { /* fall back to latest */ }
    const r = await new Deno.Command("npm", {
      args: ["i", `@playwright/test@${ver}`],
      cwd: dir,
      stdout: "inherit",
      stderr: "inherit",
    }).output();
    if (!r.success) {
      console.warn(
        "⚠ couldn't install @playwright/test — run buttons may fail.\n" +
          `  Fix: (cd ${dir} && npm i @playwright/test)`,
      );
    }
  }

  // 2. rxjs — the event-stream test helper depends on it.
  if (!(await pathExists(`${mods}/rxjs`))) {
    console.log("Installing rxjs for the event-stream test helper…");
    await new Deno.Command("npm", {
      args: ["i", "rxjs@^7"],
      cwd: dir,
      stdout: "inherit",
      stderr: "inherit",
    }).output();
  }

  // 3. The isolate-events helper, importable from specs as "isolate-events".
  const pkgDir = `${mods}/isolate-events`;
  await Deno.mkdir(pkgDir, { recursive: true });
  await Deno.writeTextFile(
    `${pkgDir}/package.json`,
    JSON.stringify(
      {
        name: "isolate-events",
        version: "0.0.0",
        type: "module",
        main: "index.js",
      },
      null,
      2,
    ) + "\n",
  );
  await Deno.writeTextFile(`${pkgDir}/index.js`, EVENTS_HELPER);
}

async function cmdDev(opts: { open: boolean }) {
  const root = projectRoot();
  const entries = await discover(root);
  if (entries.length === 0) {
    console.log(
      "Nothing to isolate — no component has an isolate/ folder yet.",
    );
    return;
  }

  await ensureRunner();
  console.log(`Setting up an isolate app for ${entries.length} component(s)…`);
  const { appDir, scaffolded } = await setupApp(root, entries);
  if (scaffolded) console.log(`Scaffolded a fresh app at ${appDir}`);

  // It's a real Fresh app now — just run its own dev task.
  const child = new Deno.Command("deno", {
    args: ["task", "dev"],
    cwd: appDir,
    stdout: "piped",
    stderr: "piped",
  }).spawn();

  let opened = false;
  let cleaned = false;
  const cleanup = () => {
    if (cleaned) return;
    cleaned = true;
    try {
      child.kill("SIGTERM");
    } catch { /* already dead */ }
  };

  for (const sig of ["SIGINT", "SIGTERM"] as const) {
    try {
      Deno.addSignalListener(sig, () => {
        cleanup();
        Deno.exit(0);
      });
    } catch { /* signal not supported here */ }
  }

  const onLine = (line: string) => {
    const m = line.match(/https?:\/\/(?:localhost|127\.0\.0\.1):\d+\/?/);
    if (m && !opened) {
      opened = true;
      console.log(`\n  ◆ isolate ready → ${m[0]}\n     app: ${appDir}\n`);
      if (opts.open) {
        try {
          new Deno.Command("open", { args: [m[0]] }).spawn();
        } catch { /* not macOS / no opener */ }
      }
    }
  };

  try {
    await Promise.all([pump(child.stdout, onLine), pump(child.stderr, onLine)]);
    await child.status;
  } finally {
    cleanup();
  }
}

/** Quietly drain a child stream, invoking onLine per complete line. */
async function drain(
  stream: ReadableStream<Uint8Array>,
  onLine: (line: string) => void,
) {
  const reader = stream.getReader();
  const dec = new TextDecoder();
  let buf = "";
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      buf += dec.decode(value, { stream: true });
      let i: number;
      while ((i = buf.indexOf("\n")) >= 0) {
        onLine(buf.slice(0, i));
        buf = buf.slice(i + 1);
      }
    }
  } catch { /* stream closed */ }
}

/** Start the preview dev server; resolve once it logs its URL. */
function startServer(
  appDir: string,
): Promise<{ child: Deno.ChildProcess; baseURL: string }> {
  const child = new Deno.Command("deno", {
    args: ["task", "dev"],
    cwd: appDir,
    stdout: "piped",
    stderr: "piped",
  }).spawn();
  return new Promise((resolve, reject) => {
    let done = false;
    drain(child.stdout, (line) => {
      const m = line.match(/https?:\/\/(?:localhost|127\.0\.0\.1):\d+/);
      if (m && !done) {
        done = true;
        resolve({ child, baseURL: m[0] });
      }
    });
    drain(child.stderr, () => {});
    setTimeout(() => {
      if (!done) {
        done = true;
        try {
          child.kill("SIGTERM");
        } catch { /* */ }
        reject(new Error("preview server did not start in time"));
      }
    }, 90_000);
  });
}

const stripAnsi = (s: string) => s.replace(/\x1b\[[0-9;]*m/g, "");

interface TestResult {
  case?: string;
  route?: string;
  title: string;
  file: string;
  line?: number;
  ok: boolean;
  error?: string;
  screenshot?: string;
}

/** Parse Playwright's JSON reporter into flat per-test results with failure detail. */
function parseReport(
  stdout: Uint8Array,
  stderr: Uint8Array,
  byFile: Map<string, { case: string; route: string }>,
  root: string,
) {
  const tests: TestResult[] = [];
  let parsed = false;
  try {
    // deno-lint-ignore no-explicit-any
    const j: any = JSON.parse(new TextDecoder().decode(stdout));
    parsed = true;
    // deno-lint-ignore no-explicit-any
    const walk = (suite: any, file?: string) => {
      const f: string = suite.file ?? file ?? "";
      const abs = f.startsWith("/") ? f : `${root}/${f}`;
      const ctx = byFile.get(abs) ?? byFile.get(f);
      for (const spec of (suite.specs ?? [])) {
        const result = (spec.tests?.[0]?.results ?? [])[0];
        const msg = result?.error?.message ?? result?.errors?.[0]?.message;
        // deno-lint-ignore no-explicit-any
        const shot = (result?.attachments ?? []).find((a: any) =>
          a.name === "screenshot"
        )?.path;
        tests.push({
          case: ctx?.case,
          route: ctx?.route,
          title: spec.title,
          file: abs,
          line: spec.line,
          ok: !!spec.ok,
          error: msg ? stripAnsi(String(msg)).trim() : undefined,
          screenshot: shot,
        });
      }
      for (const s of (suite.suites ?? [])) walk(s, f);
    };
    for (const s of (j.suites ?? [])) walk(s, s.file);
  } catch { /* not JSON */ }
  const failed = tests.filter((t) => !t.ok).length;
  return {
    ok: parsed && tests.length > 0 && failed === 0,
    ran: parsed && tests.length > 0,
    total: tests.length,
    passed: tests.length - failed,
    failed,
    tests,
    error: (!parsed || tests.length === 0)
      ? (stripAnsi(new TextDecoder().decode(stderr)).trim().slice(-800) ||
        undefined)
      : undefined,
  };
}

/** `isolate test [filter] [--json] [--base-url URL]` — run the cases' tests headlessly. */
async function cmdTest(
  opts: { json: boolean; filter?: string; baseUrl?: string },
) {
  const root = projectRoot();
  const entries = await discover(root);
  const byFile = new Map<string, { case: string; route: string }>();
  for (const e of entries) {
    for (const c of e.cases) {
      for (const t of c.tests) {
        byFile.set(t.file, { case: `${e.label}/${c.name}`, route: c.route });
      }
    }
  }
  let files = [...byFile.keys()];
  if (opts.filter) {
    files = files.filter((f) =>
      f.includes(opts.filter!) || byFile.get(f)!.case.includes(opts.filter!)
    );
  }
  if (files.length === 0) {
    console.log(
      opts.json
        ? JSON.stringify({ ok: true, ran: false, total: 0, tests: [] })
        : "No matching tests.",
    );
    return;
  }

  await ensureRunner();
  const { appDir } = await setupApp(root, entries);
  const runner = `${Deno.env.get("HOME")}/.isolate-runner/node_modules`;

  let child: Deno.ChildProcess | undefined;
  let baseURL = opts.baseUrl;
  if (!baseURL) {
    if (!opts.json) console.error("Starting preview server…");
    const s = await startServer(appDir);
    child = s.child;
    baseURL = s.baseURL;
  }

  const out = await (async () => {
    try {
      return await new Deno.Command(`${runner}/.bin/playwright`, {
        args: [
          "test",
          ...files,
          "--config",
          `${appDir}/playwright.config.ts`,
          "--reporter=json",
        ],
        env: {
          ...Deno.env.toObject(),
          NODE_PATH: runner,
          ISOLATE_BASE_URL: baseURL!,
        },
        stdout: "piped",
        stderr: "piped",
      }).output();
    } finally {
      if (child) {
        try {
          child.kill("SIGTERM");
        } catch { /* dead */ }
      }
    }
  })();

  const report = parseReport(out.stdout, out.stderr, byFile, root);
  if (opts.json) {
    console.log(JSON.stringify(report, null, 2));
  } else if (!report.ran) {
    console.error(
      "✗ Couldn't run tests:\n" + (report.error ?? "unknown error"),
    );
  } else {
    for (const t of report.tests) {
      const where = t.file.replace(`${root}/`, "") +
        (t.line ? `:${t.line}` : "");
      if (t.ok) {
        console.log(`  ✓ ${t.case ? t.case + " › " : ""}${t.title}`);
      } else {
        console.log(
          `  ✗ ${t.case ? t.case + " › " : ""}${t.title}   (${where})`,
        );
        if (t.error) {
          console.log(t.error.split("\n").map((l) => "      " + l).join("\n"));
        }
        if (t.screenshot) console.log(`      ↳ screenshot: ${t.screenshot}`);
      }
    }
    console.log(
      `\n${report.passed}/${report.total} passed${
        report.failed ? `, ${report.failed} failed` : ""
      }.`,
    );
  }
  Deno.exit(report.ran && report.failed === 0 ? 0 : 1);
}

function parseTestArgs(
  rest: string[],
): { json: boolean; filter?: string; baseUrl?: string } {
  const json = rest.includes("--json");
  const bi = rest.indexOf("--base-url");
  const baseUrl = bi >= 0 ? rest[bi + 1] : undefined;
  const skip = bi >= 0 ? bi + 1 : -1;
  const filter = rest.find((a, i) => !a.startsWith("--") && i !== skip);
  return { json, filter, baseUrl };
}

async function main() {
  const cmd = Deno.args[0] ?? "list";
  switch (cmd) {
    case "list":
      await cmdList();
      break;
    case "dev":
      await cmdDev({ open: !Deno.args.includes("--no-open") });
      break;
    case "test":
      await cmdTest(parseTestArgs(Deno.args.slice(1)));
      break;
    default:
      console.error(`Unknown command: ${cmd}\nTry: isolate [list|dev|test]`);
      Deno.exit(1);
  }
}

if (import.meta.main) {
  await main();
}
