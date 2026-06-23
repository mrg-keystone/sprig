// Claude Code skill deployment. Installs every skill in a `skills/` dir into the
// USER-SCOPE skills dir — ${CLAUDE_SKILLS_DIR:-$HOME/.claude/skills} — using
// BASE-LEVEL (whole-folder) replace: the base unit is the skill NAME (its top-level
// folder), so a colliding skill is replaced OUTRIGHT (user files added inside that
// folder do not survive). Skills with other names are left untouched; new names are
// created. The merge is `skillFolder = { ...skillFolder, ...toInstall }` keyed by
// folder name.
//
// Used by `sprig install` (dev: the working-tree skills/) and `sprig update`
// (installSkillsFromDeployment: the skills/ packaged into the GitHub release, with
// the default branch as a fallback — so it always lands the LATEST skills regardless
// of which installed CLI version is doing the update).
import { basename, join } from "@std/path";
import { copy } from "@std/fs";

const REPO = "theTechGoose/sprig";
const UA = { "user-agent": "sprig-skills; https://github.com/theTechGoose/sprig" };

function home(): string {
  return Deno.env.get("HOME") ?? Deno.env.get("USERPROFILE") ?? "";
}

async function pathExists(p: string): Promise<boolean> {
  try {
    await Deno.lstat(p);
    return true;
  } catch {
    return false;
  }
}

/** Destination = user scope. NEVER a project/checkout path. Honors CLAUDE_SKILLS_DIR. */
export function skillsDest(): string {
  return Deno.env.get("CLAUDE_SKILLS_DIR") ?? join(home(), ".claude", "skills");
}

/** Skip cleanly when Claude Code is absent (no ~/.claude AND no explicit override) so
 *  the surrounding CLI/tool install still succeeds. An explicit CLAUDE_SKILLS_DIR
 *  override always proceeds (e.g. a sandbox). */
async function claudeAbsent(): Promise<boolean> {
  if (Deno.env.get("CLAUDE_SKILLS_DIR")) return false;
  return !(await pathExists(join(home(), ".claude")));
}

/** Base-level replace: unlink a symlink first, `rm -rf "$dst"`, then `cp -R "$src" "$dst"`. */
async function replaceFolder(src: string, dst: string): Promise<void> {
  try {
    if ((await Deno.lstat(dst)).isSymlink) await Deno.remove(dst);
  } catch { /* dst absent */ }
  await Deno.remove(dst, { recursive: true }).catch(() => {});
  await copy(src, dst, { overwrite: true });
}

/**
 * Install/update ONE skill folder by base-level replace.
 * Guard: a source dir without SKILL.md is skipped with a warning — EXCEPT the
 * `interfaces` shared-contracts sibling, which every skill resolves via
 * `../interfaces/<artifact>.md`, so it is carried wholesale like a skill.
 * Never clobbers a dev git checkout living at the destination.
 */
export async function installSkill(src: string, destRoot: string): Promise<void> {
  const name = basename(src);
  if (name !== "interfaces" && !(await pathExists(join(src, "SKILL.md")))) {
    console.warn(`sprig: skip '${name}' (no SKILL.md).`);
    return;
  }
  const dst = join(destRoot, name);
  if (await pathExists(join(dst, ".git"))) {
    console.warn(`sprig: skip '${name}' — ${dst} holds a git checkout (use a dev symlink).`);
    return;
  }
  await replaceFolder(src, dst);
  console.log(`Installed the ${name} skill -> ${dst}/`);
}

/** Install/update EVERY skill under `skillsDir` into the user-scope skills dir. */
export async function installSkills(skillsDir: string): Promise<void> {
  if (await claudeAbsent()) {
    console.log("sprig: ~/.claude not found — skipping Claude Code skills.");
    return;
  }
  if (!(await pathExists(skillsDir))) {
    console.warn(`sprig: no skills dir at ${skillsDir} — skipping skill install.`);
    return;
  }
  const dest = skillsDest();
  await Deno.mkdir(dest, { recursive: true });
  for await (const e of Deno.readDir(skillsDir)) {
    if (!e.isDirectory) continue;
    await installSkill(join(skillsDir, e.name), dest);
  }
}

/** The deployment's skills tarball: a release `sprig-skills*.tar.gz` asset when present,
 *  else the default-branch source archive (which contains skills/). `strip` is how many
 *  leading path components `tar` must drop to surface a top-level `skills/`. */
const SKILLS_TAG = "skills-latest"; // the rolling release tag release.yml maintains

async function skillsTarball(): Promise<{ url: string; strip: number }> {
  try {
    // The dedicated, deterministic skills release (not /releases/latest, which a JSR
    // version release could shadow) — its `sprig-skills.tar.gz` asset packs skills/.
    const res = await fetch(`https://api.github.com/repos/${REPO}/releases/tags/${SKILLS_TAG}`, {
      headers: { ...UA, accept: "application/vnd.github+json" },
    });
    if (res.ok) {
      // deno-lint-ignore no-explicit-any
      const j: any = await res.json();
      // deno-lint-ignore no-explicit-any
      const asset = (j.assets ?? []).find((a: any) => /^sprig-skills.*\.tar\.gz$/.test(a.name));
      if (asset) return { url: asset.browser_download_url, strip: 0 };
    }
  } catch { /* offline / no release → fall back to the default branch */ }
  // Fallback: the default-branch source archive wraps everything in <repo>-<sha>/.
  return { url: `https://github.com/${REPO}/archive/refs/heads/main.tar.gz`, strip: 1 };
}

/** Fetch the skills from the DEPLOYMENT (release asset, else default branch) and install
 *  them. This is what `sprig update` calls — so a self-update always lands the latest
 *  published skills, not the local checkout's. */
export async function installSkillsFromDeployment(): Promise<void> {
  if (await claudeAbsent()) {
    console.log("sprig: ~/.claude not found — skipping Claude Code skills.");
    return;
  }
  const { url, strip } = await skillsTarball();
  const tmp = await Deno.makeTempDir({ prefix: "sprig-skills-" });
  try {
    const res = await fetch(url, { headers: UA });
    if (!res.ok) {
      console.warn(`sprig: could not download skills (${res.status} ${res.statusText}) — skipping.`);
      return;
    }
    const tgz = join(tmp, "skills.tar.gz");
    await Deno.writeFile(tgz, new Uint8Array(await res.arrayBuffer()));
    const ex = join(tmp, "x");
    await Deno.mkdir(ex, { recursive: true });
    const { success, stderr } = await new Deno.Command("tar", {
      args: ["-xzf", tgz, "-C", ex, ...(strip ? [`--strip-components=${strip}`] : [])],
      stdout: "null",
      stderr: "piped",
    }).output();
    if (!success) {
      console.warn("sprig: could not extract skills — " + new TextDecoder().decode(stderr).trim());
      return;
    }
    await installSkills(join(ex, "skills"));
  } finally {
    await Deno.remove(tmp, { recursive: true }).catch(() => {});
  }
}
