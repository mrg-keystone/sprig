// Local runtime install for the sprig CLI. Running the CLI straight from JSR can't load
// the tree-sitter compiler (its grammar.bin + web-tree-sitter need a real on-disk
// node_modules, which a bare `deno run jsr:…` doesn't provide). So `sprig install` /
// `sprig update` download the SOURCE bundle from the GitHub release, extract it to
// ~/.sprig, run `deno install` THERE to populate node_modules on THIS machine (the bundle
// ships no node_modules), install the skills, and write a `sprig` launcher that runs the
// CLI from ~/.sprig — so the compiler loads grammar.bin from a known local path with its
// deps present.
import { dirname, join } from "@std/path";
import { copy } from "@std/fs";
import { installSkills } from "./skills.ts";

const REPO = "theTechGoose/sprig";
const RUNTIME_TAG = "runtime-latest"; // the rolling release tag release.yml maintains
const UA = { "user-agent": "sprig-install; https://github.com/theTechGoose/sprig" };

function home(): string {
  return Deno.env.get("HOME") ?? Deno.env.get("USERPROFILE") ?? "";
}

/** The known local install location the CLI runs from. */
export function runtimeDir(): string {
  return Deno.env.get("SPRIG_HOME") ?? join(home(), ".sprig");
}

function binDir(): string {
  return join(Deno.env.get("DENO_INSTALL_ROOT") ?? join(home(), ".deno"), "bin");
}

async function pathExists(p: string): Promise<boolean> {
  try {
    await Deno.stat(p);
    return true;
  } catch {
    return false;
  }
}

/** The deployment's source bundle: a `sprig-runtime*.tar.gz` release asset (preferred),
 *  else the default-branch source archive. `strip` is how many leading path components
 *  `tar` drops to surface the bundle root (framework/, packages/, deno.json, skills/). */
async function bundleUrl(): Promise<{ url: string; strip: number }> {
  try {
    const res = await fetch(`https://api.github.com/repos/${REPO}/releases/tags/${RUNTIME_TAG}`, {
      headers: { ...UA, accept: "application/vnd.github+json" },
    });
    if (res.ok) {
      // deno-lint-ignore no-explicit-any
      const j: any = await res.json();
      // deno-lint-ignore no-explicit-any
      const asset = (j.assets ?? []).find((a: any) => /^sprig-runtime.*\.tar\.gz$/.test(a.name));
      if (asset) return { url: asset.browser_download_url, strip: 0 };
    }
  } catch { /* offline / no release → default branch */ }
  return { url: `https://github.com/${REPO}/archive/refs/heads/main.tar.gz`, strip: 1 };
}

/** Download + extract the source bundle into a fresh temp dir; returns the bundle root. */
async function fetchBundle(): Promise<string> {
  const { url, strip } = await bundleUrl();
  const tmp = await Deno.makeTempDir({ prefix: "sprig-runtime-" });
  const tgz = join(tmp, "bundle.tar.gz");
  const res = await fetch(url, { headers: UA });
  if (!res.ok) throw new Error(`download failed: ${res.status} ${res.statusText}`);
  await Deno.writeFile(tgz, new Uint8Array(await res.arrayBuffer()));
  const ex = join(tmp, "bundle");
  await Deno.mkdir(ex, { recursive: true });
  const { success, stderr } = await new Deno.Command("tar", {
    args: ["-xzf", tgz, "-C", ex, ...(strip ? [`--strip-components=${strip}`] : [])],
    stdout: "null",
    stderr: "piped",
  }).output();
  if (!success) throw new Error("tar failed: " + new TextDecoder().decode(stderr).trim());
  return ex;
}

/** Swap a freshly-downloaded bundle into ~/.sprig (keep a .old backup until it lands). */
async function swapIntoRuntime(bundle: string): Promise<string> {
  const dest = runtimeDir();
  const bak = dest + ".old";
  await Deno.remove(bak, { recursive: true }).catch(() => {});
  await Deno.mkdir(dirname(dest), { recursive: true });
  if (await pathExists(dest)) await Deno.rename(dest, bak).catch(() => {});
  try {
    await Deno.rename(bundle, dest);
  } catch {
    await copy(bundle, dest, { overwrite: true }); // cross-device temp → copy
  }
  await Deno.remove(bak, { recursive: true }).catch(() => {});
  return dest;
}

/** `deno install` in `dir` → populate node_modules on THIS machine (the bundle ships none).
 *  This is what makes the tree-sitter compiler's web-tree-sitter + grammar.bin load. */
async function denoInstall(dir: string): Promise<void> {
  const { success, stderr } = await new Deno.Command(Deno.execPath(), {
    args: ["install"],
    cwd: dir,
    stdout: "inherit",
    stderr: "piped",
  }).output();
  if (!success) {
    console.warn(
      "sprig: `deno install` failed in " + dir + " — the compiler needs node_modules, so " +
        "`sprig dev`/`build` may not start:\n" + new TextDecoder().decode(stderr).trim(),
    );
  }
}

/** Write the global `sprig` launcher: runs the CLI from `entryDir` (its local files +
 *  node_modules + grammar.bin), forcing `entryDir/deno.json` so the compiler's deps
 *  resolve no matter the cwd. */
export async function installLauncher(entryDir: string): Promise<void> {
  const dir = binDir();
  await Deno.mkdir(dir, { recursive: true });
  const bin = join(dir, "sprig");
  await Deno.writeTextFile(
    bin,
    `#!/bin/sh\n` +
      `# generated by 'sprig install' — runs the CLI from a known local install so the\n` +
      `# tree-sitter compiler loads grammar.bin + node_modules from disk.\n` +
      `exec deno run -A --config '${join(entryDir, "deno.json")}' '${join(entryDir, "framework", "cli.ts")}' "$@"\n`,
  );
  await Deno.chmod(bin, 0o755);
  console.log(`Installed the sprig launcher -> ${bin}`);
}

/** Full install from the deployment: download the source bundle → ~/.sprig → `deno install`
 *  (node_modules on THIS machine) → skills → the `sprig` launcher. */
export async function installRuntimeFromDeployment(): Promise<void> {
  console.log("Downloading the sprig runtime bundle…");
  const bundle = await fetchBundle();
  const dest = await swapIntoRuntime(bundle);
  console.log(`✓ runtime → ${dest}`);
  console.log("Installing node_modules on this machine (deno install)…");
  await denoInstall(dest);
  await installSkills(join(dest, "skills"));
  await installLauncher(dest);
}

/** The release `sprig update` would install — its version + GitHub publish time, read from the
 *  `runtime-latest` GitHub release. release.yml locksteps this with JSR (it runs after the JSR
 *  publish + bump) and stamps the version into the release title (`sprig runtime <v>`) and notes
 *  (`version: <v>`), so read it straight from there. Falls back to reading deno.json at the build
 *  commit named in the body (older releases predating the stamp). NOT a JSR lookup — JSR is a
 *  separate pipeline. Returns null if the network/registry is unreachable (so `sprig -v` still
 *  prints the local version offline). */
export async function latestRuntimeRelease(): Promise<
  { version: string; publishedAt: string | null } | null
> {
  const SEMVER = /\b(\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?)\b/;
  try {
    const rel = await fetch(`https://api.github.com/repos/${REPO}/releases/tags/${RUNTIME_TAG}`, {
      headers: { ...UA, accept: "application/vnd.github+json" },
      signal: AbortSignal.timeout(4000),
    });
    if (!rel.ok) return null;
    // deno-lint-ignore no-explicit-any
    const j: any = await rel.json();
    // GitHub's release publish time. NOTE: `runtime-latest` is a ROLLING tag, so this is the
    // time of whatever version it currently points at — accurate for the local install ONLY
    // when local === this version. The bundle's local `build-info.json` stamp is authoritative.
    const publishedAt = typeof j.published_at === "string" ? j.published_at : null;
    // Preferred: the stamped version in the notes (`version: 0.10.3`) or title (`sprig runtime 0.10.3`).
    const stamped = (j.body ?? "").match(/version:\s*(\S+)/i)?.[1] ??
      (j.name ?? "").match(SEMVER)?.[1];
    if (stamped) return { version: stamped, publishedAt };
    // Fallback for pre-stamp releases: read deno.json at the build commit named in the body.
    const sha = (j.body ?? "").match(/\b([0-9a-f]{40})\b/)?.[1] ?? "main";
    const cfg = await fetch(`https://raw.githubusercontent.com/${REPO}/${sha}/deno.json`, {
      headers: UA,
      signal: AbortSignal.timeout(4000),
    });
    if (!cfg.ok) return null;
    const meta = await cfg.json();
    return typeof meta.version === "string" ? { version: meta.version, publishedAt } : null;
  } catch {
    return null;
  }
}

/** Back-compat: just the version string `sprig update` would install. */
export async function latestRuntimeVersion(): Promise<string | null> {
  return (await latestRuntimeRelease())?.version ?? null;
}

/** Dev install: wire the launcher to THIS checkout (it already has node_modules + the
 *  wasm) and install its skills — for repo devs (`deno task install:dev`). */
export async function installRuntimeFromWorkingTree(repoRoot: string): Promise<void> {
  await denoInstall(repoRoot);
  await installSkills(join(repoRoot, "skills"));
  await installLauncher(repoRoot);
}

// --- isolate workbench -----------------------------------------------------
// The `sprig isolate` workbench — its UI (app/), the keep discovery/test-runner backend
// (server/), the orchestrator (cli/), and the composition root (serve.ts) — ships WITH the
// runtime bundle (see .github/workflows/release.yml) and lands in ~/.sprig on `sprig install`
// / `sprig update`, where `deno install` builds its node_modules. `sprig isolate` runs it from
// there — no lazy download, no checkout dependency.

/** The workbench parts the runtime bundle installs alongside the framework. */
const WORKBENCH_PARTS = ["app", "server", "cli", "serve.ts"];

/** Throw a clear, actionable error if the workbench isn't installed next to the framework in
 *  `root` (an old slim install predating the bundled workbench). `sprig update` installs it. */
export async function assertWorkbench(root: string): Promise<void> {
  const missing: string[] = [];
  for (const p of WORKBENCH_PARTS) {
    if (!(await pathExists(join(root, p)))) missing.push(p);
  }
  if (missing.length) {
    throw new Error(
      `isolate workbench not installed (missing ${missing.join(", ")} under ${root}).\n` +
        "  ▸ run `sprig update` to install the workbench + its deps.",
    );
  }
}
