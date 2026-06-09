// isolate — spin up a standalone preview for any component that has an
// `isolate/` folder. Run it from inside a Fresh project:
//
//   isolate list              # list discovered components + their cases
//   isolate dev               # build/serve ~/isolate/<app> with symlinks
//   isolate dev --no-open     # …without auto-opening the browser
//   isolate dev --root PATH   # …against a Fresh app elsewhere (default: cwd)
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
      const t = c.tests.length ? ` (${c.tests.length} test${c.tests.length > 1 ? "s" : ""})` : "";
      return `${c.name} → ${c.route}${t}`;
    }).join("\n             ")
    : "(no cases yet)";
  return [
    `• ${e.label}  [${kind}]  category=${e.category}  folder=${e.folder || "—"}`,
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

/** Ensure ~/.isolate-runner has @playwright/test so specs can `import` it. */
async function ensureRunner() {
  const home = Deno.env.get("HOME");
  if (!home) return;
  const dir = `${home}/.isolate-runner`;
  const bin = `${dir}/node_modules/.bin/playwright`;
  try {
    await Deno.stat(bin);
    return; // already set up
  } catch { /* needs install */ }

  console.log("Setting up the Playwright runner (one-time)…");
  await Deno.mkdir(dir, { recursive: true });
  let ver = "latest";
  try {
    const v = await new Deno.Command("playwright", { args: ["--version"], stdout: "piped", stderr: "null" }).output();
    const m = new TextDecoder().decode(v.stdout).match(/(\d+\.\d+\.\d+)/);
    if (m) ver = m[1];
  } catch { /* fall back to latest */ }
  await new Deno.Command("npm", { args: ["init", "-y"], cwd: dir, stdout: "null", stderr: "null" }).output();
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

async function cmdDev(opts: { open: boolean }) {
  const root = projectRoot();
  const entries = await discover(root);
  if (entries.length === 0) {
    console.log("Nothing to isolate — no component has an isolate/ folder yet.");
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

async function main() {
  const cmd = Deno.args[0] ?? "list";
  switch (cmd) {
    case "list":
      await cmdList();
      break;
    case "dev":
      await cmdDev({ open: !Deno.args.includes("--no-open") });
      break;
    default:
      console.error(`Unknown command: ${cmd}\nTry: isolate [list|dev]`);
      Deno.exit(1);
  }
}

if (import.meta.main) {
  await main();
}
