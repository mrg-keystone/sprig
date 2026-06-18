// GitHub-release install/update for isolate. The release ships ONE bundle
// (cli/ + server/ + ui/ + skills/); we extract the runtime to ~/.isolate, copy
// the skills to ~/.claude/skills/<name>, and (re)install the global `isolate`
// bin from ~/.isolate/cli/main.ts — installing from that LOCAL path is what makes
// the CLI's `../../ui` / `../../server` file reads + subprocess spawns resolve.
//
// Used by `isolate update` (updateFromGitHub) and, when run as the entrypoint, as
// the finisher the bootstrap install.ts calls once the bundle is in ~/.isolate.
import { dirname, join } from "#std/path";
import { copy } from "#std/fs";

const REPO = "mrg-keystone/isolate";
const CLI_NAME = "isolate";
const UA = {
  "user-agent": "isolate-cli; https://github.com/mrg-keystone/isolate",
};

function home(): string {
  const h = Deno.env.get("HOME") ?? Deno.env.get("USERPROFILE");
  if (!h) {
    console.error("✗ HOME not set — cannot locate ~/.isolate or ~/.claude.");
    Deno.exit(1);
  }
  return h;
}

export function runtimeDir(): string {
  return join(home(), ".isolate");
}

async function exists(p: string): Promise<boolean> {
  try {
    await Deno.stat(p);
    return true;
  } catch {
    return false;
  }
}

export interface Release {
  tag: string;
  /** A built `isolate-*.tar.gz` asset URL when present, else the source tarball. */
  tarball: string;
  /** Whether `tarball` is GitHub's source archive (wraps everything in one dir). */
  isSource: boolean;
}

export async function latestRelease(): Promise<Release> {
  const res = await fetch(
    `https://api.github.com/repos/${REPO}/releases/latest`,
    { headers: { ...UA, accept: "application/vnd.github+json" } },
  );
  if (!res.ok) {
    throw new Error(
      `GitHub API ${res.status} ${res.statusText} — could not read the latest release.`,
    );
  }
  // deno-lint-ignore no-explicit-any
  const j: any = await res.json();
  // deno-lint-ignore no-explicit-any
  const asset = (j.assets ?? []).find((a: any) =>
    /^isolate-.*\.tar\.gz$/.test(a.name)
  );
  return {
    tag: j.tag_name as string,
    tarball: asset ? asset.browser_download_url : j.tarball_url,
    isSource: !asset,
  };
}

/** Download + untar a release into a fresh temp dir; returns the bundle dir. */
async function fetchBundle(rel: Release): Promise<string> {
  const tmp = await Deno.makeTempDir({ prefix: "isolate-rel-" });
  const tgz = join(tmp, "bundle.tar.gz");
  const res = await fetch(rel.tarball, { headers: UA });
  if (!res.ok) {
    throw new Error(`download failed: ${res.status} ${res.statusText}`);
  }
  await Deno.writeFile(tgz, new Uint8Array(await res.arrayBuffer()));
  const ex = join(tmp, "bundle");
  await Deno.mkdir(ex, { recursive: true });
  const { success, stderr } = await new Deno.Command("tar", {
    args: [
      "-xzf",
      tgz,
      "-C",
      ex,
      // source archives wrap everything in <repo>-<sha>/; strip it.
      ...(rel.isSource ? ["--strip-components=1"] : []),
    ],
    stdout: "null",
    stderr: "piped",
  }).output();
  if (!success) {
    throw new Error("tar failed: " + new TextDecoder().decode(stderr).trim());
  }
  return ex;
}

/** Swap a freshly-downloaded bundle into ~/.isolate (atomic-ish). */
export async function extractToRuntime(rel: Release): Promise<string> {
  const bundle = await fetchBundle(rel);
  const dest = runtimeDir();
  const bak = dest + ".old";
  await Deno.remove(bak, { recursive: true }).catch(() => {});
  await Deno.mkdir(dirname(dest), { recursive: true });
  if (await exists(dest)) await Deno.rename(dest, bak).catch(() => {});
  try {
    await Deno.rename(bundle, dest);
  } catch {
    // cross-device rename (temp on another fs) — fall back to a copy.
    await copy(bundle, dest, { overwrite: true });
  }
  await Deno.remove(bak, { recursive: true }).catch(() => {});
  return dest;
}

function skillNameFrom(md: string, fallback: string): string {
  const m = md.match(/^name:\s*(\S+)/m);
  return m ? m[1] : fallback;
}

/** Copy each bundled skill into ~/.claude/skills/<name> (never deletes a checkout). */
export async function installSkills(bundleDir: string): Promise<void> {
  const src = join(bundleDir, "skills");
  if (!(await exists(src))) {
    console.warn("⚠ bundle has no skills/ — skipping skill install.");
    return;
  }
  const skillsRoot = join(home(), ".claude", "skills");
  await Deno.mkdir(skillsRoot, { recursive: true });
  for await (const e of Deno.readDir(src)) {
    if (!e.isDirectory) continue;
    const dir = join(src, e.name);
    const mdPath = join(dir, "SKILL.md");
    if (!(await exists(mdPath))) continue; // not an installable skill
    const name = skillNameFrom(await Deno.readTextFile(mdPath), e.name);
    const target = join(skillsRoot, name);
    // Never delete a git checkout — a dev layout keeps the repo inside the skill.
    if (await exists(join(target, ".git"))) {
      console.error(
        `✗ ${target} holds a git checkout — skipping '${name}' (use a dev symlink).`,
      );
      continue;
    }
    await Deno.remove(target, { recursive: true }).catch(() => {});
    await copy(dir, target, { overwrite: true });
    console.log(`✓ skill '${name}' → ${target}`);
  }
}

/** (Re)install the global `isolate` bin from the bundle's local cli/main.ts. */
export async function installBin(bundleDir: string): Promise<void> {
  const cliDir = join(bundleDir, "cli");
  const entry = join(cliDir, "main.ts");
  // Run from cliDir + pass --config so deno discovers cli/deno.json's import map
  // (otherwise subpath specifiers like @cliffy/ansi/colors aren't resolved).
  const config = join(cliDir, "deno.json");
  const { success } = await new Deno.Command("deno", {
    args: ["install", "-gA", "-f", "-c", config, "-n", CLI_NAME, entry],
    cwd: cliDir,
    stdout: "inherit",
    stderr: "inherit",
  }).output();
  if (!success) {
    console.warn(
      `⚠ couldn't install the '${CLI_NAME}' bin. Add it manually:\n` +
        `    deno install -gA -f -c ${config} -n ${CLI_NAME} ${entry}`,
    );
    return;
  }
  // Warm the dependency cache so the first run isn't a download.
  await new Deno.Command("deno", {
    args: ["cache", "-c", config, entry],
    cwd: cliDir,
    stdout: "null",
    stderr: "null",
  }).output().catch(() => {});
  console.log(`✓ '${CLI_NAME}' bin → ${entry}`);
}

/** Skills + bin from an already-extracted bundle (default: ~/.isolate). */
export async function finishInstall(bundleDir = runtimeDir()): Promise<void> {
  await installSkills(bundleDir);
  await installBin(bundleDir);
}

/** Full update: fetch the latest release, swap ~/.isolate, install skills + bin. */
export async function updateFromGitHub(): Promise<void> {
  const rel = await latestRelease();
  console.log(`Latest isolate release: ${rel.tag}`);
  const dest = await extractToRuntime(rel);
  console.log(`✓ runtime → ${dest}`);
  await finishInstall(dest);
  console.log(
    `✓ isolate ${rel.tag} installed (cli + ui + server + skills). Run 'isolate --help'.`,
  );
}

// Run directly = the finisher the bootstrap install.ts invokes after it has
// placed the bundle at ~/.isolate (skills + bin only; no re-download).
if (import.meta.main) {
  await finishInstall();
}
