#!/usr/bin/env -S deno run -A
/**
 * `sprig` — the framework CLI.
 *
 *   sprig init [dir]            scaffold a minimal, runnable sprig app
 *   sprig dev  [appDir]         state-preserving HMR dev server (no Vite)
 *   sprig build [appDir]        code-split islands + scope CSS + Tailwind → static/
 *   sprig serve [entry]         run the app's host entry (e.g. bootstrap/serve.ts)
 *   sprig help
 *
 * The framework runtime lives next to this file at ./.sprig (core + compiler).
 */
import { dirname, fromFileUrl, join, resolve, toFileUrl } from "@std/path";
// static relative imports of the package's own modules (computed-path dynamic imports
// are unanalyzable + don't resolve once this is published to JSR).
import { buildClient } from "./.sprig/compiler/build.ts";
import { createDevServer } from "./.sprig/compiler/dev.ts";
import { sprigUi } from "../packages/keep/mod.ts";
import { assertWorkbench, installRuntimeFromDeployment, installRuntimeFromWorkingTree } from "./.sprig/install.ts";

// the published-package version range a scaffolded app pins (core + its /keep + /cli
// sub-exports all ship from @sprig/core). Bump in lockstep with the published version.
const SPRIG_RANGE = "^0.2.0";

async function fileExists(p: string): Promise<boolean> {
  try {
    await Deno.stat(p);
    return true;
  } catch {
    return false;
  }
}

/** The requested port, or the next free one above it (up to +50) if it's taken — so a
 *  stale server on 8000 never makes `sprig dev`/`isolate` crash with a cryptic AddrInUse. */
function freePort(start: number): number {
  for (let p = start; p < start + 50; p++) {
    try {
      Deno.listen({ port: p }).close();
      if (p !== start) console.log(`sprig: port ${start} in use → using ${p}`);
      return p;
    } catch { /* in use → try the next */ }
  }
  return start;
}

/** A per-project file (in TMPDIR, not the project) where pinLocalSprig stashes the app's
 *  ORIGINAL deno.json, so a `sprig dev` killed mid-session can self-heal on the next run. */
function sprigBackupPath(appDir: string): string {
  const tmp = Deno.env.get("TMPDIR") ?? "/tmp";
  const key = resolve(appDir).replace(/[^A-Za-z0-9]+/g, "-").replace(/(^-|-$)/g, "") || "app";
  return join(tmp, "sprig-dev", key, "deno.json.orig");
}

/** If a previous `sprig dev` was killed (e.g. SIGKILL) before it could restore the app's
 *  deno.json, the backup still exists — put it back. */
async function healLocalSprig(appDir: string): Promise<void> {
  const bak = sprigBackupPath(appDir);
  try {
    const orig = await Deno.readTextFile(bak);
    await Deno.writeTextFile(join(resolve(appDir), "deno.json"), orig);
    await Deno.remove(bak).catch(() => {});
    console.log("sprig: restored deno.json from an interrupted previous `sprig dev`.");
  } catch { /* no backup → nothing to heal */ }
}

/** Point the app's `@sprig/core` + `@sprig/keep` at the LOCAL install. The app pins them to
 *  JSR (`jsr:@sprig/core@…`) for portability, but importing its mod.ts with a JSR pin pulls a
 *  SECOND @sprig/core — the JSR build — into the process, and two web-tree-sitter wasm
 *  instances can't co-exist (`Import #0 "./env"`). deno reads the app's deno.json at STARTUP,
 *  so the swap must be in place before the dev child launches. We back the original up to
 *  TMPDIR (self-heal) and return a sync restore. No-op when already local / no deno.json. */
async function pinLocalSprig(appDir: string): Promise<{ active: boolean; restore: () => void }> {
  const inactive = { active: false, restore: () => {} };
  const cfgPath = join(resolve(appDir), "deno.json");
  let original: string;
  try {
    original = await Deno.readTextFile(cfgPath);
  } catch {
    return inactive;
  }
  let cfg: { imports?: Record<string, string> };
  try {
    cfg = JSON.parse(original);
  } catch {
    return inactive;
  }
  if (!cfg.imports) return inactive;
  const installDir = join(dirname(fromFileUrl(import.meta.url)), "..");
  const locals: Record<string, string> = {
    "@sprig/core": join(installDir, "framework", ".sprig", "core.ts"),
    "@sprig/keep": join(installDir, "packages", "keep", "mod.ts"),
  };
  let changed = false;
  for (const [k, local] of Object.entries(locals)) {
    const v = cfg.imports[k];
    if (typeof v === "string" && !/^(\.{0,2}\/|\/)/.test(v)) { // a non-local (jsr:/npm:/bare) map
      cfg.imports[k] = local;
      changed = true;
    }
  }
  if (!changed) return inactive;
  const bak = sprigBackupPath(appDir);
  await Deno.mkdir(dirname(bak), { recursive: true });
  await Deno.writeTextFile(bak, original);
  await Deno.writeTextFile(cfgPath, JSON.stringify(cfg, null, 2));
  let done = false;
  const restore = () => {
    if (done) return;
    done = true;
    try {
      Deno.writeTextFileSync(cfgPath, original); // sync → safe inside signal handlers
    } catch { /* best effort */ }
    try {
      Deno.removeSync(bak);
    } catch { /* best effort */ }
  };
  return { active: true, restore };
}

/** `dev`/`isolate` import the app's SSR renderer in-process, and that renderer dynamically
 *  imports the app's logic.ts — whose `$.*` aliases live in the APP's deno.json, not the
 *  installed CLI's (~/.sprig) config. So re-run under a MERGED config: the install's compiler
 *  deps (web-tree-sitter + node_modules for grammar.wasm, the local @sprig/core) PLUS the
 *  app's own imports (the `$` aliases, @danet/core, …), with the app's relative paths made
 *  absolute. No-op once merged, or when run from somewhere without an install deno.json. */
async function withMergedConfig(appDir: string): Promise<void> {
  if (Deno.env.get("SPRIG_MERGED")) return;
  if (!import.meta.url.startsWith("file:")) return; // only a local install runs the compiler
  const appAbs = resolve(appDir);
  const appCfgPath = join(appAbs, "deno.json");
  const installDir = join(dirname(fromFileUrl(import.meta.url)), ".."); // framework/ → install root
  const rtCfgPath = join(installDir, "deno.json");
  if (!(await fileExists(appCfgPath)) || !(await fileExists(rtCfgPath))) return;
  await healLocalSprig(appDir); // recover the app's deno.json if a prior `sprig dev` was killed
  let appCfg: { imports?: Record<string, string> }, rtCfg: Record<string, unknown>;
  try {
    appCfg = JSON.parse(await Deno.readTextFile(appCfgPath));
    rtCfg = JSON.parse(await Deno.readTextFile(rtCfgPath));
  } catch {
    return; // unparseable config → run as-is
  }
  const imports: Record<string, unknown> = { ...(rtCfg.imports as Record<string, unknown> ?? {}) };
  for (const [k, v] of Object.entries(appCfg.imports ?? {})) {
    if (k === "@sprig/core" || k === "@sprig/keep") continue; // keep the install's local sprig + compiler
    if (typeof v === "string" && /^\.\.?\//.test(v)) {
      let abs = toFileUrl(join(appAbs, v)).href;
      if (v.endsWith("/") && !abs.endsWith("/")) abs += "/"; // preserve prefix-mapping trailing slash
      imports[k] = abs;
    } else {
      imports[k] = v;
    }
  }
  const mergedPath = join(installDir, ".sprig-app.json");
  await Deno.writeTextFile(mergedPath, JSON.stringify({ ...rtCfg, imports }, null, 2));
  // Pin the app's @sprig/* to the LOCAL install for the child run (deno reads the app's
  // deno.json at startup, so the swap must precede the launch). Restore on normal exit AND on
  // Ctrl-C; a SIGKILL is caught by healLocalSprig on the next run.
  const pin = await pinLocalSprig(appDir);
  if (pin.active) {
    const onSig = () => {
      pin.restore();
      Deno.exit(130);
    };
    Deno.addSignalListener("SIGINT", onSig);
    Deno.addSignalListener("SIGTERM", onSig);
  }
  try {
    const { code } = await new Deno.Command(Deno.execPath(), {
      args: ["run", "-A", "--config", mergedPath, fromFileUrl(import.meta.url), ...Deno.args],
      env: { ...Deno.env.toObject(), SPRIG_MERGED: "1" },
      stdin: "inherit",
      stdout: "inherit",
      stderr: "inherit",
    }).output();
    pin.restore();
    Deno.exit(code);
  } catch (e) {
    pin.restore();
    throw e;
  }
}

/** Dev/HMR build output lives in a per-project temp dir, NOT the project's static/, so
 *  `sprig dev` never litters the source tree. Stable per project so HMR rebuilds reuse it.
 *  (`sprig build` keeps writing <cwd>/static — the deploy artifact serveSprig reads.) */
function devCacheDir(appDir: string): string {
  const tmp = Deno.env.get("TMPDIR") ?? "/tmp";
  const key = resolve(appDir).replace(/[^A-Za-z0-9]+/g, "-").replace(/(^-|-$)/g, "") || "app";
  return join(tmp, "sprig-dev", key, "static");
}

async function build(appDir = ".", dev = false, outDir = join(Deno.cwd(), "static")): Promise<void> {
  const srcDir = join(resolve(appDir), "src");
  const r = await buildClient(srcDir, outDir, { dev });
  console.log(
    `sprig build${dev ? " (dev)" : ""}: ${r.islands.length} island chunk(s) ` +
      `[${r.islands.join(", ")}] + ${r.chunks.length} shared chunk(s) → ${outDir} ` +
      `(${(r.bytes / 1024).toFixed(1)}kb, v=${r.hash})`,
  );
}

async function serve(entry = "serve.ts"): Promise<void> {
  // Run the app's host entry (e.g. bootstrap/serve.ts) in a SUBPROCESS so deno discovers
  // the APP's deno.json from the cwd — the host imports @danet/core + the `$` aliases,
  // which the installed CLI's own (~/.sprig) config does not define. The host self-serves
  // (it calls app.listen()); we just forward stdio + the exit code.
  const { code } = await new Deno.Command(Deno.execPath(), {
    args: ["run", "-A", entry],
    stdin: "inherit",
    stdout: "inherit",
    stderr: "inherit",
  }).output();
  Deno.exit(code);
}

async function dev(appDir = ".", base = "/ui"): Promise<void> {
  await withMergedConfig(appDir);
  // State-preserving HMR (no Vite): build the dev bundle (HMR client + AST-fetching
  // island chunks), then wrap the app's production handler with the compiler's dev
  // server (Deno.watchFs + SSE + live AST). Template/CSS edits hot-swap in place
  // keeping island state; logic/server edits rebuild + reload.
  Deno.env.set("SPRIG_DEV", "1");
  // Dev build + assets live in a per-project temp cache, NOT <project>/static — so `sprig dev`
  // leaves the source tree clean. The same dir feeds the initial build, HMR rebuilds, and the
  // asset server (sprigUi assetsDir), so they all agree.
  const outDir = devCacheDir(appDir);
  await Deno.mkdir(outDir, { recursive: true });
  await build(appDir, true, outDir);
  // build the HMR base handler from the sprig APP itself — NOT the host's serve.ts (which
  // may be a Danet/other host with no { fetch } export). `sprig dev` serves /ui with HMR;
  // the host (serve.ts) is for `deno task start`.
  const { renderer, sprigApp } = await import(toFileUrl(join(resolve(appDir), "src", "mod.ts")).href);
  const ui = sprigUi({ app: sprigApp, base, assetsDir: outDir });
  const handler = {
    fetch: (req: Request, info: Deno.ServeHandlerInfo): Promise<Response> =>
      ui(req, info).then((r: Response | null) => r ?? new Response("Not Found", { status: 404 })),
  };
  const devSrv = createDevServer({ renderer, base, outDir, handler });
  const port = freePort(Number(Deno.env.get("PORT") ?? 8000));
  console.log(`sprig dev → http://localhost:${port}${base}  (HMR on; build cache: ${outDir})`);
  Deno.serve({ port }, (req: Request, info: Deno.ServeHandlerInfo) => devSrv.fetch(req, info));
}

async function init(dir = "."): Promise<void> {
  const appAbs = resolve(dir);
  // Refuse to scaffold OVER an existing project (never clobber the user's files): a
  // NAMED target that already exists is an error; the current dir (".") is refused only
  // when it is non-empty, so `sprig init` still works in a fresh, empty directory.
  if (dir === ".") {
    for await (const entry of Deno.readDir(appAbs)) {
      console.error(
        `sprig init: ${appAbs} is not empty (e.g. ${entry.name}) — run it in an empty directory or pass a new app name.`,
      );
      Deno.exit(1);
    }
  } else {
    try {
      await Deno.stat(appAbs);
      console.error(`sprig init: "${dir}" already exists — choose a new name or remove it first.`);
      Deno.exit(1);
    } catch (e) {
      if (!(e instanceof Deno.errors.NotFound)) throw e;
    }
  }
  const name = (dir === "." ? "sprig-app" : dir.split("/").pop()) || "sprig-app";

  const files: Record<string, string> = {
    // `$` IS the app (src/mod.ts); `$.pages/`, `$.services/`, `$.shared-components/` alias
    // the src subtrees so deep files import siblings without ../../ chains. Plus the two
    // sprig entry points (core + its /keep sub-export); the compiler is CLI-internal.
    "deno.json": `{
  "name": "@app/${name}",
  "version": "0.0.0",
  "exports": "./src/mod.ts",
  "compilerOptions": {
    "experimentalDecorators": true,
    "emitDecoratorMetadata": true,
    "lib": ["dom", "dom.asynciterable", "dom.iterable", "deno.ns", "esnext"]
  },
  "imports": {
    "$": "./src/mod.ts",
    "$.pages/": "./src/pages/",
    "$.shared-components/": "./src/shared-components/",
    "$.services/": "./src/services/",
    "@sprig/core": "jsr:@sprig/core@${SPRIG_RANGE}",
    "@sprig/keep": "jsr:@sprig/core@${SPRIG_RANGE}/keep",
    "@danet/core": "jsr:@danet/core@^2",
    "@std/path": "jsr:@std/path@^1",
    "@std/assert": "jsr:@std/assert@^1"
  },
  "tasks": {
    "dev": "sprig dev .",
    "build": "sprig build .",
    "start": "sprig serve bootstrap/mod.ts"
  }
}
`,

    "bootstrap/mod.ts": [
      `// Your host backend is Danet (jsr:@danet/core). The sprig UI mounts as MIDDLEWARE`,
      `// at /ui via app.use(ui): /ui/** → sprig (assets + SSR), everything else → your`,
      `// Danet controllers. Build first (\`deno task build\`), then \`deno task start\`.`,
      `import { DanetApplication, Module } from "@danet/core";`,
      `import { sprigUi } from "@sprig/keep";`,
      `import { sprigApp } from "$";`,
      ``,
      `// Your Danet app — add @Controller()s / providers here; they own every route but /ui.`,
      `@Module({})`,
      `class AppModule {}`,
      ``,
      `const ui = sprigUi({ app: sprigApp, base: "/ui" });`,
      ``,
      `const app = new DanetApplication();`,
      `app.use(async (ctx, next) => {`,
      `  const res = await ui(ctx.req.raw); // the raw Request`,
      `  if (res) return res; //              /ui → sprig`,
      `  await next(); //                     else → Danet`,
      `});`,
      `await app.init(AppModule);`,
      `await app.listen(Number(Deno.env.get("PORT") ?? 3000));`,
      ``,
    ].join("\n"),

    "src/mod.ts": [
      `// The whole app, three declarations. \`routes\` drive everything: a route's \`load\``,
      `// names a page folder (template.html + optional logic.ts class for its data/behavior)`,
      `// — no per-page imports, no module map. Add a page = add a route.`,
      `import {`,
      `  bootstrap,`,
      `  defineRoutes,`,
      `  type Route,`,
      `  type SprigApp,`,
      `} from "@sprig/core";`,
      `import { createRenderer } from "@sprig/keep";`,
      `import { dirname, fromFileUrl } from "@std/path";`,
      ``,
      `export const routes: Route[] = defineRoutes([`,
      `  { path: "", load: "pages/home" },`,
      `]);`,
      ``,
      `export const renderer = await createRenderer(`,
      `  dirname(fromFileUrl(import.meta.url)), // src/ root`,
      `  "/ui",`,
      `  { dev: !!Deno.env.get("SPRIG_DEV") },`,
      `);`,
      ``,
      `export const sprigApp: SprigApp = bootstrap({ routes, base: "/ui", renderer });`,
      ``,
    ].join("\n"),

    "bootstrap/template.html": [
      `<!-- Root layout. The matched page renders into the outlet. -->`,
      `<div class="app-root">`,
      `  <router-outlet></router-outlet>`,
      `</div>`,
      ``,
    ].join("\n"),

    "bootstrap/styles.css": [
      `:global(body) {`,
      `  margin: 0;`,
      `  font-family: ui-sans-serif, system-ui, sans-serif;`,
      `  background: #0b1020;`,
      `  color: #e7ecff;`,
      `}`,
      `.app-root { min-height: 100vh; display: grid; place-items: center; }`,
      ``,
    ].join("\n"),

    "src/pages/home/logic.ts": [
      `// A page is its template + this class. onServerInit runs on the server before the`,
      `// page renders — set fields here (fetch data via inject(Backend)) and the template`,
      `// binds to them. The instance is snapshotted to the browser; onBrowserInit runs there.`,
      `import { inject } from "@sprig/core";`,
      `import State from "$.services/state/mod.ts";`,
      ``,
      `export default class Home {`,
      `  name = "(loading…)";`,
      `  state = inject(State); // persisted across navigation + reload`,
      ``,
      `  onServerInit() {`,
      `    this.name = "sprig";`,
      `  }`,
      `}`,
      ``,
    ].join("\n"),

    "src/services/state/mod.ts": [
      `// Your app's persisted state. Add serializable fields and inject(State) anywhere`,
      `// (pages, islands). The framework serializes it to localStorage on every navigation`,
      `// and on reload, and restores it on load — so state survives both. state.reset()`,
      `// restores these defaults AND clears the saved copy in localStorage.`,
      `import { Injectable, StateService } from "@sprig/core";`,
      ``,
      `@Injectable({ providedIn: "root", scope: "both" })`,
      `export default class State extends StateService {`,
      `  static key = "app"; // stable localStorage key (class names are minified in prod)`,
      `  count = 0;`,
      `}`,
      ``,
    ].join("\n"),

    "src/pages/home/template.html": [
      `<!-- \`name\` comes from logic.ts (set in onServerInit) -->`,
      `<main class="home">`,
      `  <h1>Hello, {{ name }} 👋</h1>`,
      `  <p>Edit <code>src/pages/home/template.html</code> — \`sprig dev\` hot-swaps it.</p>`,
      `</main>`,
      ``,
    ].join("\n"),

    "src/pages/home/styles.css": [
      `.home { text-align: center; }`,
      `.home h1 { font-size: 2.4rem; letter-spacing: -0.03em; margin: 0 0 0.5rem; }`,
      `.home p { opacity: 0.7; }`,
      `.home code { background: #1b2440; border-radius: 5px; padding: 0.1em 0.4em; }`,
      ``,
    ].join("\n"),
  };

  await Deno.mkdir(appAbs, { recursive: true });
  for (const [path, content] of Object.entries(files)) {
    const abs = join(appAbs, path);
    await Deno.mkdir(dirname(abs), { recursive: true });
    await Deno.writeTextFile(abs, content);
  }
  // the `$.shared-components/` alias points here — create it (empty) so the dir exists.
  await Deno.mkdir(join(appAbs, "src", "shared-components"), { recursive: true });
  console.log(
    `Scaffolded a sprig app at ${appAbs}\n\n  cd ${dir}\n  deno task dev      # → http://localhost:8000/ui\n`,
  );
}

/** The Storybook-style component/page/island workbench: discover every component + its
 *  isolate/ cases, render a live preview per case, and serve the workbench UI (sidebar, stage,
 *  viewport controls, controls/console/tests). The UI (app/), its keep discovery + test-runner
 *  backend (server/), the orchestrator (cli/), and the composition root (serve.ts) are
 *  installed next to the framework by `sprig install`/`sprig update`; this delegates to the
 *  workbench's own dev runner. */
async function isolate(appDir = ".", open = true): Promise<void> {
  // the dir that holds framework/ — a repo checkout or ~/.sprig (both carry the workbench).
  const root = join(dirname(fromFileUrl(import.meta.url)), "..");
  await assertWorkbench(root); // clear "run `sprig update`" error if an old slim install lacks it
  const appAbs = resolve(appDir);
  const port = freePort(Number(Deno.env.get("PORT") ?? 8000));
  // hand off to the workbench dev runner: discover → generate a preview per case → build the
  // app → serve serve.ts (UI + keep backend) under ISOLATE_PROJECT. The same flow that powers
  // the live workbench; we just point it at `appAbs` on a free port.
  const { code } = await new Deno.Command(Deno.execPath(), {
    args: [
      "run", "-A", "--config", join(root, "deno.json"), join(root, "cli", "main.ts"),
      "dev", "--root", appAbs, ...(open ? [] : ["--no-open"]),
    ],
    cwd: root,
    env: { ...Deno.env.toObject(), PORT: String(port) },
    stdin: "inherit",
    stdout: "inherit",
    stderr: "inherit",
  }).output();
  Deno.exit(code);
}

/** Read this install's own version from its package deno.json (`..` from framework/cli.ts —
 *  the install root, both in a checkout and in ~/.sprig). Returns "?" if it can't be read. */
async function localVersion(): Promise<string> {
  try {
    const cfgPath = join(dirname(fromFileUrl(import.meta.url)), "..", "deno.json");
    const cfg = JSON.parse(await Deno.readTextFile(cfgPath));
    return typeof cfg.version === "string" ? cfg.version : "?";
  } catch {
    return "?";
  }
}

/** The latest published @sprig/core version on JSR, or null if the network/registry is
 *  unreachable (so `sprig -v` still prints the local version offline). */
async function jsrLatestVersion(): Promise<string | null> {
  try {
    const res = await fetch("https://jsr.io/@sprig/core/meta.json", {
      signal: AbortSignal.timeout(3000),
    });
    if (!res.ok) return null;
    const meta = await res.json();
    return typeof meta.latest === "string" ? meta.latest : null;
  } catch {
    return null;
  }
}

/** Compare two semver-ish `a.b.c` strings. Returns >0 if `a` is newer than `b`. */
function compareVersions(a: string, b: string): number {
  const pa = a.split(".").map((n) => parseInt(n, 10) || 0);
  const pb = b.split(".").map((n) => parseInt(n, 10) || 0);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const d = (pa[i] ?? 0) - (pb[i] ?? 0);
    if (d !== 0) return d;
  }
  return 0;
}

/** `sprig -v` / `--version`: print this install's version, then check JSR and, if a newer
 *  release exists, print a colored upgrade notice with the `sprig update` hint. */
async function version(): Promise<void> {
  const local = await localVersion();
  console.log(`sprig ${local}`);
  const latest = await jsrLatestVersion();
  if (latest && local !== "?" && compareVersions(latest, local) > 0) {
    const G = "\x1b[32m", B = "\x1b[1m", C = "\x1b[36m", R = "\x1b[0m";
    console.log(
      `\n${G}${B}A new version of sprig is available: ${local} → ${latest}${R}\n` +
        `${G}Run ${C}sprig update${G} to upgrade.${R}`,
    );
  }
}

/** Refresh this machine to the latest deployment: download the source bundle to ~/.sprig,
 *  `deno install` its node_modules HERE, reinstall skills, and re-point the `sprig`
 *  launcher — NOT from any local checkout. */
async function update(): Promise<void> {
  await installRuntimeFromDeployment();
  console.log("✓ sprig is up to date (runtime + skills). Run 'sprig --help'.");
}

/** First-time install. `--dev` wires the launcher to THIS checkout (for repo devs, e.g.
 *  `deno task install:dev`); otherwise download + set up the runtime at ~/.sprig from the
 *  deployment. Both install the Claude Code skills into ${CLAUDE_SKILLS_DIR:-~/.claude/skills}. */
async function install(dev: boolean): Promise<void> {
  if (dev) {
    const repoRoot = join(dirname(fromFileUrl(import.meta.url)), ".."); // framework/ -> repo root
    await installRuntimeFromWorkingTree(repoRoot);
  } else {
    await installRuntimeFromDeployment();
  }
  console.log("✓ sprig installed (runtime + skills). Run 'sprig --help'.");
}

const USAGE = `sprig — the framework CLI

  sprig init  [dir]              scaffold a minimal, runnable sprig app (default: .)
  sprig dev   [appDir]           state-preserving HMR dev server → /ui (default: .)
  sprig build [appDir]           code-split islands + scope CSS + Tailwind → static/ (default: .)
  sprig isolate [appDir]         component/page workbench — develop in isolation (default: .)
  sprig serve [entry]            run the app's host entry under its deno.json (default: serve.ts)
  sprig install [--dev]          install the global sprig CLI + Claude Code skills (--dev: from this checkout)
  sprig update                   re-install the global sprig CLI + skills from the latest release
  sprig -v, --version            print the installed version + check JSR for a newer release
  sprig help
`;

const [cmd, ...rest] = Deno.args;
switch (cmd) {
  case "init":
    await init(rest[0]);
    break;
  case "build":
    await build(rest[0], rest.includes("--dev"));
    break;
  case "dev":
    await dev(rest[0], rest[1]);
    break;
  case "serve":
    await serve(rest[0]);
    break;
  case "update":
    await update();
    break;
  case "install":
    await install(rest.includes("--dev"));
    break;
  case "-v":
  case "--version":
  case "version":
    await version();
    break;
  case "isolate": {
    const appArg = rest.find((a) => !a.startsWith("-")) ?? ".";
    await isolate(appArg, !rest.includes("--no-open"));
    break;
  }
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
