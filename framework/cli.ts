#!/usr/bin/env -S deno run -A
/**
 * `sprig` — the framework CLI.
 *
 *   sprig init [dir]            scaffold a minimal, runnable sprig app
 *   sprig dev  [appDir] [--annotate <html>]  HMR dev server (no Vite) → ALWAYS serves the click-to-edit overlay +
 *                                  isolate workbench (full app); --annotate <html> annotates one prototype file instead
 *   sprig build [appDir]        code-split islands + scope CSS + Tailwind → static/
 *   sprig clean [appDir]        remove what build created (static/ + a --rune-generated serve.ts)
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
import { createRenderer, loadRoutes, serveSprig, sprigAuth, sprigUi } from "../packages/keep/mod.ts";
// The runtime via the BARE specifier, not "./.sprig/core.ts": in the merged-config dev child the
// import map resolves @mrg-keystone/sprig to the APP'S stamped pin, so the CLI's bootstrap and the
// app's own modules share ONE core (dev == prod resolution; a relative import here would load a
// second, local copy and split the module-global DI).
import { bootstrap, type Route } from "@mrg-keystone/sprig";
import { assertWorkbench, installRuntimeFromDeployment, installRuntimeFromWorkingTree, latestRuntimeRelease } from "./.sprig/install.ts";
import { specRootOf } from "./.sprig/spec-root.ts";
// NOTE: `./.sprig/annotate.ts` is imported LAZILY (a dynamic `import(...)` inside the `dev`
// handlers), never statically — so `build` / `--help` / `isolate` don't pull the annotate overlay
// machinery onto their load path, and a future top-level hazard in it can't poison every command.

// the published-package version range a scaffolded app pins (core + its /keep + /cli
// sub-exports all ship from @mrg-keystone/sprig). Bump in lockstep with the published version.
/** The running CLI's OWN semver, read from its install deno.json — the single source for "which
 *  sprig am I". Null when it can't be read — INCLUDING a remote jsr: run, where there is no
 *  install root on disk. MUST NOT go through installRoot(): its jsr guard `Deno.exit(1)`s, which
 *  no try/catch can intercept — that regression made every `deno run jsr:…/cli build --rune`
 *  (i.e. every Deno Deploy build) die instead of gracefully skipping the stamp. Feeds both
 *  sprigRange() (the init pin) and stamp() (the build-time pin), both of which handle null. */
function cliVersion(): string | null {
  const fwDir = import.meta.dirname; // undefined on a remote jsr:/https: run — no disk, no version
  if (!fwDir) return null;
  try {
    const { version } = JSON.parse(Deno.readTextFileSync(join(fwDir, "..", "deno.json"))) as { version?: string };
    return (typeof version === "string" && version) ? version : null;
  } catch {
    return null;
  }
}

/** The @mrg-keystone/sprig version range `sprig init` pins into a scaffolded app — the running CLI's OWN
 *  version, so a fresh app never targets a stale sprig. This was a frozen "^0.12.0" that silently
 *  scaffolded seven versions behind. */
function sprigRange(): string {
  const v = cliVersion();
  return v ? `^${v}` : "^0.19.0";
}

/** The `@mrg-keystone/rune` range `sprig init` pins into a scaffolded app's backend. Read from the
 *  running CLI's OWN `server/deno.json` (which ships inside the runtime bundle) — the single source
 *  of truth for "the rune this sprig build targets." The release pipeline refreshes that pin to the
 *  newest published rune on every cut (the reusable jsr-publish `refresh-latest` step), so the
 *  scaffold tracks latest by construction instead of freezing a literal that silently scaffolds a
 *  stale rune. Falls back to the current major floor if server/deno.json is unreadable. */
function runeRange(): string {
  // Direct import.meta.dirname, NOT installRoot(): its jsr guard Deno.exit(1)s
  // (uncatchable) — this read must degrade to the floor on a remote jsr: run.
  const fwDir = import.meta.dirname;
  if (!fwDir) return "^3";
  try {
    const cfg = JSON.parse(Deno.readTextFileSync(join(fwDir, "..", "server", "deno.json"))) as { imports?: Record<string, string> };
    const range = cfg.imports?.["@mrg-keystone/rune"]?.match(/\/rune@([^"/]+)$/)?.[1];
    if (range) return range;
  } catch { /* fall through to a sane floor */ }
  return "^3";
}

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
async function annotatePing(port: number): Promise<{ ok: true; mode?: string; file?: string; notes?: string } | null> {
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

/** If a previous sprig version's `sprig dev` was killed (e.g. SIGKILL) before it could restore
 *  the app's deno.json(s), its pin backups still exist in TMPDIR — put every one back. The
 *  local-pin swap itself is GONE (dev now resolves @mrg-keystone/sprig through the app's own
 *  stamped pin, exactly like prod), but a repo last touched by an older sprig may still be
 *  carrying a leaked local-path rewrite; this heals it once and removes the backup dir. */
async function healLegacyLocalPins(appDir: string): Promise<void> {
  const tmp = Deno.env.get("TMPDIR") ?? "/tmp";
  const key = resolve(appDir).replace(/[^A-Za-z0-9]+/g, "-").replace(/(^-|-$)/g, "") || "app";
  const dir = join(tmp, "sprig-dev", key, "pins");
  let healed = 0;
  try {
    for await (const e of Deno.readDir(dir)) {
      if (!e.isFile || !e.name.endsWith(".json")) continue;
      try {
        const { path, original } = JSON.parse(await Deno.readTextFile(join(dir, e.name))) as { path: string; original: string };
        await Deno.writeTextFile(path, original);
        healed++;
      } catch { /* skip a corrupt/partial backup */ }
    }
    await Deno.remove(dir, { recursive: true }).catch(() => {});
  } catch { /* no backup dir → nothing to heal */ }
  if (healed) console.log(`sprig: restored ${healed} deno.json file(s) from an interrupted previous \`sprig dev\`.`);
}

// ── shared dev-process registry (~/.sprig/dev.json) ──────────────────────────
// ONE `sprig dev` per git repo. The first run is the OWNER: it serves + tees its output to a
// rotating log folder and records { pid, log-size, log-folder } under the repo name. Later runs
// find the entry, see the pid is alive, and just ATTACH — stream the newest log, no second server.
// If the owner died without cleanup (SIGKILL/crash) the pid is dead → the entry is stale → the next
// run reclaims it (frees the repo's stable ports, then owns). That's what stops the leak: at most
// one server+workbench per repo, guaranteed by the lock; a dead pid can never masquerade as alive.
const MAX_LOG_LINES = 2000; // per file, then roll to a fresh timestamped one
const MAX_LOG_FILES = 20; // keep this many rotated files per repo; oldest pruned

interface DevLockEntry {
  pid: number;
  "log-size": number;
  "log-folder": string;
}

/** Global sprig state dir (~/.sprig) — NOT the install root (which is the checkout under --dev). */
function sprigStateRoot(): string {
  return Deno.env.get("SPRIG_HOME") ??
    join(Deno.env.get("HOME") ?? Deno.env.get("USERPROFILE") ?? ".", ".sprig");
}
function devLockPath(): string {
  return join(sprigStateRoot(), "dev.json");
}

/** Nearest `.git` ancestor of `startAbs` (a real clone has a `.git` dir, a worktree a `.git` file — test existence, not type), or null outside any repo. */
function gitRepoRoot(startAbs: string): string | null {
  let d = startAbs;
  for (;;) {
    try {
      Deno.statSync(join(d, ".git"));
      return d;
    } catch { /* keep walking up */ }
    const parent = dirname(d);
    if (parent === d) return null;
    d = parent;
  }
}
/** The current git branch of `root`, sanitized (empty outside a repo / on detached HEAD). Keys the
 *  dev registry + workbench per BRANCH: two branches of one repo (or two worktrees) get separate
 *  ports, logs, and — critically — separate workbench dirs, so their generated previews can never
 *  clobber each other. */
function gitBranch(root: string): string {
  try {
    const out = new Deno.Command("git", {
      args: ["-C", root, "rev-parse", "--abbrev-ref", "HEAD"],
      stdout: "piped",
      stderr: "null",
    }).outputSync();
    if (!out.success) return "";
    const b = new TextDecoder().decode(out.stdout).trim();
    return b && b !== "HEAD" ? b.replace(/[^A-Za-z0-9._-]+/g, "-") : "";
  } catch {
    return ""; // git absent / not a repo
  }
}

/** The registry key: the git repo's folder name + branch (or the target's basename, outside a
 *  repo), sanitized. Branch is included so `sprig dev` on two branches/worktrees of the same repo
 *  never shares a lock, ports, or the workbench working dir. */
function repoKey(target: string): string {
  const root = gitRepoRoot(target) ?? target;
  const name = basename(root).replace(/[^A-Za-z0-9._-]+/g, "-") || "app";
  const branch = gitBranch(root);
  return branch ? `${name}-${branch}` : name;
}

async function readDevLock(): Promise<Record<string, DevLockEntry>> {
  try {
    return (JSON.parse(await Deno.readTextFile(devLockPath())) as Record<string, DevLockEntry>) ?? {};
  } catch {
    return {};
  }
}
async function writeDevLock(map: Record<string, DevLockEntry>): Promise<void> {
  await Deno.mkdir(sprigStateRoot(), { recursive: true });
  const tmp = `${devLockPath()}.${Deno.pid}.tmp`;
  await Deno.writeTextFile(tmp, JSON.stringify(map, null, 2));
  await Deno.rename(tmp, devLockPath()); // atomic swap so a concurrent read never sees a half-write
}

/** Is `pid` a live process? `ps -p` — no signal side-effects (unlike a probe kill), and a PID that
 *  was reused by some unrelated program still reads as "a process", which is fine: we ALSO free the
 *  repo's ports on reclaim, so a false-positive can't leave a second server up. */
async function pidAlive(pid: number): Promise<boolean> {
  if (!Number.isInteger(pid) || pid <= 1) return false;
  try {
    const { success } = await new Deno.Command("ps", { args: ["-p", String(pid)], stdout: "null", stderr: "null" }).output();
    return success;
  } catch {
    return false;
  }
}
/** Kill whatever is bound to `port` — an orphaned server/workbench a dead owner left behind. */
async function killPort(port: number): Promise<void> {
  try {
    // LISTEN only: a bare `tcp:<port>` also matches CLIENT sockets on that port —
    // including the probe fetch the CALLER just made, i.e. killPort would SIGKILL
    // the very process doing the reclaiming (silent self-kill mid-boot).
    const out = await new Deno.Command("lsof", { args: ["-ti", `tcp:${port}`, "-sTCP:LISTEN"], stdout: "piped", stderr: "null" }).output();
    for (const s of new TextDecoder().decode(out.stdout).split("\n")) {
      const p = Number(s.trim());
      if (p > 1) try { Deno.kill(p, "SIGKILL"); } catch { /* already gone */ }
    }
  } catch { /* no lsof → skip (best-effort) */ }
}
/** The two stable ports a repo's shared process owns (app+annotate, and the isolate workbench). */
function devPorts(repo: string): { app: number; iso: number } {
  return { app: Number(Deno.env.get("PORT")) || appPort(repo), iso: appPort(`isolate:${repo}`) };
}

/** Tee the shared dev process's output to the terminal AND to a rotating log folder:
 *  <folder>/<ISO-timestamp>.log, MAX_LOG_LINES per file then roll, keep at most MAX_LOG_FILES. */
class DevLog {
  #folder: string;
  #maxFiles: number;
  #file: Deno.FsFile | null = null;
  #lines = 0;
  #chain: Promise<void> = Promise.resolve(); // serialize the stdout+stderr pumps
  constructor(folder: string, maxFiles: number) {
    this.#folder = folder;
    this.#maxFiles = maxFiles;
  }
  async #roll(): Promise<void> {
    try { this.#file?.close(); } catch { /* */ }
    const name = new Date().toISOString().replace(/[:.]/g, "-") + ".log";
    this.#file = await Deno.open(join(this.#folder, name), { create: true, append: true });
    this.#lines = 0;
    const files: string[] = [];
    for await (const e of Deno.readDir(this.#folder)) if (e.isFile && e.name.endsWith(".log")) files.push(e.name);
    files.sort(); // timestamp names sort chronologically
    for (const old of files.slice(0, Math.max(0, files.length - this.#maxFiles))) {
      await Deno.remove(join(this.#folder, old)).catch(() => {});
    }
  }
  write(chunk: Uint8Array): Promise<void> {
    return (this.#chain = this.#chain.then(() => this.#doWrite(chunk)));
  }
  async #doWrite(chunk: Uint8Array): Promise<void> {
    await Deno.stdout.write(chunk); // tee to the owner's terminal
    if (!this.#file) await this.#roll();
    await this.#file!.write(chunk);
    for (const b of chunk) if (b === 10) this.#lines++;
    if (this.#lines >= MAX_LOG_LINES) await this.#roll();
  }
  close(): void {
    try { this.#file?.close(); } catch { /* */ }
  }
}

/** ATTACH to a running shared dev process: print a header, then live-tail its NEWEST log file
 *  (following rotation to the next file). Ctrl-C just detaches — the shared process keeps running. */
async function attachShared(repo: string, e: DevLockEntry): Promise<void> {
  const folder = e["log-folder"];
  // The ONLY visible difference from a single instance is this banner — below it,
  // the live log streams exactly as if this terminal owned the process.
  const msg = "THIS IS A SHARED INSTANCE BE POLITE";
  const pad = `   ${msg}   `;
  const bar = "═".repeat(pad.length);
  console.log(
    `%c\n╔${bar}╗\n║${pad}║\n╚${bar}╝\n`,
    "color:#f59e0b;font-weight:bold",
  );
  console.log(
    `%c⟶ sprig dev — shared process for "${repo}" (pid ${e.pid}); streaming its live log.%c\n` +
      `  Hot-reloads happen on edit. Ctrl-C detaches (it keeps running). older logs: ${folder}\n`,
    "color:#7c3aed;font-weight:bold",
    "",
  );
  const newest = async (): Promise<string> => {
    let best = "";
    try {
      for await (const f of Deno.readDir(folder)) if (f.isFile && f.name.endsWith(".log") && f.name > best) best = f.name;
    } catch { /* folder gone */ }
    return best ? join(folder, best) : "";
  };
  let detached = false;
  const stop = () => { detached = true; };
  Deno.addSignalListener("SIGINT", stop);
  Deno.addSignalListener("SIGTERM", stop);
  let cur = "";
  let pos = 0;
  while (!detached) {
    const latest = await newest();
    if (latest && latest !== cur) { cur = latest; pos = 0; } // first file, or rotated → follow the new one
    if (cur) {
      try {
        const st = await Deno.stat(cur);
        if (st.size < pos) pos = 0; // truncated/replaced
        if (st.size > pos) {
          const f = await Deno.open(cur, { read: true });
          try {
            await f.seek(pos, Deno.SeekMode.Start);
            const buf = new Uint8Array(st.size - pos);
            const n = await f.read(buf) ?? 0;
            if (n > 0) await Deno.stdout.write(buf.subarray(0, n));
            pos += n;
          } finally {
            f.close();
          }
        }
      } catch { /* file vanished mid-rotate → re-detect next tick */ }
    }
    if (!(await pidAlive(e.pid))) {
      console.log(`\n%c⟶ the shared process (pid ${e.pid}) exited — run \`sprig dev\` again to start a fresh one.%c`, "color:#a00", "");
      break;
    }
    await new Promise((r) => setTimeout(r, 400));
  }
  Deno.removeSignalListener("SIGINT", stop);
  Deno.removeSignalListener("SIGTERM", stop);
}

/** `dev`/`isolate` import the app's SSR renderer in-process, and that renderer dynamically
 *  imports the app's logic.ts — whose `$.*` aliases live in the APP's deno.json, not the
 *  installed CLI's (~/.sprig) config. So re-run under a MERGED config: the install's compiler
 *  deps (web-tree-sitter + node_modules for grammar.wasm) PLUS the app's own imports (the `$`
 *  aliases, @danet/core, …), with the app's relative paths made absolute.
 *
 *  THE APP'S `@mrg-keystone/sprig` PIN WINS — dev resolves the runtime exactly as prod does
 *  (the stamped jsr pin, or the app's own explicit local override). The old behavior (force
 *  the install's local checkout + `pinLocalSprig` rewriting the app's deno.jsons on disk) made
 *  dev resolve DIFFERENTLY than prod, which hid prod-only failures (a member pinning a second
 *  runtime dual-cores the deploy build but dev'd fine) and leaked local file: paths into
 *  commits when a dev was killed. `stamp()` (which runs before this) keeps pin == CLI version,
 *  so the CLI's local compiler and the app's pinned runtime are the same release.
 *  No-op once merged, or when run from somewhere without an install deno.json. */
async function withMergedConfig(appDir: string): Promise<void> {
  if (Deno.env.get("SPRIG_MERGED")) return;
  if (!import.meta.url.startsWith("file:")) return; // only a local install runs the compiler
  const appAbs = resolve(appDir);
  const appCfgPath = join(appAbs, "deno.json");
  const installDir = installRoot(); // framework/ → install root (file:// guaranteed by the guard above)
  const rtCfgPath = join(installDir, "deno.json");
  if (!(await fileExists(appCfgPath)) || !(await fileExists(rtCfgPath))) return;
  await healLegacyLocalPins(appDir); // recover a deno.json an OLD sprig's killed dev left rewritten
  let appCfg: { imports?: Record<string, string> }, rtCfg: Record<string, unknown>;
  try {
    appCfg = JSON.parse(await Deno.readTextFile(appCfgPath));
    rtCfg = JSON.parse(await Deno.readTextFile(rtCfgPath));
  } catch {
    return; // unparseable config → run as-is
  }
  const imports: Record<string, unknown> = { ...(rtCfg.imports as Record<string, unknown> ?? {}) };
  for (const [k, v] of Object.entries(appCfg.imports ?? {})) {
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
    // import.meta.filename is the file:// path of THIS module — defined here because the early
    // `!import.meta.url.startsWith("file:")` guard already returned for a remote module.
    // --unstable-kv: this merged-config child is the process that ends up running the server
    // (it re-enters dev() past the SPRIG_MERGED guard), so it — not just the supervisor — needs
    // Deno KV enabled for a keep backend that calls Deno.openKv.
    args: ["run", "-A", "--unstable-kv", "--config", mergedPath, import.meta.filename!, ...Deno.args],
    env: { ...Deno.env.toObject(), SPRIG_MERGED: "1" },
    stdin: "inherit",
    stdout: "inherit",
    stderr: "inherit",
  }).output();
  Deno.exit(code);
}

/** Dev/HMR build output lives in a per-project temp dir, NOT the project's static/, so
 *  `sprig dev` never litters the source tree. Stable per project so HMR rebuilds reuse it.
 *  (`sprig build` keeps writing <cwd>/static — the deploy artifact serveSprig reads.) */
function devCacheDir(appDir: string): string {
  const tmp = Deno.env.get("TMPDIR") ?? "/tmp";
  const key = resolve(appDir).replace(/[^A-Za-z0-9]+/g, "-").replace(/(^-|-$)/g, "") || "app";
  return join(tmp, "sprig-dev", key, "static");
}

/** The banner `sprig build --rune` writes into a generated serve.ts. Both writeRuneServe (which
 *  refuses to clobber a serve.ts WITHOUT it) and `sprig clean` (which only removes one WITH it) key
 *  off this exact string, so a hand-written serve.ts is never overwritten nor deleted. */
const RUNE_SERVE_MARKER = "GENERATED by `sprig build --rune`";

async function build(appDir = ".", outDir = join(Deno.cwd(), "static"), rune = false): Promise<void> {
  // --rune: consolidate the workspace config FIRST (pin @mrg-keystone/sprig at the root, strip it from every
  // member) so the client build sees pin-free members that inherit the ONE root runtime — a
  // member's own pin would scope its islands to a second copy (dual-core). Must precede buildClient.
  if (rune) await emitRuneComposition(appDir, outDir);
  // Pin the app's @mrg-keystone/sprig import to THIS CLI's exact version (after --rune has hoisted the
  // pin to the workspace root) so what's declared == what built. Idempotent; skips a local override.
  await stamp(resolve(appDir));
  const srcDir = join(resolve(appDir), "src");
  // ONE build — `sprig dev` serves exactly these bytes (no dev variant). HMR rides on top as a
  // runtime flag (cfg.hmr) + the dormant receiver, never a different bundle.
  const r = await buildClient(srcDir, outDir);
  await writeBuildInfo(resolve(appDir), outDir);
  console.log(
    `sprig build: ${r.islands.length} island chunk(s) ` +
      `[${r.islands.join(", ")}] + ${r.chunks.length} shared chunk(s) → ${outDir} ` +
      `(${(r.bytes / 1024).toFixed(1)}kb, v=${r.hash})`,
  );
}

/** Bake the git provenance block into the served static dir as `build-info.json`. The deploy tooling
 *  (infra) stamps `{ repo, commit, branch, buildTime }` into **`.infra/git.json`** at the repo root
 *  BEFORE the build runs — a server-only sidecar file (it moved OUT of deno.json: a stamp inside the
 *  most-contended file in the repo conflicted every lagging branch at the merge). This copies it
 *  beside the built assets so serveSprig can emit it as `<meta>` in every SSR document head at
 *  runtime (the serving isolate has no git and no repo). Walks up from `appDir` for the nearest
 *  `.infra/git.json`, falling back to a legacy `git` block in `deno.json(c)`; absent (local dev, or
 *  infra didn't stamp) → writes nothing, and the head stays clean. */
async function writeBuildInfo(appDir: string, outDir: string): Promise<void> {
  let git: unknown;
  let dir = resolve(appDir);
  for (;;) {
    // current stamp location: .infra/git.json (the whole file IS the block)
    try {
      const stamp = JSON.parse(await Deno.readTextFile(join(dir, ".infra", "git.json")));
      if (stamp && typeof stamp === "object" && !Array.isArray(stamp)) git = stamp;
    } catch { /* absent / unparseable → try the legacy location */ }
    // legacy location: a `git` key inside deno.json(c)
    if (!git) {
      for (const name of ["deno.json", "deno.jsonc"]) {
        try {
          const cfg = JSON.parse(await Deno.readTextFile(join(dir, name))) as { git?: unknown };
          if (cfg.git && typeof cfg.git === "object" && !Array.isArray(cfg.git)) {
            git = cfg.git;
            break;
          }
        } catch { /* absent / JSONC-with-comments / unparseable → keep walking up */ }
      }
    }
    if (git) break;
    const parent = dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  if (!git) return;
  await Deno.mkdir(outDir, { recursive: true }).catch(() => {});
  await Deno.writeTextFile(join(outDir, "build-info.json"), JSON.stringify(git) + "\n");
  console.log(`sprig: baked build-info.json (git provenance) → ${outDir}`);
}

/** Stamp the app's `@mrg-keystone/sprig` (+ `/keep`) import to the RUNNING CLI's EXACT version, so an
 *  app's declared sprig always matches the CLI that built it — the fix for silent SSR/CLI runtime
 *  drift (a caret pin lets `deno` resolve a sprig NEWER than the CLI that generated the bundle). Walks
 *  from `appDir` up to the filesystem root: the pin lives in the app's own deno.json for a standalone
 *  UI, but at the WORKSPACE ROOT for a `--rune` monorepo (a member inherits the root map) — so it
 *  rewrites whichever deno.json(c) actually declares the key. Idempotent (same keys, exact pin → a
 *  no-op once current) and deliberately conservative:
 *    · only an EXISTING key is touched — never added (an app that doesn't use keep stays that way);
 *    · a LOCAL override (a relative / `file:` value — an intentional dev checkout, incl. `sprig dev`'s
 *      own transient local-pin swap) is left ALONE, so a stamp can never clobber a working local pin.
 *  Called by init, build, and dev (dev stamps BEFORE its local-pin swap so the committed file still
 *  gets the version). `sprig clean` never removes a stamp — it is authored config, not a build file. */
async function stamp(appDir: string): Promise<void> {
  // First, self-heal the jsr SCOPE rename: an app still on the legacy `@sprig/core` / `@sprig/keep`
  // name IS the runtime under its old name and can never dedup with `@mrg-keystone/sprig` (a guaranteed
  // DUAL-CORE build). stamp() only re-pins the VERSION of an EXISTING `@mrg-keystone/sprig` mapping, so
  // it would skip such an app entirely — hence migrate the NAME here, once, before stamping the version.
  await migrateLegacyRuntime(appDir);
  const v = cliVersion();
  if (!v) return; // no on-disk version to stamp with (remote jsr run) → nothing to do
  const wanted: Record<string, string> = {
    "@mrg-keystone/sprig": `jsr:@mrg-keystone/sprig@${v}`,
    "@mrg-keystone/sprig/keep": `jsr:@mrg-keystone/sprig@${v}/keep`,
  };
  let dir = resolve(appDir);
  let stamped = false;
  for (;;) {
    for (const name of ["deno.json", "deno.jsonc"]) {
      const p = join(dir, name);
      let text: string;
      try {
        text = await Deno.readTextFile(p);
      } catch {
        continue; // no config here
      }
      let cfg: { imports?: Record<string, string> };
      try {
        cfg = JSON.parse(text);
      } catch {
        continue; // JSONC-with-comments / unparseable → don't risk a rewrite
      }
      if (!cfg.imports) continue;
      let changed = false;
      for (const [k, want] of Object.entries(wanted)) {
        const cur = cfg.imports[k];
        if (typeof cur !== "string") continue; // only restamp a key that already exists
        if (/^(\.{0,2}\/|\/|file:)/.test(cur)) continue; // leave a LOCAL / file: override alone
        if (cur !== want) {
          cfg.imports[k] = want;
          changed = true;
        }
      }
      if (changed) {
        await Deno.writeTextFile(p, JSON.stringify(cfg, null, 2) + "\n");
        stamped = true;
      }
    }
    const parent = dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  if (stamped) console.log(`sprig: stamped @mrg-keystone/sprig → ${v}`);
}

/** Files whose imports the legacy-name migration rewrites — every runtime-importing source in the app
 *  tree (islands, pages, services, tests), skipping build output + vendored/scaffold dirs. Broader than
 *  `collectTs`: tests import the runtime too, and `.tsx/.js/.jsx/.mjs` can carry an island. */
async function collectSource(dir: string, out: string[] = []): Promise<string[]> {
  let entries: Deno.DirEntry[];
  try {
    entries = [];
    for await (const e of Deno.readDir(dir)) entries.push(e);
  } catch {
    return out; // unreadable dir → nothing to migrate here
  }
  for (const e of entries) {
    const p = join(dir, e.name);
    if (e.isDirectory) {
      // static/ is build output (regenerated); the rest are vendored/scaffold/VCS — never source.
      if (["node_modules", ".git", "static", "isolate", "_isolate"].includes(e.name)) continue;
      await collectSource(p, out);
    } else if (/\.(?:tsx?|jsx?|mjs)$/.test(e.name)) {
      out.push(p);
    }
  }
  return out;
}

/** One-time, idempotent migration of the LEGACY runtime NAME `@sprig/core` / `@sprig/keep` (the jsr
 *  scope before the `@mrg-keystone/*` rename) to `@mrg-keystone/sprig` (+ `/keep`), across BOTH the
 *  import maps (walking up the deno.json layers — a `--rune` monorepo pins at the workspace root) AND
 *  every source import in the app tree. This is what `stamp()` alone can't do: stamp only re-pins the
 *  VERSION of a mapping that is ALREADY named `@mrg-keystone/sprig`, so an app authored against the old
 *  name slips through untouched and then trips the DUAL-CORE guard at build (the legacy package IS the
 *  runtime under its old name — it can never dedup with the new one). Runs before every stamp
 *  (init/build/dev/isolate); a fast no-op once no `@sprig/*` remains, so it self-heals exactly once. */
async function migrateLegacyRuntime(appDir: string): Promise<void> {
  const v = cliVersion();
  const root = resolve(appDir);
  let configs = 0, files = 0;
  // Rename a legacy-scoped import KEY (bare `@sprig/core`/`@sprig/keep` OR a `.../<subpath>` prefix)
  // to the modern scope; a non-legacy key is returned unchanged.
  const migrateKey = (k: string): string =>
    k === "@sprig/core"
      ? "@mrg-keystone/sprig"
      : k === "@sprig/keep"
      ? "@mrg-keystone/sprig/keep"
      : k.startsWith("@sprig/core/")
      ? "@mrg-keystone/sprig/" + k.slice("@sprig/core/".length)
      : k.startsWith("@sprig/keep/")
      ? "@mrg-keystone/sprig/keep/" + k.slice("@sprig/keep/".length)
      : k;
  // Rewrite a value's scope (`@sprig/core@X[/keep]` → `@mrg-keystone/sprig@X[/keep]`) and re-pin the
  // @mrg-keystone/sprig version to the CLI's, so a migrated mapping matches the runtime that builds it.
  const migrateVal = (val: string): string => {
    let out = val.replaceAll("@sprig/core", "@mrg-keystone/sprig").replaceAll("@sprig/keep", "@mrg-keystone/sprig/keep");
    if (v) out = out.replace(/(@mrg-keystone\/sprig)@[^/"']+/g, `$1@${v}`);
    return out;
  };

  // 1) IMPORT MAPS — rename the legacy KEY (and value) to the modern one, walking up to the fs root so
  //    a `--rune` monorepo's workspace-root map is caught too. A pre-existing LOCAL/`file:` override on
  //    the modern key (an intentional dev checkout) is preserved; otherwise it takes the jsr pin (which
  //    the version-stamp below then keeps current). The legacy key is always dropped.
  let dir = root;
  for (;;) {
    for (const name of ["deno.json", "deno.jsonc"]) {
      const p = join(dir, name);
      let cfg: { imports?: Record<string, string> };
      try {
        cfg = JSON.parse(await Deno.readTextFile(p));
      } catch {
        continue; // absent, or JSONC-with-comments/unparseable → don't risk a rewrite (as stamp does)
      }
      const imports = cfg.imports;
      if (!imports) continue;
      let changed = false;
      const next: Record<string, string> = {};
      for (const [k, val] of Object.entries(imports)) {
        const key = migrateKey(k);
        const value = migrateVal(val);
        // A deliberate LOCAL/`file:` override already on the modern key wins — drop the legacy key
        // rather than clobber it (an intentional dev checkout, incl. `sprig dev`'s local-pin swap).
        if (key !== k) {
          const existing = imports[key];
          if (typeof existing === "string" && /^(\.{0,2}\/|\/|file:)/.test(existing)) {
            changed = true;
            continue;
          }
        }
        if (key !== k || value !== val) changed = true;
        next[key] = value;
      }
      if (changed) cfg.imports = next;
      // tasks: rewrite a legacy CLI reference (e.g. `deno run -A jsr:@sprig/core@X/cli build --rune`)
      // to the modern package, so `deno task build` doesn't invoke the pre-rename CLI.
      const tasks = (cfg as { tasks?: Record<string, unknown> }).tasks;
      if (tasks) {
        for (const [tk, tv] of Object.entries(tasks)) {
          if (typeof tv === "string" && (tv.includes("@sprig/core") || tv.includes("@sprig/keep"))) {
            tasks[tk] = migrateVal(tv);
            changed = true;
          }
        }
      }
      if (changed) {
        await Deno.writeTextFile(p, JSON.stringify(cfg, null, 2) + "\n");
        configs++;
      }
    }
    const parent = dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }

  // 2) SOURCE IMPORTS — rewrite the specifiers across the app tree. `@sprig/core`/`@sprig/keep` only
  //    ever appear as module specifiers, so a plain string swap is safe; do `/keep` first so it isn't
  //    shadowed by the `@sprig/core`→`@mrg-keystone/sprig` pass (they don't overlap, but order is clear).
  for (const f of await collectSource(root)) {
    let src: string;
    try {
      src = await Deno.readTextFile(f);
    } catch {
      continue;
    }
    if (!src.includes("@sprig/core") && !src.includes("@sprig/keep")) continue;
    const out = src.replaceAll("@sprig/keep", "@mrg-keystone/sprig/keep").replaceAll("@sprig/core", "@mrg-keystone/sprig");
    if (out !== src) {
      await Deno.writeTextFile(f, out);
      files++;
    }
  }

  if (configs || files) {
    console.log(`sprig: migrated legacy @sprig/core → @mrg-keystone/sprig (${configs} config(s), ${files} source file(s))`);
  }
}

/** `sprig clean [appDir]` — remove everything `sprig build` generated, leaving hand-authored
 *  source untouched. That is exactly two things:
 *    1. the build output dir <ui>/static/ — chunks, app.css, templates.json, .gen/, and the
 *       COPIES of assets/** (the authored originals under <ui>/assets/ stay put).
 *    2. a `--rune`-generated <git root>/serve.ts — only when it carries RUNE_SERVE_MARKER, so a
 *       hand-written serve.ts is never deleted.
 *  It deliberately does NOT touch the shared ~/.cache/sprig-tailwind cache (cross-project, not an
 *  artifact of THIS build) nor revert the deno.json/.gitignore edits `--rune` makes (those are
 *  config merges, not created files) — it reports them so you can undo them if you want. */
async function clean(appArg?: string): Promise<void> {
  const ui = await resolveBuildAppDir(appArg);
  const removed: string[] = [];
  const rel = (p: string) => relative(Deno.cwd(), p) || p;

  const staticDir = join(ui, "static");
  if (await pathExists(staticDir)) {
    await Deno.remove(staticDir, { recursive: true });
    removed.push(rel(staticDir) + "/");
  }

  const gitRoot = gitRepoRoot(ui);
  if (gitRoot) {
    const servePath = join(gitRoot, "serve.ts");
    if (await pathExists(servePath)) {
      const cur = await Deno.readTextFile(servePath).catch(() => "");
      if (cur.includes(RUNE_SERVE_MARKER)) {
        await Deno.remove(servePath);
        removed.push(rel(servePath));
      }
    }
  }

  if (removed.length) {
    console.log(`sprig clean: removed ${removed.length} build artifact(s):\n` + removed.map((r) => `  ${r}`).join("\n"));
  } else {
    console.log(`sprig clean: nothing to remove — no build output under ${rel(ui) || "."}.`);
  }
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
 *  (@mrg-keystone/sprig → the CLI's one runtime). This REPLACES a standalone `deno check` once an app
 *  drops its @mrg-keystone/sprig pin (the CLI is the sole runtime owner): the app authors against the
 *  @mrg-keystone/sprig interface, the CLI supplies the one implementation, so what typechecks is
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
  // 2. no `.git` at all (deploy env): the parent of a `./ui` (or `./app`) package is the project root.
  if (basename(uiAbs) === "ui" || basename(uiAbs) === "app") return dirname(uiAbs);
  // 3. nothing to anchor on — this is the only case that errors.
  console.error(
    `sprig build --rune: cannot locate the project root for\n  ${uiAbs}\n` +
      `  No .git ancestor, and the sprig UI package is not a ./ui or ./app. In an environment\n` +
      `  without git, place the sprig UI in a ./ui (or ./app) directly under the project root\n` +
      `  so --rune can put serve.ts + the workspace there.`,
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
        `not a ./ui or ./app under a parent). --rune composes a monorepo whose sprig UI + rune backend\n` +
        `are siblings — run it from such a repo, or place the sprig UI in a ./ui (or ./app) under the\n` +
        `project root.`,
    );
    Deno.exit(1);
  }
  const uiRel = relative(gitRoot, uiAbs).replace(/\\/g, "/");
  const assetsRel = relative(gitRoot, outDir).replace(/\\/g, "/") || "static";
  // The backend is the canonical `server/` package — no scan, no fallback.
  await assertServerBackend(gitRoot);
  const serverRel = "server";
  await writeRuneServe(gitRoot, uiRel, serverRel, assetsRel);
  await ensureRuneWorkspace(gitRoot, uiRel, serverRel);
  const envHint = (await pathExists(join(gitRoot, ".env"))) ? " --env-file=.env" : "";
  console.log(
    `sprig build --rune: composed ${serverRel}/ (keep) + ${uiRel}/ (sprig) → ${join(gitRoot, "serve.ts")}\n` +
      `  + Deno workspace in ${join(gitRoot, "deno.json")} (members ./${uiRel}, ./${serverRel})\n` +
      `  run it from the git root:  deno serve -A${envHint} serve.ts`,
  );
}

/** A sprig UI package is a dir with a bootstrap/ SHELL — bootstrap/template.html, the document frame
 *  the matched pages render into. A keep backend has a bootstrap/ (mod.ts, config.ts) but NO shell
 *  template, so the shell cleanly tells them apart — note both may have a bootstrap/mod.ts now (the
 *  UI's composition moved there), so that can't be the discriminator. (Legacy: a src/mod.ts UI
 *  export, before routes moved to routers/root/routes.json and the composition to bootstrap/mod.ts.) */
async function isSprigUiDir(dir: string): Promise<boolean> {
  return (await pathExists(join(dir, "bootstrap", "template.html"))) ||
    (await pathExists(join(dir, "src", "mod.ts")));
}

/** Resolve the sprig UI package `sprig build` targets. An EXPLICIT appDir arg is honored as-is.
 *  With none, the composed layout pins the UI at `<git root>/ui` — or `<git root>/app`, the
 *  alternate package name rune's structure spec sanctions (the flat UI-at-root and <cwd>/ui
 *  fallbacks were removed). Works run from the git root OR from inside the UI package (the
 *  git-root walk finds the same dir either way). Exits with a clear "not a ui/+server/ project"
 *  error when neither candidate is a sprig package. */
async function resolveBuildAppDir(appArg?: string): Promise<string> {
  if (appArg) return resolve(appArg); // explicit path wins, as-is
  const cwd = Deno.cwd();
  const gitRoot = gitRepoRoot(cwd);
  const root = gitRoot ?? cwd;
  for (const name of ["ui", "app"]) {
    const d = join(root, name);
    if (await isSprigUiDir(d)) return d;
  }
  console.error(
    `sprig build: not a ui/+server/ project.\n` +
      `  Expected the sprig UI package at ${join(root, "ui")} or ${join(root, "app")}\n` +
      `  (a dir with src/mod.ts or bootstrap/template.html).\n` +
      `  The composed layout is ui/ (or app/) + server/ under the git root — run \`sprig init\` /\n` +
      `  \`rune init\` to scaffold it, or pass the UI package path: sprig build <dir>`,
  );
  Deno.exit(1);
}

/** Resolve the sprig UI package for a command that may run from EITHER the UI package OR the
 *  git root of a monorepo. If `appArg` is itself a UI package (has src/mod.ts), use it; otherwise
 *  find the one UI package among the workspace members / immediate subdirs. Errors clearly on
 *  none / ambiguous. `cmd` labels the message (e.g. "dev", "build --rune"), so the same resolver
 *  serves `sprig dev` and `sprig build --rune` — you can run BOTH from the root or from ui/. */
async function resolveSprigUiDir(appArg: string, cmd: string): Promise<string> {
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
      `sprig ${cmd}: found ${found.length} sprig UI packages (${found.map((c) => relative(abs, c)).join(", ")}).\n` +
        `  Run it from the one you mean, e.g.  cd ${relative(abs, found[0]) || "."} && sprig ${cmd}`,
    );
    Deno.exit(1);
  }
  console.error(
    `sprig ${cmd}: no sprig UI package found at or under ${abs} (a dir with src/mod.ts).\n` +
      `  Run it from the git root of a sprig monorepo, or from the UI package itself.`,
  );
  Deno.exit(1);
}

/** Require the rune/keep backend at the canonical `<gitRoot>/server/bootstrap/mod.ts` — a keep
 *  `bootstrapServer` exporting `api`. The composed layout is exactly `ui/` + `server/`; there is
 *  no scan and no fallback (the flat / arbitrarily-named backend was removed). Errors + exits when
 *  it's missing, so a build can never silently compose against a backend that isn't there. */
async function assertServerBackend(gitRoot: string): Promise<void> {
  const boot = join(gitRoot, "server", "bootstrap", "mod.ts");
  const src = await Deno.readTextFile(boot).catch(() => null);
  if (src !== null && /bootstrapServer\s*\(/.test(src)) return; // a real keep backend
  console.error(
    `sprig build: no keep backend at ${boot}.\n` +
      `  The composed layout is ui/ (or app/) + server/ — the generated serve.ts imports\n` +
      `  "./server/bootstrap/mod.ts". Create that keep bootstrapServer (exporting \`api\`):\n` +
      `  \`rune init\` scaffolds it, or \`rune sync\` a spec to generate it.`,
  );
  Deno.exit(1);
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
  // The backend is the canonical `server/` package: probe <gitRoot>/server/bootstrap/mod.ts
  // for a real keep bootstrapServer. No sibling scan, no arbitrary name — a UI-only app (no
  // server/) returns null and dev runs UI-only.
  const boot = join(gitRoot, "server", "bootstrap", "mod.ts");
  const src = await Deno.readTextFile(boot).catch(() => "");
  if (/bootstrapServer\s*\(/.test(src)) return { gitRoot, serverRel: "server" };
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

/** Load the project's DEFAULT DEV environment: `<projectRoot>/env/dev`, a flat
 *  dotenv-format file per the infra convention (`env/<name>`, cf. `infra resolve`).
 *  Loaded whenever sprig serves locally — after any explicit `.env` and never
 *  overriding vars already set, so `.env` and the shell still win. */
async function loadDefaultDevEnv(fromAbs: string): Promise<void> {
  const p = join(findProjectRoot(fromAbs), "env", "dev");
  try {
    if (!(await Deno.stat(p)).isFile) return;
  } catch {
    return; // no env/dev — nothing to load
  }
  await loadDotEnv(p);
  console.log(`[sprig] env: loaded default dev environment → ${p}`);
}

/** Restart the dev child on ANY change under the PROJECT root outside the app dir
 *  (monorepo parity: a keep/server edit restarts dev just like an app logic edit).
 *  The compiler's own watcher owns the app subtree (template/CSS HMR in place,
 *  logic/server edits already exit DEV_RESTART_CODE), so it is excluded — as are
 *  specs (annotate writes build-notes.json on every click), dot-paths (.git),
 *  node_modules, test output, and logs, else dev would restart-storm itself.
 *  No-op when the app IS the project root (the compiler's watcher already owns it). */
function watchProjectForRestart(rootAbs: string, appAbs: string, restart: (why: string) => void): void {
  if (rootAbs === appAbs) return;
  const appRel = relative(rootAbs, appAbs).replace(/\\/g, "/");
  const ignored = (p: string): boolean => {
    const rel = relative(rootAbs, p).replace(/\\/g, "/");
    if (!rel || rel.startsWith("..")) return true;
    if (rel === appRel || rel.startsWith(`${appRel}/`)) return true;
    return rel.split("/").some((seg) =>
      seg.startsWith(".") || seg === "node_modules" || seg === "spec" ||
      seg === "test-results" || seg === "coverage" || seg.endsWith(".log") ||
      // deno.lock (and deno's atomic-write temps, deno.<hash>.tmp) are derived
      // tooling output the child's own boot rewrites — without this a cold start
      // restarts itself once per lockfile write.
      seg === "deno.lock" || seg.endsWith(".tmp")
    );
  };
  console.log(`[sprig dev] watching ${rootAbs} — changes outside ${appRel}/ restart the server`);
  (async () => {
    let timer: number | undefined;
    for await (const ev of Deno.watchFs(rootAbs, { recursive: true })) {
      const hit = ev.paths.find((p) => !ignored(p));
      if (hit === undefined) continue;
      clearTimeout(timer);
      timer = setTimeout(() => restart(relative(rootAbs, hit)), 300);
    }
  })().catch((e) => {
    console.error(`[sprig dev] repo watcher lost (${e}) — app-dir HMR still active; repo-wide restarts are not`);
  });
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
  const MARKER = RUNE_SERVE_MARKER;
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
  // ZERO composition: serve.ts is ONE line — `serveSprig({ keep: api })`. srcDir (<ui|app>/src),
  // assetsDir (<ui|app>/static), base (/ui), and the bare-/ + favicon redirects are all DERIVED by
  // serveSprig from this file's location + the ui/-or-app/ convention (probed on disk), so no app
  // authors (and can't misauthor) a composition — the assetsDir a hand-written file used to forget
  // is derived and pinned.
  // The only named value is the imported keep backend. The Deno workspace in ./deno.json lets each half
  // keep its own import map; serveSprig binds keep's IN-PROCESS Backend so resolve.ts reads with no TCP.
  const src = [
    `// ${MARKER} — the single-origin composition root at the git root.`,
    `//`,
    `// ONE line: serveSprig folds the rune/keep backend (${serverRel}/) and the sprig UI (${uiRel}/)`,
    `// into a { fetch } default export. srcDir (${uiRel}/src), assetsDir (${assetsRel}/), base (/ui),`,
    `// and the bare-/ + favicon redirects are DERIVED from this file's location + the ${uiRel}/ layout,`,
    `// so the app authors no composition and can't forget assetsDir (the cwd-relative default that`,
    `// shipped ?v=dev to prod). The Deno workspace in ./deno.json lets each half keep its own import`,
    `// map; serveSprig binds keep's IN-PROCESS Backend so the UI's resolve.ts reads data with no TCP.`,
    `//`,
    `//   deno serve -A serve.ts            (add --env-file=.env if your backend reads one)`,
    `//`,
    `//   /ui    → the SSR app        /api/* → the keep backend (token-gated)        /docs → Swagger`,
    `//`,
    `// Re-run \`sprig build\` after changing pages/islands to refresh ${assetsRel}/.`,
    `import { serveSprig } from "@mrg-keystone/sprig/keep";`,
    `import { api } from "./${serverRel}/bootstrap/mod.ts";`,
    ``,
    `export default serveSprig({ keep: api });`,
    ``,
  ].join("\n");
  await Deno.writeTextFile(servePath, src);
  // the composition root is never committed — the deploy build regenerates it and
  // dev composes it in-process, so keep it out of the repo's history entirely.
  await ensureGitignore(gitRoot, "/serve.ts");
}

/** Make the git-root deno.json a Deno workspace over the UI + backend packages, and give it
 *  the two imports serve.ts itself needs (@mrg-keystone/sprig/keep + @std/path) — matched to the UI's
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
  //      · @mrg-keystone/sprig/keep + @std/path — what serve.ts itself imports.
  //      · @mrg-keystone/sprig + @preact/signals-core — needed only when the build runs from a
  //        working-tree (dev-installed) sprig: the generated island entries import the
  //        compiler's hydrate.ts by a file:// path OUTSIDE every member, so its `@mrg-keystone/sprig`
  //        resolves against the ROOT map, not a member's. (Harmless under a JSR sprig, where
  //        hydrate.ts resolves @mrg-keystone/sprig within its own package.)
  const uiCfg = await readJson(join(gitRoot, uiRel, "deno.json"));
  const uiImports = (uiCfg?.imports ?? {}) as Record<string, string>;
  const imports = (cfg.imports && typeof cfg.imports === "object") ? cfg.imports as Record<string, string> : {};
  imports["@mrg-keystone/sprig"] ??= uiImports["@mrg-keystone/sprig"] ?? "jsr:@mrg-keystone/sprig@0.12";
  imports["@mrg-keystone/sprig/keep"] ??= uiImports["@mrg-keystone/sprig/keep"] ?? "jsr:@mrg-keystone/sprig@0.12/keep";
  imports["@std/path"] ??= uiImports["@std/path"] ?? "jsr:@std/path@^1";
  imports["@preact/signals-core"] ??= uiImports["@preact/signals-core"] ?? "npm:@preact/signals-core@^1";
  cfg.imports = imports;
  // 2b. @mrg-keystone/sprig/* belongs at the ROOT only — strip it from every member (like `unstable` below).
  //     A workspace member with its OWN @mrg-keystone/sprig pin scopes its files to that copy; if it
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
    for (const k of ["@mrg-keystone/sprig", "@mrg-keystone/sprig/", "@mrg-keystone/sprig/keep"]) {
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
  await loadDefaultDevEnv(resolve(".")); // <projectRoot>/env/dev — inherited by the child below
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

/** Exit code the dev child uses to ask the supervisor for a fresh restart (a server .ts change). */
const DEV_RESTART_CODE = 75;

/** `sprig dev --no-cache`: a throwaway STANDALONE dev process. No registry entry, no shared ports,
 *  its own ephemeral pid-keyed workbench — so it runs alongside (and independently of) the shared
 *  process or any other `--no-cache`. Free app+iso ports; child stdio inherited (foreground, no log
 *  tee); keeps the respawn-on-DEV_RESTART_CODE loop so hot-reload still works. The temp workbench is
 *  removed on exit; a hard kill just leaves it for the OS to reap. Nothing to clean up in ~/.sprig. */
async function devStandalone(rawArgs: string[], repo: string): Promise<void> {
  const appPortN = freePort(devPorts(repo).app + 1);
  const isoPortN = freePort(appPortN + 1);
  const wbRoot = join(ephemeralWorkBase(), `${repo}-${Deno.pid}`);
  const teardown = async () => {
    // A supervisor kill doesn't always cascade to re-exec'd grandchildren (the app server + the
    // workbench), so reap anything still bound to OUR ports first — THEN drop the ephemeral dir
    // (removing it while a child still runs would pull files out from under it). OS-reaps as backstop.
    try { await killPort(appPortN); await killPort(isoPortN); } catch { /* best effort */ }
    try { Deno.removeSync(wbRoot, { recursive: true }); } catch { /* already gone */ }
  };
  const entry = Deno.mainModule;
  console.log(
    `%c⟶ sprig dev --no-cache — standalone (pid ${Deno.pid}).%c app :${appPortN} · workbench :${isoPortN}\n  ephemeral workbench: ${wbRoot}  (removed on exit / OS-reaped)`,
    "color:#7c3aed;font-weight:bold",
    "",
  );
  try {
    for (;;) {
      const child = new Deno.Command(Deno.execPath(), {
        args: ["run", "-A", "--unstable-kv", entry, "dev", ...rawArgs],
        env: {
          ...Deno.env.toObject(),
          SPRIG_DEV_CHILD: "1",
          PORT: String(appPortN),
          SPRIG_DEV_ISO_PORT: String(isoPortN),
          SPRIG_WB_ROOT: wbRoot,
        },
        stdin: "inherit",
        stdout: "inherit",
        stderr: "inherit",
      }).spawn();
      const fwd = () => {
        try { child.kill("SIGTERM"); } catch { /* already gone */ }
      };
      Deno.addSignalListener("SIGINT", fwd);
      Deno.addSignalListener("SIGTERM", fwd);
      const status = await child.status;
      Deno.removeSignalListener("SIGINT", fwd);
      Deno.removeSignalListener("SIGTERM", fwd);
      if (status.code !== DEV_RESTART_CODE) {
        await teardown();
        Deno.exit(status.code);
      }
    }
  } finally {
    await teardown();
  }
}

/** `sprig dev` supervisor: ONE shared process per git repo (see the registry above). The first run
 *  OWNS it — records { pid, log-folder } in ~/.sprig/dev.json, tees the server+workbench output to a
 *  rotating log, and respawns the child on a DEV_RESTART_CODE exit (the only reliable way to pick up
 *  a changed guard/resolve/mod/logic, import()ed at boot). Later `sprig dev`s for the same repo find
 *  the live pid and ATTACH (stream the log) instead of spawning a duplicate — so nothing accumulates.
 *  Ctrl-C / a crash passes through; a dead owner's stale entry is reclaimed (ports freed) next run. */
async function devSupervisor(rawArgs: string[]): Promise<void> {
  // The registry key is the git repo, so any subdir of a monorepo maps to the one shared process.
  const positionals = rawArgs.filter((a) => !a.startsWith("-") && !/\.html?$/i.test(a));
  const repo = repoKey(resolve(positionals[0] ?? "."));

  // `--no-cache`: a STANDALONE dev process — never attach, never register, its OWN free ports and
  // its OWN ephemeral (pid-keyed) workbench. Runs regardless of who else is dev'ing this repo, and
  // leaves nothing behind (the temp workbench is removed on exit + OS-reaped on a hard kill).
  if (rawArgs.includes("--no-cache")) return await devStandalone(rawArgs, repo);

  // Already running for this repo? Attach — no second server. But `--open` is PER CALL, not a
  // property of the shared process: if the owner was started without it (or the browser was since
  // closed), `sprig dev --open` now must still pop the tab. The server is already listening, so
  // open its URL before streaming the log.
  const existing = (await readDevLock())[repo];
  if (existing && await pidAlive(existing.pid)) {
    if (rawArgs.includes("--open")) {
      // parity with a fresh `--open` owner: pop BOTH surfaces (app+annotate and the workbench).
      const p = devPorts(repo);
      openUrl(`http://localhost:${p.app}${positionals[1] ?? "/ui"}`);
      openUrl(`http://localhost:${p.iso}/`);
    }
    return await attachShared(repo, existing);
  }
  // Stale entry (owner died without cleanup): free the repo's stable ports so an orphaned
  // server/workbench from that dead owner can't linger, then take ownership.
  const ports = devPorts(repo);
  if (existing) {
    await killPort(ports.app);
    await killPort(ports.iso);
  }

  // OWN it: a rotating log folder + our entry in the registry.
  const logFolder = join(sprigStateRoot(), "logs", repo);
  await Deno.mkdir(logFolder, { recursive: true });
  const log = new DevLog(logFolder, MAX_LOG_FILES);
  const map = await readDevLock();
  map[repo] = { pid: Deno.pid, "log-size": MAX_LOG_FILES, "log-folder": logFolder };
  await writeDevLock(map);
  console.log(
    `%c⟶ sprig dev — shared process for "${repo}" (pid ${Deno.pid}).%c Re-running \`sprig dev\` in this repo attaches here.\n  logs: ${logFolder}`,
    "color:#7c3aed;font-weight:bold",
    "",
  );

  // Drop our registry entry on exit — sync (safe in the signal path) and only if it's still OURS.
  let cleaned = false;
  const cleanup = () => {
    if (cleaned) return;
    cleaned = true;
    log.close();
    try {
      const m = JSON.parse(Deno.readTextFileSync(devLockPath())) as Record<string, DevLockEntry>;
      if (m[repo]?.pid === Deno.pid) {
        delete m[repo];
        Deno.writeTextFileSync(devLockPath(), JSON.stringify(m, null, 2));
      }
    } catch { /* nothing to clean */ }
  };

  const entry = Deno.mainModule; // this CLI (file:// checkout or jsr: install) — re-run as the child
  try {
    for (;;) {
      const child = new Deno.Command(Deno.execPath(), {
        // --unstable-kv: a keep backend may use Deno.openKv. PORT/SPRIG_DEV_ISO_PORT pin the repo's
        // stable ports (so reclaim can free them); stdout/stderr are PIPED so we tee → DevLog.
        args: ["run", "-A", "--unstable-kv", entry, "dev", ...rawArgs],
        env: { ...Deno.env.toObject(), SPRIG_DEV_CHILD: "1", PORT: String(ports.app), SPRIG_DEV_ISO_PORT: String(ports.iso) },
        stdin: "inherit",
        stdout: "piped",
        stderr: "piped",
      }).spawn();
      const pump = async (r: ReadableStream<Uint8Array>) => {
        for await (const c of r) await log.write(c); // DevLog tees to this terminal itself
      };
      const pumps = Promise.all([pump(child.stdout), pump(child.stderr)]).catch(() => {});
      const fwd = () => {
        try { child.kill("SIGTERM"); } catch { /* already gone */ }
      };
      Deno.addSignalListener("SIGINT", fwd);
      Deno.addSignalListener("SIGTERM", fwd);
      const status = await child.status;
      // Grace-bounded: a grandchild (the isolate workbench) that inherited the
      // child's stdout keeps the pipe open after the child dies — an unbounded
      // await here wedges the supervisor (no respawn, dead port, silent).
      await Promise.race([pumps, new Promise((r) => setTimeout(r, 2000))]);
      Deno.removeSignalListener("SIGINT", fwd);
      Deno.removeSignalListener("SIGTERM", fwd);
      if (status.code !== DEV_RESTART_CODE) {
        cleanup();
        Deno.exit(status.code);
      }
      await log.write(new TextEncoder().encode(`\n[sprig dev] server change → restarting…\n`));
    }
  } finally {
    cleanup();
  }
}

/** The app's routes, whichever way the app declares them: JSON folder tables
 *  (src/routers/root/routes.json, or the legacy src/root.json — what loadRoutes reads), else the
 *  app's own `src/mod.ts` `routes` export (the code-composed `defineRoutes([...])` style that
 *  `sprig init` scaffolds). Importing mod.ts also evaluates its module-level renderer — harmless
 *  in dev (SPRIG_DEV + SPRIG_ASSETS_DIR are already set, so it reads the prebuilt assets); only
 *  its `routes` export is used. A clear error names BOTH options when neither source exists. */
async function appRoutes(srcDir: string): Promise<Route[]> {
  if (
    await fileExists(join(srcDir, "routers", "root", "routes.json")) ||
    await fileExists(join(srcDir, "root.json"))
  ) {
    return await loadRoutes(srcDir);
  }
  const modPath = join(srcDir, "mod.ts");
  if (await fileExists(modPath)) {
    const mod = await import(toFileUrl(modPath).href) as { routes?: Route[] };
    if (Array.isArray(mod.routes)) return mod.routes;
    throw new Error(
      `sprig dev: ${modPath} exports no \`routes\` array — export ` +
        "`routes = defineRoutes([...])` from it, or add src/routers/root/routes.json.",
    );
  }
  throw new Error(
    `sprig dev: no routes found under ${srcDir} — add src/routers/root/routes.json ` +
      "(folder-composed), or export `routes = defineRoutes([...])` from src/mod.ts.",
  );
}

async function dev(rawArgs: string[] = []): Promise<void> {
  // `sprig dev` ALWAYS serves the full-app BUILD annotate overlay (⌘/Ctrl+click → spec/ui/
  // build-notes.json) plus the isolate workbench. `--annotate <html>` switches to PROTOTYPE
  // annotate (serve that one HTML file standalone); a bare `--annotate` is now a harmless no-op
  // since annotate is the default. Only `sprig build` produces annotate-free output.
  const ai = rawArgs.indexOf("--annotate");
  const open = rawArgs.includes("--open"); // opt-in: only pop the browser when --open is passed (a stray --no-open stays a harmless no-op)
  let annotateHtml = "";
  if (ai >= 0 && rawArgs[ai + 1] && /\.html?$/i.test(rawArgs[ai + 1])) annotateHtml = rawArgs[ai + 1];
  if (annotateHtml) return await devAnnotateHtml(annotateHtml, open);
  // SUPERVISOR: the real dev server runs as a child; a `.ts` change makes it exit with
  // DEV_RESTART_CODE (createDevServer.onServerReload), and we respawn a FRESH process so the app's
  // server (guards/resolve/mod/logic — all import()ed at boot) is re-read. Template/CSS/island
  // edits stay in-process HMR and never restart. Skipped once we're already the child.
  if (Deno.env.get("SPRIG_DEV_CHILD") !== "1") return await devSupervisor(rawArgs);
  const positionals = rawArgs.filter((a) => !a.startsWith("-") && a !== annotateHtml);
  // Resolve the sprig UI package so `sprig dev` runs from EITHER the UI folder OR the monorepo
  // git root — parity with `build --rune`. If the arg isn't itself a UI package (a dir with
  // src/mod.ts), locate the one under it (workspace members / subdirs). Everything below keys off
  // this resolved dir, so the annotate port, build, rune detection, and mod.ts import all agree
  // regardless of where you invoked it. (Runs in the child; the supervisor just forwards rawArgs.)
  const appDir = await resolveSprigUiDir(positionals[0] ?? ".", "dev");
  const base = positionals[1] ?? "/ui";
  // Annotate gets a STABLE port hashed from the app folder name (PORT overrides) — same app, same
  // URL, every run; different apps don't collide. Reuse a same-app server; error on a foreign one
  // or a busy port — never silently drift.
  const wantPort = Number(Deno.env.get("PORT")) || appPort(basename(resolve(appDir)));
  const ping = await annotatePing(wantPort);
  if (ping) {
    // A registered shared process never reaches here — the supervisor attaches
    // before spawning a child. So an annotate server answering on OUR port is a
    // squatter: either an UNMANAGED server for this same app (a zombie from a
    // dead/old-generation supervisor — silently "reusing" it serves stale code
    // with no reload path and no error, the worst failure mode) or a different
    // app entirely. Reclaim the former, refuse the latter loudly.
    // Same derivation as makeAnnotate's notesPath: <specRoot>/spec/ui/build-notes.json.
    const expectedNotes = join(specRootOf(resolve(appDir)), "spec", "ui", "build-notes.json");
    if (ping.mode !== "prototype" && ping.notes === expectedNotes) {
      console.log(
        `sprig dev: port ${wantPort} was held by an unmanaged dev server for this app — reclaiming it.`,
      );
      await killPort(wantPort);
      await new Promise((r) => setTimeout(r, 300));
    } else {
      console.error(
        `sprig dev: port ${wantPort} is already serving ${
          ping.mode === "prototype" ? "a prototype annotate server" : `a DIFFERENT app${ping.notes ? ` (${ping.notes})` : ""}`
        }. Stop it, or set a different PORT.`,
      );
      Deno.exit(1);
    }
  }
  if (!portIsFree(wantPort)) {
    console.error(
      `sprig dev: port ${wantPort} is busy (and isn't an annotate server). Free it, or set a fixed PORT.`,
    );
    Deno.exit(1);
  }
  // Stamp the app's @mrg-keystone/sprig pin to this CLI's version BEFORE withMergedConfig — the
  // merged config carries the APP'S pin (dev resolves the runtime exactly as prod), so the stamp
  // must land first for the child to serve the aligned version.
  await stamp(appDir);
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
  // ONE build — the SAME bytes prod serves. `sprig dev` differs from prod only by the
  // out-of-band HMR activation: SPRIG_DEV (set above) makes the renderer emit cfg.hmr, which
  // wakes the loader's dormant HMR client. The bundle itself is byte-identical to `sprig build`.
  // RUNE PARITY: when this UI is half of a rune monorepo, dev serves EXACTLY the prod composition —
  // serveSprig folding the backend's /api + /docs around the app. Detect it + load its .env FIRST
  // (the keep reads env at module-eval), then OVERLAP the three independent bring-ups instead of
  // running them back-to-back — none shares mutable state, so this only hides wall-clock:
  //   (1) keep backend import (rune/danet DI): started here, awaited after the renderer;
  //   (2) client build + Tailwind css: awaited next;
  //   (3) isolate workbench (a separate process): launched right after the build, so it builds
  //       concurrently with the renderer + keep below rather than sequentially after them.
  const rune = await detectRuneComposition(resolve(appDir));
  if (rune) await loadDotEnv(join(rune.gitRoot, ".env"));
  // The infra env convention: <projectRoot>/env/dev is the default local
  // environment. Loaded after .env (loadDotEnv never overrides, so .env wins).
  await loadDefaultDevEnv(resolve(appDir));
  const keepPromise = rune
    ? import(toFileUrl(join(rune.gitRoot, rune.serverRel, "bootstrap", "mod.ts")).href)
    : null;
  // mark it "handled" so a reject in the window before we await it isn't flagged as unhandled;
  // the real error still surfaces at `await keepPromise!` below (both handlers fire).
  keepPromise?.catch(() => {});

  const port = wantPort; // annotate uses the hashed/validated stable port (no drift).
  const root = installRoot();
  const appAbs = resolve(appDir);
  // The supervisor pins the isolate port (reused across restarts + freeable on reclaim); standalone
  // `sprig dev` falls back to a free one.
  const isoPort = Number(Deno.env.get("SPRIG_DEV_ISO_PORT")) || freePort(port + 1);
  const isoBase = `http://localhost:${isoPort}`;
  // Hoisted so onServerReload / the signal handler can kill the workbench before this process exits.
  let wb: Deno.ChildProcess | null = null;

  // Launch the workbench NOW (separate process) — BEFORE the app build — so its whole build+serve
  // (~1.2s, the slow half) overlaps the app's build + renderer + keep instead of queueing after them.
  // Safe because buildCss now keys its Tailwind input per-outDir, so the two concurrent builds no
  // longer clobber a shared input.css. Best-effort: a missing/failed workbench must NEVER drop dev
  // (the app is the review surface; isolate is the verify surface) — it just warns.
  try {
    await assertWorkbench(root); // throws on an old slim install lacking the workbench
    wb = spawnWorkbench(appAbs, isoPort, open); // workbench opens its own tab when ready
  } catch (e) {
    console.error(`sprig: isolate workbench unavailable (${e instanceof Error ? e.message : e}) — annotate overlay still running.`);
  }

  await build(appDir, outDir);

  // Dev composes its OWN bootstrap (it needs the renderer handle for HMR reparse), but the route
  // SOURCE belongs to the app — and apps come in TWO styles, both of which must dev: folder-
  // composed (routers/root/routes.json + guards/<name>/ — what loadRoutes reads) and code-composed
  // (src/mod.ts exporting `routes = defineRoutes([...])` — what `sprig init` scaffolds). Requiring
  // the folder table alone made `sprig dev` crash at boot on a freshly-scaffolded app.
  const srcDir = join(resolve(appDir), "src");
  const renderer = await createRenderer(srcDir, base, { dev: true });
  const sprigApp = bootstrap({ routes: await appRoutes(srcDir), base, renderer });
  let hostFetch: (req: Request, info: Deno.ServeHandlerInfo) => Promise<Response>;
  if (rune) {
    const { api } = await keepPromise!; // was loading concurrently since above
    const composed = serveSprig({ keep: api, app: sprigApp, base, assetsDir: outDir });
    hostFetch = (req, info) => composed.fetch(req, info);
  } else {
    // pure-UI app: the sprig middleware + the standalone /auth gateway (sessionless legacy mode),
    // so the built-in login()/warmAuth() client works without a keep backend.
    const ui = sprigUi({ app: sprigApp, base, assetsDir: outDir });
    const auth = sprigAuth();
    hostFetch = async (req, info) =>
      (await auth(req)) ?? (await ui(req, info)) ?? new Response("Not Found", { status: 404 });
  }
  const handler = { fetch: hostFetch };
  const devSrv = createDevServer({
    renderer,
    base,
    outDir,
    handler,
    // a .ts change → tear down THIS process cleanly and ask the supervisor for a fresh one.
    onServerReload: () => {
      try {
        wb?.kill("SIGTERM");
      } catch { /* already gone */ }
      Deno.exit(DEV_RESTART_CODE);
    },
  });
  // `spec/ui` is the SHARED contract — anchor it on the git root (sibling of `.git`) so a
  // monorepo's frontend writes to <gitRoot>/spec/ui, not <gitRoot>/frontend/spec/ui. Falls back
  // to appAbs outside a git repo. `srcDir` stays per-app (component discovery is NOT a spec concern).
  const specRoot = specRootOf(appAbs);
  const { makeAnnotate } = await import("./.sprig/annotate.ts");
  const annotate = await makeAnnotate({ specRoot, srcDir: join(appAbs, "src"), isolateBase: isoBase });
  // Monorepo watch: any change under the project root OUTSIDE the app dir (the
  // keep/server half, shared config) restarts this child via the supervisor.
  // The workbench MUST die with us (same as onServerReload): it inherits this
  // process's stdout pipe, and a surviving workbench after a silent exit wedges
  // the supervisor's log pump — no respawn, dead port, no error.
  watchProjectForRestart(findProjectRoot(appAbs), appAbs, (why) => {
    console.log(`[sprig dev] repo change: ${why} → restarting…`);
    try {
      wb?.kill("SIGTERM");
    } catch { /* already gone */ }
    Deno.exit(DEV_RESTART_CODE);
  });
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

  const range = sprigRange();
  const runeSpec = runeRange();
  // sprig's own pins are EXACT (== the running CLI), matching what stamp() enforces on every build;
  // the app's OTHER deps (rune, std) keep their ranges. Falls back to the range if version is unknown.
  const sprigPin = cliVersion() ?? range;
  const files: Record<string, string> = {
    // The git-root Deno WORKSPACE over the two members — sprig owns `ui/`, rune owns
    // `server/`. The dev/build tasks run the sprig CLI from the git root; the `start`
    // task + the `workspace`/`imports` fields are added by ensureRuneWorkspace after
    // this map, and the git-root serve.ts is written by writeRuneServe.
    "deno.json": `{
  "tasks": {
    "dev": "sprig dev",
    "build": "sprig build"
  }
}
`,

    // ui/ — the sprig UI package. `$` IS the UI (ui/src/mod.ts); `$.pages/`, `$.services/`,
    // `$.shared-components/` alias the src subtrees so deep files import siblings without
    // ../../ chains. Plus the two sprig entry points (core + its /keep sub-export); the
    // compiler is CLI-internal. @mrg-keystone/sprig is hoisted to the workspace root by
    // ensureRuneWorkspace so both members share ONE runtime instance.
    "ui/deno.json": `{
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
    "@mrg-keystone/sprig": "jsr:@mrg-keystone/sprig@${sprigPin}",
    "@mrg-keystone/sprig/keep": "jsr:@mrg-keystone/sprig@${sprigPin}/keep",
    "@std/path": "jsr:@std/path@^1",
    "@std/assert": "jsr:@std/assert@^1"
  }
}
`,

    // server/ — the keep backend package. Pins @mrg-keystone/rune (bootstrapServer) +
    // reflect-metadata. `rune init` overlays its spec-driven backend here and merges the
    // engine import map (@/, #std, class-validator, …); `rune sync` lands modules in server/src/.
    "server/deno.json": `{
  "name": "@app/${name}-server",
  "version": "0.0.0",
  "exports": "./bootstrap/mod.ts",
  "compilerOptions": {
    "experimentalDecorators": true,
    "emitDecoratorMetadata": true
  },
  "imports": {
    "@mrg-keystone/rune": "jsr:@mrg-keystone/rune@${runeSpec}",
    "reflect-metadata": "npm:reflect-metadata@0.1.13",
    "@std/assert": "jsr:@std/assert@^1"
  }
}
`,

    "server/bootstrap/mod.ts": [
      `// Your keep backend (jsr:@mrg-keystone/rune). The git-root serve.ts mounts it through`,
      `// serveSprig: the in-process client is bound to the Backend DI token for SSR, and the`,
      `// network handler serves /api/* (token-gated) + /docs. It is imported, never listened`,
      `// on — \`deno serve serve.ts\` owns the socket. Add endpoints by generating rune modules`,
      `// (\`rune sync\` fills the array via server/bootstrap/modules.ts) or hand-writing controllers.`,
      `import "reflect-metadata";`,
      `import { bootstrapServer } from "@mrg-keystone/rune";`,
      ``,
      `export const api = await bootstrapServer("${name}", [], {});`,
      ``,
    ].join("\n"),

    "ui/src/mod.ts": [
      `// The whole app, three declarations. \`routes\` drive everything: a route's \`load\``,
      `// names a page folder (template.html + optional logic.ts class for its data/behavior)`,
      `// — no per-page imports, no module map. Add a page = add a route.`,
      `import {`,
      `  bootstrap,`,
      `  defineRoutes,`,
      `  type Route,`,
      `  type SprigApp,`,
      `} from "@mrg-keystone/sprig";`,
      `import { createRenderer } from "@mrg-keystone/sprig/keep";`,
      `import { dirname, fromFileUrl } from "@std/path";`,
      ``,
      `export const routes: Route[] = defineRoutes([`,
      `  { path: "", load: "pages/home" },`,
      `]);`,
      ``,
      `export const renderer = await createRenderer(`,
      `  dirname(fromFileUrl(import.meta.url)), // ui/src/ root`,
      `  "/ui",`,
      `  { dev: !!Deno.env.get("SPRIG_DEV") },`,
      `);`,
      ``,
      `export const sprigApp: SprigApp = bootstrap({ routes, base: "/ui", renderer });`,
      ``,
    ].join("\n"),

    "ui/src/shell/template.html": [
      `<!-- App shell — the folder MUST be named \`shell\`; the renderer discovers it by name`,
      `     under src/ and renders the matched page into the outlet. -->`,
      `<div class="app-root">`,
      `  <router-outlet></router-outlet>`,
      `</div>`,
      ``,
    ].join("\n"),

    "ui/src/shell/styles.css": [
      `:global(body) {`,
      `  margin: 0;`,
      `  font-family: ui-sans-serif, system-ui, sans-serif;`,
      `  background: #0b1020;`,
      `  color: #e7ecff;`,
      `}`,
      `.app-root { min-height: 100vh; display: grid; place-items: center; }`,
      ``,
    ].join("\n"),

    "ui/src/pages/home/logic.ts": [
      `// A page is its template + this class. onServerInit runs on the server before the`,
      `// page renders — set fields here (fetch data via inject(Backend)) and the template`,
      `// binds to them. The instance is snapshotted to the browser; onBrowserInit runs there.`,
      `import { inject } from "@mrg-keystone/sprig";`,
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

    "ui/src/services/state/mod.ts": [
      `// Your app's persisted state. Add serializable fields and inject(State) anywhere`,
      `// (pages, islands). The framework serializes it to localStorage on every navigation`,
      `// and on reload, and restores it on load — so state survives both. state.reset()`,
      `// restores these defaults AND clears the saved copy in localStorage.`,
      `import { Injectable, StateService } from "@mrg-keystone/sprig";`,
      ``,
      `@Injectable({ providedIn: "root", scope: "both" })`,
      `export default class State extends StateService {`,
      `  static key = "app"; // stable localStorage key (class names are minified in prod)`,
      `  count = 0;`,
      `}`,
      ``,
    ].join("\n"),

    "ui/src/pages/home/template.html": [
      `<!-- \`name\` comes from logic.ts (set in onServerInit) -->`,
      `<main class="home">`,
      `  <h1>Hello, {{ name }} 👋</h1>`,
      `  <p>Edit <code>ui/src/pages/home/template.html</code> — \`sprig dev\` hot-swaps it.</p>`,
      `</main>`,
      ``,
    ].join("\n"),

    "ui/src/pages/home/styles.css": [
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
  await Deno.mkdir(join(appAbs, "ui", "src", "shared-components"), { recursive: true });
  // Compose the git root: the generated serve.ts (serveSprig, importing api from
  // ./server/bootstrap/mod.ts) + the Deno workspace over [./ui, ./server]. writeRuneServe
  // derives srcDir/assetsDir from the ui/ convention; ensureRuneWorkspace hoists
  // @mrg-keystone/sprig to the root so both members share ONE runtime, adds the `start`
  // task, and merges the imports serve.ts needs. Same code `sprig build` runs, so the
  // scaffold and every later build agree on the composition.
  await writeRuneServe(appAbs, "ui", "server", "ui/static");
  await ensureRuneWorkspace(appAbs, "ui", "server");
  // Enforce the exact sprig pin (the template already writes it; this is the same stamp build/dev
  // apply, so init and every later build agree on the key + format). No-op when already current.
  await stamp(appAbs);
  console.log(
    `Scaffolded a sprig app (ui/ + server/) at ${appAbs}\n\n` +
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
/** The base for ALL workbench working dirs — an EPHEMERAL location ($TMPDIR/sprig-work), NOT
 *  ~/.sprig, so the OS reaps idle/abandoned workbenches (reboot + periodic temp cleanup) and nothing
 *  leaks permanently. Safe because materializeWorkbench re-materializes on a miss: a reaped dir just
 *  re-copies the template next run (the version-stamp cache lives inside, so warm runs stay fast). */
function ephemeralWorkBase(): string {
  return join(Deno.env.get("TMPDIR") ?? "/tmp", "sprig-work");
}
/** The per-repo-branch workbench working dir. Keyed by repoKey so two projects — or two branches/
 *  worktrees of one — get physically separate generated previews + build output. Nothing can leak
 *  between them (the cross-project `_preview` pollution that made a `sprig dev` build a foreign app's
 *  islands). `--no-cache` overrides this with a pid-suffixed sibling for a throwaway standalone run. */
function workbenchRoot(appAbs: string): string {
  return join(ephemeralWorkBase(), repoKey(appAbs));
}

function spawnWorkbench(appAbs: string, port: number, open: boolean): Deno.ChildProcess {
  const root = installRoot();
  return new Deno.Command(Deno.execPath(), {
    args: [
      "run", "-A", "--config", join(root, "deno.json"), join(root, "cli", "main.ts"),
      "dev", "--root", appAbs, ...(open ? [] : ["--no-open"]),
    ],
    cwd: root,
    // respect a pre-set SPRIG_WB_ROOT (the --no-cache supervisor pins a unique ephemeral one so it
    // can't collide with the shared owner); otherwise the default per-repo-branch ephemeral dir.
    env: { ...Deno.env.toObject(), PORT: String(port), SPRIG_WB_ROOT: Deno.env.get("SPRIG_WB_ROOT") ?? workbenchRoot(appAbs) },
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
  sprig dev   [appDir] [--annotate <html>] [--open] [--no-cache]  HMR dev server → /ui — ALWAYS serves the
                                  click-to-edit overlay + the isolate workbench (full app). --annotate <html>:
                                  annotate one prototype file instead. Annotate picks a STABLE port hashed from the
                                  app name (PORT overrides); prints the URL and, only with --open, pops it in the
                                  browser. Re-running attaches to the one shared process; --no-cache instead spawns
                                  a SEPARATE standalone process (free ports, own ephemeral workbench) that runs
                                  regardless of who else is dev'ing this repo and leaves nothing behind.
  sprig build [appDir] [--rune]  code-split islands + scope CSS + Tailwind → static/ (default: .; never annotate)
                                  --rune also folds the sibling keep backend + this UI into a git-root
                                  serve.ts (serveSprig) and makes the root deno.json a Deno workspace
  sprig clean [appDir]           remove what build created: <ui>/static/ + any --rune-generated
                                  serve.ts (a hand-written serve.ts is left alone). Alias: build --clean
  sprig check [appDir]           typecheck the app under the CLI runtime (the pin-free
                                  replacement for deno check — the CLI owns the one runtime)
  sprig isolate [appDir]         component/page workbench — develop in isolation (default: .)
  sprig serve [entry]            run the app's host entry under its deno.json (default: serve.ts)
  sprig stop  [appDir]           stop this repo's shared 'sprig dev' process + free its ports
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
  case "clean": {
    await clean(rest.find((a) => !a.startsWith("-")));
    break;
  }
  case "build": {
    // NOTE: `--dev` is gone — there is no dev build variant. `sprig build` emits the ONE
    // bundle; `sprig dev` serves those exact bytes and layers HMR on via a runtime flag.
    // `sprig build --clean` is an alias for `sprig clean` — remove artifacts instead of building.
    if (rest.includes("--clean")) {
      await clean(rest.find((a) => !a.startsWith("-")));
      break;
    }
    // Composing the ui/ + server/ monorepo is the NORMAL build now — no `--rune` flag
    // needed (it's still accepted, harmlessly). Resolve the sprig UI package at
    // <git root>/ui (works run from the root or from inside ui/), build IT to
    // <ui>/static (cwd-independent), then fold in the server/ keep backend + write the
    // git-root serve.ts + workspace deno.json.
    const appArg = rest.find((a) => !a.startsWith("-"));
    const ui = await resolveBuildAppDir(appArg);
    await build(ui, join(ui, "static"), true);
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
  case "stop": {
    // Stop this repo's shared `sprig dev` process (registered in ~/.sprig/dev.json) + free its ports.
    const repo = repoKey(resolve(rest.find((a) => !a.startsWith("-")) ?? "."));
    const map = await readDevLock();
    const e = map[repo];
    if (!e) {
      console.log(`sprig: no shared dev process registered for "${repo}".`);
      break;
    }
    try { Deno.kill(e.pid, "SIGTERM"); } catch { /* already gone */ }
    const ports = devPorts(repo);
    await killPort(ports.app);
    await killPort(ports.iso);
    delete map[repo];
    await writeDevLock(map);
    console.log(`sprig: stopped the shared dev process for "${repo}" (pid ${e.pid}).`);
    break;
  }
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
