#!/usr/bin/env -S deno run -A
/**
 * `sprig` — a THIN wrapper around the server. It holds no logic of its own: it
 * parses argv and boots the app's `serve.ts` (whose default export is
 * `serveSprig(...)`), or delegates to `deno serve` / the build.
 */
const [cmd, ...rest] = Deno.args;

async function serve(entry = "serve.ts"): Promise<void> {
  const url = new URL(entry, `file://${Deno.cwd()}/`).href;
  const mod = await import(url) as { default?: { fetch?: Deno.ServeHandler } };
  const app = mod.default;
  if (!app?.fetch) {
    console.error(`${entry} must \`export default\` an object with fetch(req, info) — got ${typeof app}`);
    Deno.exit(1);
  }
  Deno.serve((req, info) => app.fetch!(req, info));
}

async function delegate(args: string[]): Promise<never> {
  const p = new Deno.Command("deno", { args, stdout: "inherit", stderr: "inherit", stdin: "inherit" }).spawn();
  Deno.exit((await p.status).code);
}

const USAGE = `sprig — a thin wrapper around the sprig server

  sprig serve [entry]               boot the entry's serveSprig() default export (default: serve.ts)
  sprig dev   [entry] [member] [base]  state-preserving HMR dev server (watcher + SSE; no Vite)
  sprig build [member] [--dev]      code-split islands + scope CSS + Tailwind → static/ (+ manifest)
  sprig help                        this message
`;

switch (cmd) {
  case "serve":
    await serve(rest[0]);
    break;
  case "dev": {
    // State-preserving HMR (no Vite): build the dev bundle (HMR client + AST-fetching
    // island chunks), then run the dev server (Deno.watchFs + SSE + live AST). Template
    // edits hot-swap in place keeping island state; CSS swaps the stylesheet; logic/
    // server edits rebuild + reload.  Args: dev [entry] [member] [base]
    const entry = rest[0] ?? "serve.ts";
    const member = rest[1] ?? "ui";
    const baseSeg = rest[2] ?? "/ui";
    const build = await new Deno.Command("deno", {
      args: ["run", "-A", `${member}/.sprig/compiler/build.ts`, "--dev"],
      stdout: "inherit",
      stderr: "inherit",
    }).output();
    if (!build.success) Deno.exit(build.code);
    const runner = new URL("./dev-run.ts", import.meta.url).pathname;
    const p = new Deno.Command("deno", {
      args: ["run", "-A", "--unstable-kv", runner, member, entry, baseSeg],
      env: { ...Deno.env.toObject(), SPRIG_DEV: "1" },
      stdout: "inherit",
      stderr: "inherit",
      stdin: "inherit",
    }).spawn();
    Deno.exit((await p.status).code);
    break;
  }
  case "build":
    await delegate(["run", "-A", `${rest[0] ?? "ui"}/.sprig/compiler/build.ts`]);
    break;
  case undefined:
  case "help":
  case "--help":
  case "-h":
    console.log(USAGE);
    break;
  default:
    console.error(`sprig: unknown command "${cmd}"\n\n${USAGE}`);
    Deno.exit(1);
}
