#!/usr/bin/env -S deno run -A
/**
 * `sprig` — the framework CLI.
 *
 *   sprig init [dir]            scaffold a minimal, runnable sprig app
 *   sprig dev  [appDir] [--annotate <html>]  HMR dev server (no Vite) → ALWAYS serves the click-to-edit overlay +
 *                                  isolate workbench (full app); --annotate <html> annotates one prototype file instead
 *   sprig build [appDir]        code-split islands + scope CSS + Tailwind → static/
 *   sprig serve [entry]         run the app's host entry (e.g. bootstrap/serve.ts)
 *   sprig help
 *
 * The framework runtime lives next to this file at ./.sprig (core + compiler).
 */
import { basename, dirname, join, relative, resolve, toFileUrl } from "@std/path";
// static relative imports of the package's own modules (computed-path dynamic imports
// are unanalyzable + don't resolve once this is published to JSR).
import { buildClient, forcedImportMap } from "./.sprig/compiler/build.ts";
import { createDevServer } from "./.sprig/compiler/dev.ts";
import { serveSprig, sprigUi } from "../packages/keep/mod.ts";
import { assertWorkbench, installRuntimeFromDeployment, installRuntimeFromWorkingTree, latestRuntimeRelease } from "./.sprig/install.ts";
import { specRootOf } from "./.sprig/spec-root.ts";
// NOTE: `./.sprig/annotate.ts` is imported LAZILY (a dynamic `import(...)` inside the `dev`
// handlers), never statically — so `build` / `--help` / `isolate` don't pull the annotate overlay
// machinery onto their load path, and a future top-level hazard in it can't poison every command.

// the published-package version range a scaffolded app pins (core + its /keep + /cli
// sub-exports all ship from @sprig/core). Bump in lockstep with the published version.
const SPRIG_RANGE = "^0.12.0";

/** This CLI's on-disk install root — the dir holding `framework/` (a repo checkout or `~/.sprig`).
 *  `import.meta.dirname` is `<install>/framework` for a `file://` module and `undefined` for a
 *  remote (`jsr:`/`https:`) one — it NEVER throws, unlike `fromFileUrl(import.meta.url)`. The
 *  compiler/install machinery needs files on disk, so a remote module URL means "running straight
 *  from jsr: with nothing set up yet": exit with a clear, actionable message instead of a cryptic
 *  `URL must be a file URL` deep in the call stack. */
function installRoot(): string {
  const fwDir = import.meta.dirname;
  if (!fwDir) {
    console.error(
      "sprig: this command needs the on-disk runtime — it can't run straight from jsr:.\n" +
        "  Run `sprig install` (or `sprig update`) to set up ~/.sprig, then re-run `sprig`.",
    );
    Deno.exit(1);
  }
  return join(fwDir, "..");
}

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

/** Identify an annotate server already answering on `port` (its mode + file), or null. Lets a
 *  relaunch REUSE the running one (same URL) instead of drifting to a new port — the fix for
 *  "the annotate port keeps switching." */
async function annotatePing(port: number): Promise<{ ok: true; mode?: string; file?: string } | null> {
  try {
    const r = await fetch(`http://localhost:${port}/__annotate/ping`, { signal: AbortSignal.timeout(500) });
    if (!r.ok) return null;
    const j = await r.json().catch(() => null);
    return j && j.ok === true ? j : null;
  } catch {
    return null;
  }
}
/** Is `port` bindable right now? (probe-listen, like freePort, but a boolean.) */
function portIsFree(port: number): boolean {
  try {
    Deno.listen({ port }).close();
    return true;
  } catch {
    return false;
  }
}

/** A STABLE, uncommon annotate port derived from the app/prototype name (FNV-1a → 20000–28999):
 *  the same app always lands on the same port (URL never switches), different apps don't collide,
 *  and the band is clear of common dev ports (3000/5173/8000/8080) and below both macOS and Linux
 *  ephemeral ranges so binds don't race the OS. PORT env still overrides. */
function appPort(seed: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < seed.length; i++) {
    h ^= seed.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return 20000 + ((h >>> 0) % 9000);
}

/** Open a URL in the default browser (best-effort; silent on headless/CI). */
function openUrl(url: string): void {
  const cmd = Deno.build.os === "darwin" ? "open" : Deno.build.os === "windows" ? "explorer" : "xdg-open";
  try {
    new Deno.Command(cmd, { args: [url], stdout: "null", stderr: "null" }).spawn();
  } catch { /* ignore */ }
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
  const installDir = installRoot();
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
  const installDir = installRoot(); // framework/ → install root (file:// guaranteed by the guard above)
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
      // import.meta.filename is the file:// path of THIS module — defined here because the early
      // `!import.meta.url.startsWith("file:")` guard already returned for a remote module.
      args: ["run", "-A", "--config", mergedPath, import.meta.filename!, ...Deno.args],
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

async function build(appDir = ".", dev = false, outDir = join(Deno.cwd(), "static"), rune = false): Promise<void> {
  // --rune: consolidate the workspace config FIRST (pin @sprig at the root, strip it from every
  // member) so the client build sees pin-free members that inherit the ONE root runtime — a
  // member's own pin would scope its islands to a second copy (dual-core). Must precede buildClient.
  if (rune) await emitRuneComposition(appDir, outDir);
  const srcDir = join(resolve(appDir), "src");
  const r = await buildClient(srcDir, outDir, { dev });
  console.log(
    `sprig build${dev ? " (dev)" : ""}: ${r.islands.length} island chunk(s) ` +
      `[${r.islands.join(", ")}] + ${r.chunks.length} shared chunk(s) → ${outDir} ` +
      `(${(r.bytes / 1024).toFixed(1)}kb, v=${r.hash})`,
  );
}

/** Recursively collect the app's own `.ts` files (skipping tests, isolate scaffolding, and
 *  node_modules) — the graph `sprig check` typechecks. */
async function collectTs(dir: string, out: string[] = []): Promise<string[]> {
  for await (const e of Deno.readDir(dir)) {
    const p = join(dir, e.name);
    if (e.isDirectory) {
      if (e.name === "isolate" || e.name === "_isolate" || e.name === "node_modules") continue;
      await collectTs(p, out);
    } else if (e.isFile && e.name.endsWith(".ts") && !e.name.endsWith(".test.ts")) {
      out.push(p);
    }
  }
  return out;
}

/** `sprig check` — typecheck the app under the SAME forced import map the build uses
 *  (@sprig/core → the CLI's one runtime). This REPLACES a standalone `deno check` once an app
 *  drops its @sprig/core pin (the CLI is the sole runtime owner): the app authors against the
 *  @sprig/core interface, the CLI supplies the one implementation, so what typechecks is
 *  exactly what builds — there is no second copy to drift against. */
async function check(appDir = "."): Promise<void> {
  const srcDir = join(resolve(appDir), "src");
  if (!(await pathExists(srcDir))) {
    console.error(`sprig check: no src/ under ${resolve(appDir)}`);
    Deno.exit(1);
  }
  const tmp = await Deno.makeTempDir({ prefix: "sprig-check-" });
  // A temp deno.json carrying BOTH the forced runtime imports AND the app's compilerOptions —
  // islands run in the browser, so the app's `lib` (dom) + decorator options must apply or
  // valid island code (e.g. `setInterval` → number, class decorators) mis-typechecks. --config
  // uses this file's `imports` as the import map, so there's one source, no --import-map clash.
  const cfgPath = join(tmp, "deno.json");
  await Deno.writeTextFile(
    cfgPath,
    JSON.stringify({
      compilerOptions: await appCompilerOptions(srcDir),
      imports: (await forcedImportMap(srcDir)).imports,
    }),
  );
  const files = await collectTs(srcDir);
  try {
    if (files.length === 0) {
      console.log(`sprig check: no .ts files under ${srcDir}`);
      return;
    }
    const res = await new Deno.Command("deno", {
      args: ["check", "--config", cfgPath, ...files],
      stdout: "inherit",
      stderr: "inherit",
    }).output();
    if (!res.success) Deno.exit(1);
    console.log(`sprig check: ${files.length} file(s) typecheck clean under the CLI runtime.`);
  } finally {
    await Deno.remove(tmp, { recursive: true }).catch(() => {});
  }
}

/** The app's `compilerOptions` (nearest deno.json up from `srcDir`) — islands need the app's
 *  `lib`/decorator settings to typecheck the way they'll run. Empty when none is declared. */
async function appCompilerOptions(srcDir: string): Promise<Record<string, unknown>> {
  let dir = resolve(srcDir);
  for (;;) {
    for (const name of ["deno.json", "deno.jsonc"]) {
      const p = join(dir, name);
      if (await pathExists(p)) {
        const cfg = await readJson(p);
        if (cfg?.compilerOptions) return cfg.compilerOptions as Record<string, unknown>;
        break;
      }
    }
    const parent = dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return {};
}

async function pathExists(p: string): Promise<boolean> {
  try {
    await Deno.stat(p);
    return true;
  } catch {
    return false;
  }
}

async function readJson(p: string): Promise<Record<string, unknown> | null> {
  try {
    return JSON.parse(await Deno.readTextFile(p)) as Record<string, unknown>;
  } catch {
    return null;
  }
}

/** Where to place serve.ts + the workspace. Prefers the nearest `.git` ancestor (a normal
 *  dev / CI checkout). With NO `.git` anywhere above — e.g. a DEPLOY build unpacked from a
 *  tarball — it falls back to the convention: the sprig UI package is a literal `./ui`, so its
 *  parent is the project root. Errors only when there is neither a `.git` ancestor NOR a `./ui`
 *  to anchor on (never errors just because `.git` is missing). */
function findProjectRoot(uiAbs: string): string {
  // 1. nearest `.git` ancestor — a real clone has a `.git` dir, a worktree a `.git` FILE, so
  //    test for existence, not type (mirrors specRootOf, but it's fine if there is none).
  let d = uiAbs;
  while (true) {
    try {
      Deno.statSync(join(d, ".git"));
      return d;
    } catch { /* no `.git` here — keep walking up */ }
    const parent = dirname(d);
    if (parent === d) break; // reached the filesystem root with no `.git`
    d = parent;
  }
  // 2. no `.git` at all (deploy env): the parent of a `./ui` package is the project root.
  if (basename(uiAbs) === "ui") return dirname(uiAbs);
  // 3. nothing to anchor on — this is the only case that errors.
  console.error(
    `sprig build --rune: cannot locate the project root for\n  ${uiAbs}\n` +
      `  No .git ancestor, and the sprig UI package is not a ./ui. In an environment without\n` +
      `  git, place the sprig UI in a ./ui directly under the project root so --rune can put\n` +
      `  serve.ts + the workspace there.`,
  );
  Deno.exit(1);
}

/** `--rune`: after building the client assets, fold the sibling rune/keep backend and this
 *  sprig UI into ONE deployable composition AT THE GIT ROOT — a generated `serve.ts`
 *  (the serveSprig { fetch } default export) plus a Deno workspace in the root deno.json so
 *  each half keeps its own import map. serveSprig binds keep's in-process Backend, so the
 *  UI's resolve.ts reads data with no TCP and no token. Idempotent: safe after every build. */
async function emitRuneComposition(appDir: string, outDir: string): Promise<void> {
  const uiAbs = resolve(appDir);
  const gitRoot = findProjectRoot(uiAbs);
  if (gitRoot === uiAbs) {
    console.error(
      `sprig build --rune: ${uiAbs} has no project root ABOVE it (it is its own .git root and is\n` +
        `not a ./ui under a parent). --rune composes a monorepo whose sprig UI + rune backend are\n` +
        `siblings — run it from such a repo, or place the sprig UI in a ./ui under the project root.`,
    );
    Deno.exit(1);
  }
  const uiRel = relative(gitRoot, uiAbs).replace(/\\/g, "/");
  const assetsRel = relative(gitRoot, outDir).replace(/\\/g, "/") || "static";
  const serverRel = await detectBackendDir(gitRoot, uiRel);
  await writeRuneServe(gitRoot, uiRel, serverRel, assetsRel);
  await ensureRuneWorkspace(gitRoot, uiRel, serverRel);
  const envHint = (await pathExists(join(gitRoot, ".env"))) ? " --env-file=.env" : "";
  console.log(
    `sprig build --rune: composed ${serverRel}/ (keep) + ${uiRel}/ (sprig) → ${join(gitRoot, "serve.ts")}\n` +
      `  + Deno workspace in ${join(gitRoot, "deno.json")} (members ./${uiRel}, ./${serverRel})\n` +
      `  run it from the git root:  deno serve -A${envHint} serve.ts`,
  );
}

/** A sprig UI package is a dir with src/mod.ts (the `bootstrap({ routes })` export). A keep
 *  backend has no src/mod.ts (its entry is bootstrap/mod.ts), so this cleanly tells them
 *  apart — note BOTH may have a bootstrap/, so that can't be the discriminator. */
async function isSprigUiDir(dir: string): Promise<boolean> {
  return await pathExists(join(dir, "src", "mod.ts"));
}

/** Resolve the sprig UI package to build for `--rune`. If `appArg` itself is a UI package
 *  (run from ui/), use it; otherwise (run from the git root) find the one UI package among
 *  the workspace members / immediate subdirs. Errors clearly on none / ambiguous. */
async function resolveRuneUiDir(appArg: string): Promise<string> {
  const abs = resolve(appArg);
  if (await isSprigUiDir(abs)) return abs;
  const found: string[] = [];
  const cfg = await readJson(join(abs, "deno.json"));
  const members = Array.isArray(cfg?.workspace) ? cfg!.workspace as string[] : [];
  const scan = members.length ? members.map((m) => resolve(abs, m)) : [];
  if (!scan.length) {
    for await (const e of Deno.readDir(abs)) {
      if (e.isDirectory && !e.name.startsWith(".")) scan.push(join(abs, e.name));
    }
  }
  for (const d of scan) if (await isSprigUiDir(d)) found.push(d);
  if (found.length === 1) return found[0];
  if (found.length > 1) {
    console.error(
      `sprig build --rune: found ${found.length} sprig UI packages (${found.map((c) => relative(abs, c)).join(", ")}).\n` +
        `  Run it from the one you mean, e.g.  cd ${relative(abs, found[0]) || "."} && sprig build --rune .`,
    );
    Deno.exit(1);
  }
  console.error(
    `sprig build --rune: no sprig UI package found at or under ${abs} (a dir with src/mod.ts).\n` +
      `  Run it from the git root of a sprig+rune monorepo, or from the UI package itself.`,
  );
  Deno.exit(1);
}

/** Find the rune/keep backend package under the git root: a sibling dir (not the UI) whose
 *  bootstrap/mod.ts exports an `api` from bootstrapServer. Falls back to "server" (the
 *  rune convention) with a warning when none is found. */
async function detectBackendDir(gitRoot: string, uiRel: string): Promise<string> {
  const uiTop = uiRel.split("/")[0];
  const withBootstrap: string[] = [];
  for await (const e of Deno.readDir(gitRoot)) {
    if (!e.isDirectory || e.name.startsWith(".") || e.name === uiTop) continue;
    if (await pathExists(join(gitRoot, e.name, "bootstrap", "mod.ts"))) withBootstrap.push(e.name);
  }
  for (const c of withBootstrap) {
    const src = await Deno.readTextFile(join(gitRoot, c, "bootstrap", "mod.ts")).catch(() => "");
    if (/bootstrapServer\s*\(/.test(src)) return c; // a real keep backend
  }
  if (withBootstrap.length) return withBootstrap[0];
  console.error(
    `sprig build --rune: no backend package found under ${gitRoot} (no <dir>/bootstrap/mod.ts).\n` +
      `  The generated serve.ts will import "./server/bootstrap/mod.ts" — create that keep\n` +
      `  bootstrapServer (exporting \`api\`), or name your backend package "server".`,
  );
  return "server";
}

/** Soft probe for `sprig dev`: is this UI half of a rune monorepo (a real keep
 *  backend beside it)? Returns the composition coordinates, or null for a pure-UI
 *  app. Unlike the --rune build path this NEVER warns, defaults, or exits — dev
 *  quietly falls back to the UI-only handler. */
async function detectRuneComposition(
  uiAbs: string,
): Promise<{ gitRoot: string; serverRel: string } | null> {
  // nearest `.git` ancestor STRICTLY ABOVE the app (mirrors findProjectRoot, soft)
  let gitRoot = "";
  let d = uiAbs;
  while (true) {
    try {
      Deno.statSync(join(d, ".git"));
      gitRoot = d;
      break;
    } catch { /* keep walking up */ }
    const parent = dirname(d);
    if (parent === d) break;
    d = parent;
  }
  if (!gitRoot || gitRoot === uiAbs) return null;
  const uiTop = relative(gitRoot, uiAbs).replace(/\\/g, "/").split("/")[0];
  for await (const e of Deno.readDir(gitRoot)) {
    if (!e.isDirectory || e.name.startsWith(".") || e.name === uiTop) continue;
    const boot = join(gitRoot, e.name, "bootstrap", "mod.ts");
    if (!(await pathExists(boot))) continue;
    const src = await Deno.readTextFile(boot).catch(() => "");
    if (/bootstrapServer\s*\(/.test(src)) return { gitRoot, serverRel: e.name };
  }
  return null;
}

/** Load KEY=VALUE lines from a .env (if present) WITHOUT overriding the caller's
 *  environment. Dev parity needs it: the keep backend reads its env (INFRA_URL,
 *  service creds) at module-eval, exactly as `deno serve --env-file=.env` provides
 *  in prod. */
async function loadDotEnv(path: string): Promise<void> {
  const text = await Deno.readTextFile(path).catch(() => "");
  for (const line of text.split("\n")) {
    const m = line.match(/^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*?)\s*$/);
    if (!m || m[2] === undefined) continue;
    let v = m[2];
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) {
      v = v.slice(1, -1);
    }
    if (Deno.env.get(m[1]) === undefined) Deno.env.set(m[1], v);
  }
}

/** Add one entry to <gitRoot>/.gitignore (created if absent) unless already there. */
async function ensureGitignore(gitRoot: string, entry: string): Promise<void> {
  const p = join(gitRoot, ".gitignore");
  const cur = await Deno.readTextFile(p).catch(() => "");
  const lines = cur.split("\n").map((l) => l.trim());
  if (lines.includes(entry) || lines.includes(entry.replace(/^\//, ""))) return;
  await Deno.writeTextFile(p, cur.length && !cur.endsWith("\n") ? `${cur}\n${entry}\n` : `${cur}${entry}\n`);
}

/** Write <gitRoot>/serve.ts — the serveSprig composition root. Refuses to clobber a
 *  hand-written serve.ts (one without the generated marker). The root is a BUILD
 *  ARTIFACT — a CLI concern, kept out of git (see the .gitignore entry below):
 *  deploy builds regenerate it, and `sprig dev` composes the same thing in-process. */
async function writeRuneServe(gitRoot: string, uiRel: string, serverRel: string, assetsRel: string): Promise<void> {
  const servePath = join(gitRoot, "serve.ts");
  const MARKER = "GENERATED by `sprig build --rune`";
  if (await pathExists(servePath)) {
    const cur = await Deno.readTextFile(servePath);
    if (!cur.includes(MARKER)) {
      console.error(
        `sprig build --rune: ${servePath} already exists and was NOT generated by --rune.\n` +
          `  Refusing to overwrite a hand-written file — move it aside (or delete it) and re-run.`,
      );
      Deno.exit(1);
    }
  }
  const src = [
    `// ${MARKER} — the single-origin composition root at the git root.`,
    `//`,
    `// serveSprig folds the rune/keep backend (${serverRel}/) and the sprig UI (${uiRel}/) into ONE`,
    `// { fetch } default export that \`deno serve\` drives, reading the prebuilt ${assetsRel}/. The`,
    `// Deno workspace in ./deno.json lets each half keep its own import map; serveSprig binds`,
    `// keep's IN-PROCESS Backend so the UI's resolve.ts reads data with no TCP hop and no token.`,
    `//`,
    `//   deno serve -A serve.ts            (add --env-file=.env if your backend reads one)`,
    `//`,
    `//   /ui    → the SSR app        /api/* → the keep backend (token-gated)        /docs → Swagger`,
    `//`,
    `// Re-run \`sprig build --rune\` after changing pages/islands to refresh ${assetsRel}/.`,
    `import { serveSprig } from "@sprig/keep";`,
    `import { fromFileUrl } from "@std/path";`,
    `import { api } from "./${serverRel}/bootstrap/mod.ts";`,
    `import { sprigApp } from "./${uiRel}/src/mod.ts";`,
    ``,
    `// Pin assetsDir via import.meta (not the cwd-relative default) so the handler is correct`,
    `// no matter what directory it is launched from (e.g. Deno Deploy).`,
    `const assetsDir = fromFileUrl(new URL("./${assetsRel}", import.meta.url));`,
    ``,
    `export default serveSprig({ keep: api, app: sprigApp, base: "/ui", assetsDir });`,
    ``,
  ].join("\n");
  await Deno.writeTextFile(servePath, src);
  // the composition root is never committed — the deploy build regenerates it and
  // dev composes it in-process, so keep it out of the repo's history entirely.
  await ensureGitignore(gitRoot, "/serve.ts");
}

/** Make the git-root deno.json a Deno workspace over the UI + backend packages, and give it
 *  the two imports serve.ts itself needs (@sprig/keep + @std/path) — matched to the UI's
 *  versions so keep's `Backend` token is the SAME module instance (a version skew → "Backend
 *  is not bound"). Merges into an existing config; never drops the user's other fields. */
async function ensureRuneWorkspace(gitRoot: string, uiRel: string, serverRel: string): Promise<void> {
  const cfgPath = join(gitRoot, "deno.json");
  let cfg: Record<string, unknown> = {};
  if (await pathExists(cfgPath)) {
    const parsed = await readJson(cfgPath);
    if (!parsed) {
      console.error(`sprig build --rune: ${cfgPath} is not valid JSON. Fix it and re-run.`);
      Deno.exit(1);
    }
    cfg = parsed;
  }
  // 1. workspace members (the UI package + the backend package)
  const ws = Array.isArray(cfg.workspace) ? cfg.workspace as string[] : [];
  for (const m of [`./${uiRel}`, `./${serverRel}`]) if (!ws.includes(m)) ws.push(m);
  cfg.workspace = ws;
  // 2. workspace-root imports, matched to the UI member's exact versions so keep's `Backend`
  //    token is the SAME module instance (a version skew → "Backend is not bound"):
  //      · @sprig/keep + @std/path — what serve.ts itself imports.
  //      · @sprig/core + @preact/signals-core — needed only when the build runs from a
  //        working-tree (dev-installed) sprig: the generated island entries import the
  //        compiler's hydrate.ts by a file:// path OUTSIDE every member, so its `@sprig/core`
  //        resolves against the ROOT map, not a member's. (Harmless under a JSR sprig, where
  //        hydrate.ts resolves @sprig/core within its own package.)
  const uiCfg = await readJson(join(gitRoot, uiRel, "deno.json"));
  const uiImports = (uiCfg?.imports ?? {}) as Record<string, string>;
  const imports = (cfg.imports && typeof cfg.imports === "object") ? cfg.imports as Record<string, string> : {};
  imports["@sprig/core"] ??= uiImports["@sprig/core"] ?? "jsr:@sprig/core@0.12";
  imports["@sprig/keep"] ??= uiImports["@sprig/keep"] ?? "jsr:@sprig/core@0.12/keep";
  imports["@std/path"] ??= uiImports["@std/path"] ?? "jsr:@std/path@^1";
  imports["@preact/signals-core"] ??= uiImports["@preact/signals-core"] ?? "npm:@preact/signals-core@^1";
  cfg.imports = imports;
  // 2b. @sprig/* belongs at the ROOT only — strip it from every member (like `unstable` below).
  //     A workspace member with its OWN @sprig/core pin scopes its files to that copy; if it
  //     drifts from the root, the client bundle carries TWO runtimes (dead islands) AND, on the
  //     server, an OLD core whose bootstrap silently ignores route guards — an auth bypass we hit
  //     in practice. With the pin at the root only, members INHERIT the one runtime: single-core,
  //     guards intact. (The build.ts gate is the backstop if a stray member pin ever returns.)
  for (const member of [uiRel, serverRel]) {
    const mPath = join(gitRoot, member, "deno.json");
    const mCfg = await readJson(mPath);
    if (!mCfg || typeof mCfg.imports !== "object") continue;
    const mImports = mCfg.imports as Record<string, string>;
    let changed = false;
    for (const k of ["@sprig/core", "@sprig/core/", "@sprig/keep"]) {
      if (k in mImports) {
        delete mImports[k];
        changed = true;
      }
    }
    if (changed) await Deno.writeTextFile(mPath, JSON.stringify(mCfg, null, 2) + "\n");
  }
  // 3. a working `start` task — replace a stale `deno run … server.ts`, keep a good one
  const tasks = (cfg.tasks && typeof cfg.tasks === "object") ? cfg.tasks as Record<string, string> : {};
  const envFlag = (await pathExists(join(gitRoot, ".env"))) ? " --env-file=.env" : "";
  const start = `deno serve -A${envFlag} serve.ts`;
  if (!tasks.start || /\bdeno run\b/.test(tasks.start) || /\bserver\.ts\b/.test(tasks.start)) tasks.start = start;
  cfg.tasks = tasks;
  // 4. Deno KV is unstable on the CLI — keep backends commonly use it. The `unstable`
  //    field is honored ONLY in the workspace root, so hoist any the members declared up
  //    here and strip them from the members (else Deno warns on every run).
  const unstable = Array.isArray(cfg.unstable) ? cfg.unstable as string[] : [];
  for (const member of [uiRel, serverRel]) {
    const mPath = join(gitRoot, member, "deno.json");
    const mCfg = await readJson(mPath);
    if (mCfg && Array.isArray(mCfg.unstable)) {
      for (const u of mCfg.unstable as string[]) if (!unstable.includes(u)) unstable.push(u);
      delete mCfg.unstable;
      await Deno.writeTextFile(mPath, JSON.stringify(mCfg, null, 2) + "\n");
    }
  }
  if (!unstable.includes("kv")) unstable.push("kv");
  cfg.unstable = unstable;
  await Deno.writeTextFile(cfgPath, JSON.stringify(cfg, null, 2) + "\n");
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

/** `sprig dev --annotate <html>` — PROTOTYPE annotate: serve one throwaway HTML file with the
 *  overlay (keyed to the ELEMENT), no app build, no workbench. The build-mode analog lives in
 *  dev() below. Refuses a design-system specimen (the overlay targets the prototype). */
async function devAnnotateHtml(htmlPath: string, open = true): Promise<void> {
  const abs = resolve(htmlPath);
  try {
    if (!(await Deno.stat(abs)).isFile) throw new Error("not a file");
  } catch {
    console.error(`sprig dev --annotate: not a file: ${abs}`);
    Deno.exit(1);
  }
  if (/\/design-system\//.test(abs.replace(/\\/g, "/"))) {
    console.error(
      `Refusing to annotate a design-system file:\n  ${abs}\n` +
        `annotate targets the prototype. Point it at e.g. spec/ui/<app>-prototype.html.`,
    );
    Deno.exit(1);
  }
  // STABLE port hashed from the prototype name (PORT overrides) — the one annotate URL for this
  // prototype, every run. Never drifts.
  const here = basename(abs);
  const want = Number(Deno.env.get("PORT")) || appPort(here);
  const running = await annotatePing(want);
  if (running) {
    if (running.mode === "prototype" && running.file === here) {
      console.log(
        `sprig annotate already running → http://localhost:${want}/${here}\n` +
          `  Reusing it — rewrite the prototype and the open view hot-reloads. (Leave that server running.)`,
      );
      return; // same prototype, same URL — nothing to do
    }
    console.error(
      `sprig dev --annotate: an annotate server is already on port ${want} ` +
        `(${running.mode === "prototype" ? "serving " + running.file : "the build app"}).\n` +
        `  Stop it (Ctrl-C in its terminal) to annotate ${here}, or run with a different PORT, ` +
        `e.g. PORT=8010 sprig dev --annotate ${here}.`,
    );
    Deno.exit(1);
  }
  if (!portIsFree(want)) {
    console.error(
      `sprig dev --annotate: port ${want} is busy (and isn't an annotate server).\n` +
        `  Free it, or run with a fixed PORT, e.g. PORT=8010 sprig dev --annotate ${here}.`,
    );
    Deno.exit(1);
  }
  const { makePrototypeAnnotate } = await import("./.sprig/annotate.ts");
  const proto = makePrototypeAnnotate({ htmlPath: abs });
  const pageURL = `http://localhost:${want}/${here}`;
  console.log(`sprig dev --annotate (prototype) → ${pageURL}`);
  console.log(
    `  ⌘/Ctrl+click an element → note → save (inline | json) · ⇧⌘ drag to draw.\n` +
      `  Rewrite the file to iterate — the open view hot-reloads (no relaunch). Leave this running.\n` +
      `  feedback: ${abs.replace(/\.html?$/i, "")}.feedback.json`,
  );
  Deno.serve({ port: want, onListen: () => { if (open) openUrl(pageURL); } }, (req: Request) => proto.fetch(req));
}

async function dev(rawArgs: string[] = []): Promise<void> {
  // `sprig dev` ALWAYS serves the full-app BUILD annotate overlay (⌘/Ctrl+click → spec/ui/
  // build-notes.json) plus the isolate workbench. `--annotate <html>` switches to PROTOTYPE
  // annotate (serve that one HTML file standalone); a bare `--annotate` is now a harmless no-op
  // since annotate is the default. Only `sprig build` produces annotate-free output.
  const ai = rawArgs.indexOf("--annotate");
  const open = !rawArgs.includes("--no-open"); // annotate auto-opens the UI; --no-open suppresses
  let annotateHtml = "";
  if (ai >= 0 && rawArgs[ai + 1] && /\.html?$/i.test(rawArgs[ai + 1])) annotateHtml = rawArgs[ai + 1];
  if (annotateHtml) return await devAnnotateHtml(annotateHtml, open);
  const positionals = rawArgs.filter((a) => !a.startsWith("-") && a !== annotateHtml);
  const appDir = positionals[0] ?? ".";
  const base = positionals[1] ?? "/ui";
  // Annotate gets a STABLE port hashed from the app folder name (PORT overrides) — same app, same
  // URL, every run; different apps don't collide. Reuse a same-app server; error on a foreign one
  // or a busy port — never silently drift.
  const wantPort = Number(Deno.env.get("PORT")) || appPort(basename(resolve(appDir)));
  const ping = await annotatePing(wantPort);
  if (ping) {
    if (ping.mode !== "prototype") {
      console.log(
        `sprig annotate already running → http://localhost:${wantPort}${base}\n` +
          `  Reusing it. Annotate there; I'll read spec/ui/build-notes.json. (Leave it running.)`,
      );
      return;
    }
    console.error(
      `sprig dev: a prototype annotate server is already on port ${wantPort}. Stop it, or set a different PORT.`,
    );
    Deno.exit(1);
  }
  if (!portIsFree(wantPort)) {
    console.error(
      `sprig dev: port ${wantPort} is busy (and isn't an annotate server). Free it, or set a fixed PORT.`,
    );
    Deno.exit(1);
  }
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
  // Tell the app's createRenderer where the SERVED assets live, so its ?v= cache-bust hashes
  // the dev bundle (in outDir) rather than <cwd>/static — keeps ?v= in step with rebuilds so a
  // returning browser refetches instead of running a stale cached client.js. Set before the
  // app's src/mod.ts is imported below (createRenderer reads it at module-eval).
  Deno.env.set("SPRIG_ASSETS_DIR", outDir);
  await build(appDir, true, outDir);
  // RUNE PARITY: when this UI is half of a rune monorepo (a keep backend beside it),
  // dev serves EXACTLY the prod composition — serveSprig folding the backend's /api +
  // /docs around the app — instead of a UI-only handler. The composition root is a
  // CLI concern: composed in-process here, regenerated by `build --rune` for deploy,
  // never a committed file. The backend reads env at module-eval, so the git root's
  // .env is loaded first (never overriding the caller's environment) — the dev twin
  // of prod's `deno serve --env-file=.env`.
  const rune = await detectRuneComposition(resolve(appDir));
  if (rune) await loadDotEnv(join(rune.gitRoot, ".env"));
  const { renderer, sprigApp } = await import(toFileUrl(join(resolve(appDir), "src", "mod.ts")).href);
  let hostFetch: (req: Request, info: Deno.ServeHandlerInfo) => Promise<Response>;
  if (rune) {
    const { api } = await import(toFileUrl(join(rune.gitRoot, rune.serverRel, "bootstrap", "mod.ts")).href);
    const composed = serveSprig({ keep: api, app: sprigApp, base, assetsDir: outDir });
    hostFetch = (req, info) => composed.fetch(req, info);
  } else {
    // pure-UI app: the sprig middleware alone (no backend to compose)
    const ui = sprigUi({ app: sprigApp, base, assetsDir: outDir });
    hostFetch = (req, info) => ui(req, info).then((r: Response | null) => r ?? new Response("Not Found", { status: 404 }));
  }
  const handler = { fetch: hostFetch };
  const devSrv = createDevServer({ renderer, base, outDir, handler });
  // annotate uses the hashed/validated stable port (no drift).
  const port = wantPort;

  // Always-on annotate: fold the component-keyed click-to-edit overlay INTO the dev server, and
  // bring up the isolate workbench alongside on a second port (one command, both surfaces). They
  // die together on Ctrl-C.
  const root = installRoot();
  const appAbs = resolve(appDir);
  const isoPort = freePort(port + 1);
  const isoBase = `http://localhost:${isoPort}`;
  // The workbench is best-effort: if it's missing or can't start, the annotate overlay must STILL
  // run (the loop's review surface is the app; isolate is the verify surface). Never let it drop
  // dev — so a missing workbench (old slim install) just warns instead of failing.
  let wb: Deno.ChildProcess | null = null;
  try {
    await assertWorkbench(root); // throws on an old slim install lacking the workbench
    wb = spawnWorkbench(appAbs, isoPort, open); // workbench opens its own tab when ready
  } catch (e) {
    console.error(`sprig: isolate workbench unavailable (${e instanceof Error ? e.message : e}) — annotate overlay still running.`);
  }
  // `spec/ui` is the SHARED contract — anchor it on the git root (sibling of `.git`) so a
  // monorepo's frontend writes to <gitRoot>/spec/ui, not <gitRoot>/frontend/spec/ui. Falls back
  // to appAbs outside a git repo. `srcDir` stays per-app (component discovery is NOT a spec concern).
  const specRoot = specRootOf(appAbs);
  const { makeAnnotate } = await import("./.sprig/annotate.ts");
  const annotate = await makeAnnotate({ specRoot, srcDir: join(appAbs, "src"), isolateBase: isoBase });
  const onSig = () => {
    try {
      wb?.kill("SIGTERM");
    } catch { /* already dead */ }
    Deno.exit(130);
  };
  Deno.addSignalListener("SIGINT", onSig);
  Deno.addSignalListener("SIGTERM", onSig);
  console.log("sprig dev (annotate):");
  console.log(`  app + annotate → http://localhost:${port}${base}   (⌘/Ctrl+click → spec/ui/build-notes.json)`);
  if (rune) console.log(`  keep composed  → /api + /docs from ${rune.serverRel}/ — dev serves the PROD composition`);
  console.log(`  isolate        → ${isoBase}/   (verify each component here; ${wb ? "starting…" : "unavailable"})`);
  console.log(`  ${annotate.size} component(s) mapped from src/ · stable port · HMR on · build cache: ${outDir}`);

  Deno.serve({
    port,
    onListen: () => {
      // open the annotate app now (the workbench opens its own tab when it finishes building)
      if (open) openUrl(`http://localhost:${port}${base}`);
    },
  }, async (req: Request, info: Deno.ServeHandlerInfo) => {
    const a = await annotate.handle(req); // /__annotate/* API
    if (a) return a;
    const res = await devSrv.fetch(req, info);
    return await annotate.inject(res); // splice the overlay into served HTML
  });
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
    "@mrg-keystone/rune": "jsr:@mrg-keystone/rune@^1",
    "reflect-metadata": "npm:reflect-metadata@0.1.13",
    "@std/path": "jsr:@std/path@^1",
    "@std/assert": "jsr:@std/assert@^1"
  },
  "tasks": {
    "dev": "sprig dev .",
    "build": "sprig build .",
    "start": "deno serve -A --unstable-kv serve.ts"
  }
}
`,

    "serve.ts": [
      `// Single-origin composition root: serveSprig folds the keep backend + the sprig UI`,
      `// into ONE { fetch } that \`deno serve\` drives — no Deno.serve()/app.listen() of your`,
      `// own:  deno serve -A --unstable-kv serve.ts`,
      `//   /api/* + /docs*  → the keep backend (token-gated; the channel browser islands use).`,
      `//   everything else  → the SSR app, with keep's in-process client bound to the Backend`,
      `//                      DI token — pages read data via inject(Backend), no TCP, no token.`,
      `import { serveSprig } from "@sprig/keep";`,
      `import { api } from "./bootstrap/mod.ts";`,
      `import { sprigApp } from "$";`,
      ``,
      `export default serveSprig({ keep: api, app: sprigApp, base: "/ui" });`,
      ``,
    ].join("\n"),

    "bootstrap/mod.ts": [
      `// Your keep backend (jsr:@mrg-keystone/rune). serve.ts mounts it through serveSprig:`,
      `// the in-process client is bound to the Backend DI token for SSR, and the network`,
      `// handler serves /api/* (token-gated) + /docs. It is imported, never listened on —`,
      `// \`deno serve serve.ts\` owns the socket. Add endpoints by generating rune modules`,
      `// (or hand-writing Danet controllers) and listing them in the array below.`,
      `import "reflect-metadata";`,
      `import { bootstrapServer } from "@mrg-keystone/rune";`,
      ``,
      `export const api = await bootstrapServer("${name}", [], {});`,
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

    "src/shell/template.html": [
      `<!-- App shell — the folder MUST be named \`shell\`; the renderer discovers it by name`,
      `     under src/ and renders the matched page into the outlet. -->`,
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
    `Scaffolded a sprig app at ${appAbs}\n\n` +
      `  cd ${dir}\n` +
      `  deno task dev                       # sprig HMR dev → http://localhost:8000/ui\n` +
      `  deno task build && deno task start  # production: serveSprig on the keep backend (UI /ui, API /api, docs /docs)\n`,
  );
}

/** The Storybook-style component/page/island workbench: discover every component + its
 *  isolate/ cases, render a live preview per case, and serve the workbench UI (sidebar, stage,
 *  viewport controls, controls/console/tests). The UI (app/), its keep discovery + test-runner
 *  backend (server/), the orchestrator (cli/), and the composition root (serve.ts) are
 *  installed next to the framework by `sprig install`/`sprig update`; this delegates to the
 *  workbench's own dev runner. */
/** Spawn the workbench dev runner (cli/main.ts dev): discover → generate a preview per case →
 *  build the app → serve serve.ts (UI + keep backend) under ISOLATE_PROJECT, on `port`. Used by
 *  `sprig isolate` (which awaits it) and `sprig dev --annotate` (which runs it alongside the dev
 *  server). The same flow that powers the live workbench; we just point it at `appAbs`. */
function spawnWorkbench(appAbs: string, port: number, open: boolean): Deno.ChildProcess {
  const root = installRoot();
  return new Deno.Command(Deno.execPath(), {
    args: [
      "run", "-A", "--config", join(root, "deno.json"), join(root, "cli", "main.ts"),
      "dev", "--root", appAbs, ...(open ? [] : ["--no-open"]),
    ],
    cwd: root,
    env: { ...Deno.env.toObject(), PORT: String(port) },
    stdin: "inherit",
    stdout: "inherit",
    stderr: "inherit",
  }).spawn();
}

async function isolate(appDir = ".", open = true): Promise<void> {
  // the dir that holds framework/ — a repo checkout or ~/.sprig (both carry the workbench).
  const root = installRoot();
  await assertWorkbench(root); // clear "run `sprig update`" error if an old slim install lacks it
  const port = freePort(Number(Deno.env.get("PORT") ?? 8000));
  const { code } = await spawnWorkbench(resolve(appDir), port, open).status;
  Deno.exit(code);
}

/** Read this install's own version (from the package deno.json) and publish time (from the
 *  runtime bundle's `framework/.sprig/build-info.json` stamp). `..` from framework/cli.ts is the
 *  install root, both in a checkout and in ~/.sprig. `publishedAt` is null on a dev/checkout
 *  install (no bundle stamp) or an older runtime that predates the stamp. `version` is "?" if it
 *  can't be read. The local stamp is authoritative for "when was THE version I'm running shipped"
 *  — unlike the rolling `runtime-latest` GitHub timestamp, which only matches when up to date. */
async function localMeta(): Promise<{ version: string; publishedAt: string | null }> {
  // `sprig -v` can legitimately run straight from `jsr:` (before `sprig install` sets up ~/.sprig),
  // where there's no on-disk bundle — `import.meta.dirname` is `undefined` then (never throws).
  // The version is embedded in the module URL (https://jsr.io/@scope/name/<version>/…/cli.ts), so
  // read it from there rather than reporting "?". Publish time isn't in the URL → stays null, and
  // version() falls back to the GitHub release timestamp when local === latest.
  const fwDir = import.meta.dirname; // <install root>/framework, or undefined when loaded remotely
  if (!fwDir) {
    const v = import.meta.url.match(/\/@[^/]+\/[^/]+\/(\d+\.\d+\.\d+[^/]*)\//)?.[1];
    return { version: v ?? "?", publishedAt: null };
  }
  let version = "?";
  try {
    const cfg = JSON.parse(await Deno.readTextFile(join(fwDir, "..", "deno.json")));
    if (typeof cfg.version === "string") version = cfg.version;
  } catch { /* unreadable → "?" */ }
  let publishedAt: string | null = null;
  try {
    const info = JSON.parse(await Deno.readTextFile(join(fwDir, ".sprig", "build-info.json")));
    if (typeof info.publishedAt === "string") publishedAt = info.publishedAt;
  } catch { /* dev install / pre-stamp runtime → no sidecar */ }
  return { version, publishedAt };
}

/** Format an ISO-8601 instant in US Eastern time as a compact `YYYY-MM-DD HH:MM EST` — the zone
 *  abbrev auto-resolves to EST (winter) or EDT (summer) by date. Echoes the raw string if it
 *  doesn't parse. The publish time is STORED in UTC (`build-info.json`) and converted here only
 *  for display. */
function fmtPublished(iso: string): string {
  const d = new Date(iso);
  if (isNaN(d.getTime())) return iso;
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/New_York",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
    timeZoneName: "short",
  }).formatToParts(d);
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? "";
  return `${get("year")}-${get("month")}-${get("day")} ${get("hour")}:${get("minute")} ${get("timeZoneName")}`;
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

/** `sprig -v` / `--version`: print this install's version AND when that version was published,
 *  then check the GitHub runtime release (the SAME source `sprig update` installs from) and, if a
 *  newer release exists, print a colored upgrade notice with the `sprig update` hint.
 *
 *  Publish time is taken from the LOCAL bundle stamp (exact for the running version, works
 *  offline). When that's absent (dev/checkout install, or a runtime older than the stamp), fall
 *  back to the GitHub release's publish time — but ONLY when local === latest, since the rolling
 *  `runtime-latest` timestamp otherwise belongs to a different version than the one installed. */
async function version(): Promise<void> {
  const { version: local, publishedAt: localPub } = await localMeta();
  const rel = await latestRuntimeRelease();
  const published = localPub ??
    (rel && rel.version === local ? rel.publishedAt : null);
  const when = published ? `  (published ${fmtPublished(published)})` : "";
  console.log(`sprig ${local}${when}`);
  if (rel?.version && local !== "?" && compareVersions(rel.version, local) > 0) {
    const G = "\x1b[32m", B = "\x1b[1m", C = "\x1b[36m", R = "\x1b[0m";
    console.log(
      `\n${G}${B}A new version of sprig is available: ${local} → ${rel.version}${R}\n` +
        `${G}Run ${C}sprig update${G} to upgrade.${R}`,
    );
  }
}

/** Refresh this machine to the latest deployment: download the source bundle to ~/.sprig,
 *  `deno install` its node_modules HERE, reinstall skills, and re-point the `sprig`
 *  launcher — NOT from any local checkout. */
async function update(): Promise<void> {
  await installRuntimeFromDeployment();
  console.log("✓ sprig is up to date (runtime + skills + agents). Run 'sprig --help'.");
}

/** First-time install. `--dev` wires the launcher to THIS checkout (for repo devs, e.g.
 *  `deno task install:dev`); otherwise download + set up the runtime at ~/.sprig from the
 *  deployment. Both install the Claude Code skills into ${CLAUDE_SKILLS_DIR:-~/.claude/skills}
 *  and agents into ${CLAUDE_AGENTS_DIR:-~/.claude/agents}. */
async function install(dev: boolean): Promise<void> {
  if (dev) {
    const repoRoot = installRoot(); // framework/ -> repo root (--dev runs from a file:// checkout)
    await installRuntimeFromWorkingTree(repoRoot);
  } else {
    await installRuntimeFromDeployment();
  }
  console.log("✓ sprig installed (runtime + skills + agents). Run 'sprig --help'.");
}

const USAGE = `sprig — the framework CLI

  sprig init  [dir]              scaffold a minimal, runnable sprig app (default: .)
  sprig dev   [appDir] [--annotate <html>] [--no-open]  HMR dev server → /ui — ALWAYS serves the click-to-edit
                                  overlay + the isolate workbench (full app). --annotate <html>: annotate one
                                  prototype file instead. Annotate picks a STABLE port hashed from the app name
                                  (PORT overrides) and opens the UI in the browser (--no-open suppresses).
  sprig build [appDir] [--rune]  code-split islands + scope CSS + Tailwind → static/ (default: .; never annotate)
                                  --rune also folds the sibling keep backend + this UI into a git-root
                                  serve.ts (serveSprig) and makes the root deno.json a Deno workspace
  sprig check [appDir]           typecheck the app under the CLI runtime (the @sprig/core-pin-free
                                  replacement for deno check — the CLI owns the one runtime)
  sprig isolate [appDir]         component/page workbench — develop in isolation (default: .)
  sprig serve [entry]            run the app's host entry under its deno.json (default: serve.ts)
  sprig install [--dev]          install the global sprig CLI + Claude Code skills + agents (--dev: from this checkout)
  sprig update                   re-install the global sprig CLI + skills + agents from the latest release
  sprig -v, --version            print the installed version + check JSR for a newer release
  sprig help
`;

const [cmd, ...rest] = Deno.args;
switch (cmd) {
  case "init":
    await init(rest[0]);
    break;
  case "build": {
    const dev = rest.includes("--dev");
    const rune = rest.includes("--rune");
    const appArg = rest.find((a) => !a.startsWith("-")) ?? ".";
    if (rune) {
      // --rune composes the whole monorepo, so it's natural to run from the git ROOT (not
      // just the UI package). Locate the sprig UI package at/under appArg, build IT to
      // <ui>/static (cwd-independent), then compose. Works from the root or from ui/.
      const ui = await resolveRuneUiDir(appArg);
      await build(ui, dev, join(ui, "static"), true);
    } else {
      await build(appArg, dev, join(Deno.cwd(), "static"), false);
    }
    break;
  }
  case "check": {
    const appArg = rest.find((a) => !a.startsWith("-")) ?? ".";
    await check(appArg);
    break;
  }
  case "dev":
    await dev(rest);
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
