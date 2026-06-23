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
import { basename, dirname, fromFileUrl, join, relative, resolve, toFileUrl } from "@std/path";
import { walk } from "@std/fs/walk";
// static relative imports of the package's own modules (computed-path dynamic imports
// are unanalyzable + don't resolve once this is published to JSR).
import { buildClient } from "./.sprig/compiler/build.ts";
import { createDevServer } from "./.sprig/compiler/dev.ts";
import { createRenderer, sprigUi } from "../packages/keep/mod.ts";
import { bootstrap, defineRoutes } from "./.sprig/core.ts";
import { installRuntimeFromDeployment, installRuntimeFromWorkingTree } from "./.sprig/install.ts";

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
  const { code } = await new Deno.Command(Deno.execPath(), {
    args: ["run", "-A", "--config", mergedPath, fromFileUrl(import.meta.url), ...Deno.args],
    env: { ...Deno.env.toObject(), SPRIG_MERGED: "1" },
    stdin: "inherit",
    stdout: "inherit",
    stderr: "inherit",
  }).output();
  Deno.exit(code);
}

async function build(appDir = ".", dev = false): Promise<void> {
  const srcDir = join(resolve(appDir), "src");
  const outDir = join(Deno.cwd(), "static");
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
  await build(appDir, true);
  // build the HMR base handler from the sprig APP itself — NOT the host's serve.ts (which
  // may be a Danet/other host with no { fetch } export). `sprig dev` serves /ui with HMR;
  // the host (serve.ts) is for `deno task start`.
  const { renderer, sprigApp } = await import(toFileUrl(join(resolve(appDir), "src", "mod.ts")).href);
  const ui = sprigUi({ app: sprigApp, base });
  const handler = {
    fetch: (req: Request, info: Deno.ServeHandlerInfo): Promise<Response> =>
      ui(req, info).then((r: Response | null) => r ?? new Response("Not Found", { status: 404 })),
  };
  const devSrv = createDevServer({
    renderer,
    base,
    outDir: join(Deno.cwd(), "static"),
    handler,
  });
  const port = Number(Deno.env.get("PORT") ?? 8000);
  console.log(`sprig dev → http://localhost:${port}${base}  (HMR on; edit templates/CSS, island state is preserved)`);
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

/** The component/page workbench: discover every folder-component, render each one in
 *  ISOLATION (a generated wrapper page per component; pages render directly), and serve a
 *  picker. Reuses the framework — no separate workbench app. Generated previews live in a
 *  gitignorable `src/_isolate/`. */
async function isolate(appDir = "."): Promise<void> {
  await withMergedConfig(appDir);
  Deno.env.set("SPRIG_DEV", "1");
  const root = resolve(appDir);
  const srcDir = join(root, "src");
  const isoDir = join(srcDir, "_isolate");
  await Deno.remove(isoDir, { recursive: true }).catch(() => {}); // clear stale previews

  const found: { sel: string; load: string; kind: "page" | "component" }[] = [];
  for await (const e of walk(srcDir, { match: [/[/\\]template\.html$/], includeDirs: false })) {
    const dir = dirname(e.path);
    const rel = relative(srcDir, dir).replace(/\\/g, "/");
    const sel = basename(dir);
    if (sel === "shell" || rel.startsWith("_isolate")) continue;
    if (basename(dirname(dir)) === "pages") {
      found.push({ sel, load: rel, kind: "page" }); // a page renders directly
    } else {
      // a component renders inside a generated wrapper page: <sel></sel>. The wrapper folder
      // is `iso-<sel>` so its selector never collides with the real component's.
      const pdir = join(isoDir, `iso-${sel}`);
      await Deno.mkdir(pdir, { recursive: true });
      await Deno.writeTextFile(join(pdir, "template.html"), `<main class="iso-stage"><${sel}></${sel}></main>\n`);
      found.push({ sel, load: `_isolate/iso-${sel}`, kind: "component" });
    }
  }
  found.sort((a, b) => a.sel.localeCompare(b.sel));
  const links = found
    .map((f) => `<li><a href="/ui/${f.sel}">${f.sel}</a> <small>${f.kind}</small></li>`)
    .join("\n  ");
  const idx = join(isoDir, "iso--index");
  await Deno.mkdir(idx, { recursive: true });
  await Deno.writeTextFile(
    join(idx, "template.html"),
    `<main class="iso-index"><h1>isolate</h1><p>${found.length} component(s)</p>\n<ul>\n  ${links}\n</ul></main>\n`,
  );

  await build(appDir, true);
  const renderer = await createRenderer(srcDir, "/ui", { dev: true });
  const routes = defineRoutes([
    { path: "", load: "_isolate/iso--index" },
    ...found.map((f) => ({ path: f.sel, load: f.load })),
  ]);
  const app = bootstrap({ routes, base: "/ui", renderer });
  const ui = sprigUi({ app, base: "/ui" });
  const handler = {
    fetch: (req: Request, info: Deno.ServeHandlerInfo): Promise<Response> =>
      ui(req, info).then((r: Response | null) => r ?? new Response("Not Found", { status: 404 })),
  };
  // serve through the dev server so islands get their AST endpoint + HMR (edit a component
  // and the isolated preview hot-reloads), exactly like `sprig dev`.
  const devSrv = createDevServer({ renderer, base: "/ui", outDir: join(Deno.cwd(), "static"), handler });
  const port = Number(Deno.env.get("PORT") ?? 8000);
  console.log(`sprig isolate → http://localhost:${port}/ui  (${found.length} component(s) in isolation, HMR on)`);
  Deno.serve({ port }, (req: Request, info: Deno.ServeHandlerInfo) => devSrv.fetch(req, info));
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
  case "isolate":
    await isolate(rest[0]);
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
