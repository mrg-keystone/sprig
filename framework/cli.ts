#!/usr/bin/env -S deno run -A
/**
 * `sprig` — the framework CLI.
 *
 *   sprig init [dir]            scaffold a minimal, runnable sprig app
 *   sprig dev  [appDir] [entry] state-preserving HMR dev server (no Vite)
 *   sprig build [appDir]        code-split islands + scope CSS + Tailwind → static/
 *   sprig serve [entry]         boot a serve.ts (its default export is a { fetch } handler)
 *   sprig help
 *
 * The framework runtime lives next to this file at ./.sprig (core + compiler).
 */
import { dirname, fromFileUrl, join, resolve, toFileUrl } from "@std/path";

const HERE = dirname(fromFileUrl(import.meta.url)); // framework/
const SPRIG = join(HERE, ".sprig"); // framework/.sprig
const KEEP = join(HERE, "..", "packages", "keep", "mod.ts");

// an ABSOLUTE file:// specifier — stable regardless of where the app is scaffolded
// (a relative path back to the framework breaks once the app moves; abs file:// doesn't).
const fileUrl = (base: string, ...rest: string[]): string => toFileUrl(join(base, ...rest)).href;

async function build(appDir = "app", dev = false): Promise<void> {
  const { buildClient } = await import(join(SPRIG, "compiler", "build.ts"));
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
  const mod = await import(`file://${join(Deno.cwd(), entry)}`) as {
    default?: { fetch?: Deno.ServeHandler };
  };
  const app = mod.default;
  if (!app?.fetch) {
    console.error(`${entry} must \`export default\` an object with fetch(req, info).`);
    Deno.exit(1);
  }
  Deno.serve((req, info) => app.fetch!(req, info));
}

async function dev(appDir = "app", base = "/ui"): Promise<void> {
  // State-preserving HMR (no Vite): build the dev bundle (HMR client + AST-fetching
  // island chunks), then wrap the app's production handler with the compiler's dev
  // server (Deno.watchFs + SSE + live AST). Template/CSS edits hot-swap in place
  // keeping island state; logic/server edits rebuild + reload.
  Deno.env.set("SPRIG_DEV", "1");
  await build(appDir, true);
  // build the HMR base handler from the sprig APP itself — NOT the host's serve.ts (which
  // may be a Danet/other host with no { fetch } export). `sprig dev` serves /ui with HMR;
  // the host (serve.ts) is for `deno task start`.
  const { renderer, app } = await import(`file://${join(resolve(appDir), "src", "main.ts")}`);
  const { sprigUi } = await import(`file://${KEEP}`);
  const ui = sprigUi({ app, base });
  const handler = {
    fetch: (req: Request, info: Deno.ServeHandlerInfo): Promise<Response> =>
      ui(req, info).then((r: Response | null) => r ?? new Response("Not Found", { status: 404 })),
  };
  const { createDevServer } = await import(join(SPRIG, "compiler", "dev.ts"));
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
  const name = (dir === "." ? "sprig-app" : dir.split("/").pop()) || "sprig-app";

  const files: Record<string, string> = {
    "deno.json": JSON.stringify(
      {
        name: `@app/${name}`,
        version: "0.0.0",
        exports: "./src/main.ts",
        compilerOptions: {
          experimentalDecorators: true,
          emitDecoratorMetadata: true,
          lib: ["dom", "dom.asynciterable", "dom.iterable", "deno.ns", "esnext"],
        },
        imports: {
          // ABSOLUTE file:// — stable wherever this app is scaffolded (until @sprig/* is
          // published to JSR, at which point these become jsr:@sprig/...). The app needs
          // only these two: core (runtime primitives) + keep (server: the SSR renderer +
          // the /ui mount). The compiler/build is CLI-internal — the app never imports it.
          "@sprig/core": fileUrl(SPRIG, "core.ts"),
          "@sprig/keep": toFileUrl(KEEP).href,
          "@danet/core": "jsr:@danet/core@^2",
          "@preact/signals-core": "npm:@preact/signals-core@^1.8.0",
          "web-tree-sitter": "npm:web-tree-sitter@^0.25",
          "@std/path": "jsr:@std/path@^1",
          "@std/fs": "jsr:@std/fs@^1",
          "@std/assert": "jsr:@std/assert@^1",
        },
        tasks: {
          dev: `deno run -A ${toFileUrl(join(HERE, "cli.ts")).href} dev .`,
          build: `deno run -A ${toFileUrl(join(HERE, "cli.ts")).href} build .`,
          start: "deno run -A serve.ts",
        },
      },
      null,
      2,
    ) + "\n",

    "serve.ts": [
      `// Your host backend is Danet (jsr:@danet/core). The sprig UI mounts as MIDDLEWARE`,
      `// at /ui via app.use(ui): /ui/** → sprig (assets + SSR), everything else → your`,
      `// Danet controllers. Build first (\`deno task build\`), then \`deno task start\`.`,
      `import { DanetApplication, Module } from "@danet/core";`,
      `import { sprigUi } from "@sprig/keep";`,
      `import { app as sprigApp } from "./src/main.ts";`,
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

    "src/main.ts": [
      `// Route table + app. Each page's resolve.ts loads data; the prebuilt template`,
      `// registry (static/templates.json) renders the matched folder-component — no`,
      `// tree-sitter at runtime.`,
      `import { bootstrap, defineRoutes, type Route, type SprigApp } from "@sprig/core";`,
      `import { createRenderer, type SsrRenderer } from "@sprig/keep";`,
      `import { dirname, fromFileUrl } from "@std/path";`,
      `import { resolve as homeResolve } from "./pages/home/resolve.ts";`,
      ``,
      `export const routes: Route[] = defineRoutes([`,
      `  { path: "", load: "./pages/home" },`,
      `]);`,
      ``,
      `export const renderer: SsrRenderer = await createRenderer(`,
      `  dirname(fromFileUrl(import.meta.url)),`,
      `  "/ui",`,
      `  { dev: !!Deno.env.get("SPRIG_DEV") },`,
      `);`,
      ``,
      `export const app: SprigApp = bootstrap({`,
      `  routes,`,
      `  base: "/ui",`,
      `  modules: { "./pages/home": { resolve: homeResolve } },`,
      `  render: (load, inputs) => renderer.renderDocument(load, inputs),`,
      `});`,
      ``,
    ].join("\n"),

    "src/shell/template.html": [
      `<!-- Root layout. The matched page renders into the outlet. -->`,
      `<div class="app-root">`,
      `  <router-outlet></router-outlet>`,
      `</div>`,
      ``,
    ].join("\n"),

    "src/shell/styles.css": [
      `:global(body) {`,
      `  margin: 0;`,
      `  font-family: ui-sans-serif, system-ui, sans-serif;`,
      `  background: #0b1020;`,
      `  color: #e7ecff;`,
      `}`,
      `.app-root { min-height: 100vh; display: grid; place-items: center; }`,
      ``,
    ].join("\n"),

    "src/pages/home/resolve.ts": [
      `import type { Resolve } from "@sprig/core";`,
      ``,
      `export const resolve: Resolve = () => ({ name: "sprig" });`,
      ``,
    ].join("\n"),

    "src/pages/home/template.html": [
      `<!-- @input \`name\` from resolve.ts -->`,
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
  console.log(
    `Scaffolded a sprig app at ${appAbs}\n\n  cd ${dir}\n  deno task dev      # → http://localhost:8000/ui\n`,
  );
}

const USAGE = `sprig — the framework CLI

  sprig init  [dir]              scaffold a minimal, runnable sprig app (default: .)
  sprig dev   [appDir] [entry]   state-preserving HMR dev server (default: app, serve.ts)
  sprig build [appDir]           code-split islands + scope CSS + Tailwind → static/ (default: app)
  sprig serve [entry]            boot a serve.ts's default { fetch } handler (default: serve.ts)
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
