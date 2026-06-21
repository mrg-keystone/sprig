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
import { dirname, fromFileUrl, join, relative, resolve } from "@std/path";

const HERE = dirname(fromFileUrl(import.meta.url)); // framework/
const SPRIG = join(HERE, ".sprig"); // framework/.sprig
const KEEP = join(HERE, "..", "packages", "keep", "mod.ts");

const rel = (from: string, to: string): string => {
  const r = relative(from, to).replace(/\\/g, "/");
  return r.startsWith(".") ? r : "./" + r;
};

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

async function dev(appDir = "app", entry = "serve.ts", base = "/ui"): Promise<void> {
  // State-preserving HMR (no Vite): build the dev bundle (HMR client + AST-fetching
  // island chunks), then wrap the app's production handler with the compiler's dev
  // server (Deno.watchFs + SSE + live AST). Template/CSS edits hot-swap in place
  // keeping island state; logic/server edits rebuild + reload.
  Deno.env.set("SPRIG_DEV", "1");
  await build(appDir, true);
  const prod = (await import(`file://${join(Deno.cwd(), entry)}`)).default;
  const { renderer } = await import(`file://${join(resolve(appDir), "src", "main.ts")}`);
  const { createDevServer } = await import(join(SPRIG, "compiler", "dev.ts"));
  const devSrv = createDevServer({
    renderer,
    base,
    outDir: join(Deno.cwd(), "static"),
    handler: prod,
  });
  const port = Number(Deno.env.get("PORT") ?? 8000);
  console.log(`sprig dev → http://localhost:${port}${base}  (HMR on; edit templates/CSS, island state is preserved)`);
  Deno.serve({ port }, (req: Request, info: Deno.ServeHandlerInfo) => devSrv.fetch(req, info));
}

async function init(dir = "."): Promise<void> {
  const appAbs = resolve(dir);
  const name = (dir === "." ? "sprig-app" : dir.split("/").pop()) || "sprig-app";
  const coreRel = rel(appAbs, join(SPRIG, "core.ts"));
  const keepRel = rel(appAbs, KEEP);
  const compilerRel = rel(join(appAbs, "src"), join(SPRIG, "compiler", "mod.ts"));
  const buildRel = rel(appAbs, join(SPRIG, "compiler", "build.ts"));

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
          "@sprig/core": coreRel,
          "@sprig/keep": keepRel,
          "@preact/signals-core": "npm:@preact/signals-core@^1.8.0",
          "web-tree-sitter": "npm:web-tree-sitter@^0.25",
          "@std/path": "jsr:@std/path@^1",
          "@std/fs": "jsr:@std/fs@^1",
          "@std/assert": "jsr:@std/assert@^1",
        },
        tasks: {
          dev: `deno run -A ${rel(appAbs, join(HERE, "cli.ts"))} dev .`,
          build: `deno run -A ${rel(appAbs, join(HERE, "cli.ts"))} build .`,
          start: "deno serve -A serve.ts",
        },
      },
      null,
      2,
    ) + "\n",

    "build.ts": [
      `// Build this sprig app: code-split islands + scope CSS + Tailwind → static/.`,
      `import { buildClient } from "${buildRel}";`,
      `import { dirname, fromFileUrl, join } from "@std/path";`,
      ``,
      `const here = dirname(fromFileUrl(import.meta.url));`,
      `const r = await buildClient(join(here, "src"), join(Deno.cwd(), "static"), {`,
      `  dev: Deno.args.includes("--dev"),`,
      `});`,
      `console.log(\`sprig build: \${r.islands.length} island(s) [\${r.islands.join(", ")}], v=\${r.hash}\`);`,
      ``,
    ].join("\n"),

    "serve.ts": [
      `// The single-origin handler. serveSprig mounts the sprig UI at \`base\` and`,
      `// serves the built assets. This starter has no backend, so it passes a no-op`,
      `// keep; wire a real keep \`api\` here (serveSprig({ keep: api, app, base })) to`,
      `// get an in-process Backend for resolve.ts + the /api/* network channel.`,
      `import { serveSprig } from "@sprig/keep";`,
      `import { app } from "./src/main.ts";`,
      ``,
      `const keep = {`,
      `  backend: { fetch: () => Promise.resolve(new Response("null", { headers: { "content-type": "application/json" } })) },`,
      `  handler: () => new Response("Not Found", { status: 404 }),`,
      `};`,
      ``,
      `export default serveSprig({ keep, app, base: "/ui" });`,
      ``,
    ].join("\n"),

    "src/main.ts": [
      `// Route table + app. Each page's resolve.ts loads data; the wasm-backed`,
      `// template compiler renders the matched folder-component into the shell outlet.`,
      `import { bootstrap, defineRoutes, type Route, type SprigApp } from "@sprig/core";`,
      `import { dirname, fromFileUrl } from "@std/path";`,
      `import { createRenderer, type SsrRenderer } from "${compilerRel}";`,
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
    await dev(rest[0], rest[1], rest[2]);
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
