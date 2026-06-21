// GitHub-release install/update for isolate. The release ships ONE bundle
// (deno.json + deno.lock + cli/ + server/ + ui/ + skills/ — a self-contained Deno
// workspace); we extract it to ~/.isolate, `deno install` its node_modules, copy the
// skills (as isolate:<name>) + shared contracts (interfaces/) to ~/.claude/skills/, and
// (re)install the global `isolate` bin from ~/.isolate/cli/main.ts against the WORKSPACE
// ROOT config — so the CLI's in-process keep import (`../../server`) + `../../ui` reads
// resolve standalone, with no dependency on a dev checkout or symlinks.
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
  // Strip surrounding quotes — YAML names are quoted (`name: "isolate:build"`).
  return m ? m[1].replace(/^["']|["']$/g, "") : fallback;
}

/**
 * Install the bundled skills + shared contracts FLAT under ~/.claude/skills.
 * The umbrella is an `isolate:` NAMESPACE PREFIX (isolate:build, isolate:breakdown, …) —
 * `:` is Claude Code's plugin:skill separator, so a flat colon-named folder reads as the
 * `isolate` namespace. (A nested ~/.claude/skills/isolate/<name> would NOT load — only
 * direct children of ~/.claude/skills are discovered; the colon flattens the namespace.)
 * Contracts go to ~/.claude/skills/interfaces so the cross-skill `../interfaces/<x>.md`
 * path resolves (skills + interfaces stay siblings, as in the dev checkout).
 * Never deletes a git checkout.
 */
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
    // The shared contracts dir has no SKILL.md; carry it verbatim (unprefixed) so
    // every skill resolves `../interfaces/<artifact>.md` as a flat sibling.
    if (e.name === "interfaces") {
      const target = join(skillsRoot, "interfaces");
      await Deno.remove(target, { recursive: true }).catch(() => {});
      await copy(dir, target, { overwrite: true });
      console.log(`✓ contracts → ${target}`);
      continue;
    }
    const mdPath = join(dir, "SKILL.md");
    if (!(await exists(mdPath))) continue; // not an installable skill
    const name = skillNameFrom(await Deno.readTextFile(mdPath), e.name);
    // Enforce the `isolate:` namespace prefix even if a SKILL.md frontmatter omits it.
    const installName = name.startsWith("isolate:") ? name : `isolate:${name}`;
    const target = join(skillsRoot, installName);
    // Never delete a git checkout — a dev layout keeps the repo inside the skill.
    if (await exists(join(target, ".git"))) {
      console.error(
        `✗ ${target} holds a git checkout — skipping '${installName}' (use a dev symlink).`,
      );
      continue;
    }
    await Deno.remove(target, { recursive: true }).catch(() => {});
    await copy(dir, target, { overwrite: true });
    console.log(`✓ skill '${installName}' → ${target}`);
  }
}

/**
 * Populate the runtime's node_modules. The workspace is `nodeModulesDir: manual`, so
 * the in-process keep backend's npm deps (reflect-metadata, class-validator, …) and the
 * ui's Vite deps must be installed into ~/.isolate/node_modules — the bundle ships
 * deno.json + deno.lock but never node_modules. Idempotent; resolves from the lockfile.
 */
export async function installDeps(bundleDir: string): Promise<void> {
  const { success, stderr } = await new Deno.Command("deno", {
    args: ["install"], // workspace-wide; reads bundleDir/deno.json + deno.lock
    cwd: bundleDir,
    stdout: "null",
    stderr: "piped",
  }).output();
  if (!success) {
    console.warn(
      "⚠ `deno install` failed in the runtime — the in-process keep backend needs " +
        "node_modules, so the CLI may not start:\n" +
        new TextDecoder().decode(stderr).trim(),
    );
    return;
  }
  console.log(`✓ deps → ${join(bundleDir, "node_modules")}`);
}

/**
 * Install the global `isolate` bin as a tiny launcher that defers to `deno run`.
 * We can't use `deno install -g`: the CLI's module graph crosses Deno workspace
 * members (cli → the server's keep backend), and `deno install` resolves against a
 * single config — with `-c` it ignores the OTHER member's import map (the cli's
 * `@cliffy/*` subpaths OR the server's `@/`), and without `-c` it ignores the
 * config entirely. `deno run` instead auto-discovers the workspace from the entry
 * and composes EVERY member map — independent of the user's cwd (verified from
 * inside a project that has its own deno.json). So the bin just runs it.
 */
export async function installBin(bundleDir: string): Promise<void> {
  const entry = join(bundleDir, "cli", "main.ts");
  const binDir = join(
    Deno.env.get("DENO_INSTALL_ROOT") ?? join(home(), ".deno"),
    "bin",
  );
  await Deno.mkdir(binDir, { recursive: true });
  const binPath = join(binDir, CLI_NAME);
  // Single-quote the entry path (install paths never contain a single quote).
  await Deno.writeTextFile(
    binPath,
    `#!/bin/sh\n` +
      `# generated by isolate install — runs the in-process-keep CLI from the\n` +
      `# ~/.isolate workspace (deno discovers the workspace from the entry).\n` +
      `exec deno run -A '${entry}' "$@"\n`,
  );
  await Deno.chmod(binPath, 0o755);
  // Warm the cache so the first run isn't a download (errors here are harmless).
  await new Deno.Command("deno", {
    args: ["cache", entry],
    cwd: join(bundleDir, "cli"),
    stdout: "null",
    stderr: "null",
  }).output().catch(() => {});
  console.log(`✓ '${CLI_NAME}' bin → ${binPath}`);
}

/** Skills + bin from an already-extracted bundle (default: ~/.isolate). */
export async function finishInstall(bundleDir = runtimeDir()): Promise<void> {
  await installDeps(bundleDir);
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
