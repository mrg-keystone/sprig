// `deno task install` — set isolate up for everyday DEV use:
//   1. Symlink every skill in this repo's `skills/` folder at USER scope
//      so Claude Code picks them up: ~/.claude/skills/<skill-name>.
//   2. Install the `isolate` CLI at GLOBAL scope from JSR, so `isolate <cmd>`
//      works in any project.
//
// The skill sources are the directories under `skills/` (one skill each,
// named by their SKILL.md frontmatter). Installing is a symlink, so edits to
// a skill reflect live — this is the dev-mode setup; consumers should run
// `isolate update` instead, which installs a plain copy of the latest
// published version. Idempotent and non-destructive: it never clobbers an
// existing, different skill folder, and when a symlink already points here
// it just reports "already installed".
//
// One special layout: this checkout may itself live INSIDE an installed
// skill dir (~/.claude/skills/deno-fresh2/isolate). The target then can't be
// a single symlink — instead each entry of the skill source (SKILL.md,
// references/, evals/) is symlinked individually into the target dir.
import { basename, join } from "jsr:@std/path@^1";

const CLI_NAME = "isolate";
const JSR_PKG = "jsr:@mrg-keystone/isolate";

async function lstat(p: string): Promise<Deno.FileInfo | null> {
  try {
    return await Deno.lstat(p);
  } catch {
    return null;
  }
}

/** realpath, or null if the path doesn't resolve. */
async function real(p: string): Promise<string | null> {
  try {
    return await Deno.realPath(p);
  } catch {
    return null;
  }
}

/** Read `name:` from a SKILL.md frontmatter, else fall back to the dir name. */
async function skillName(skillDir: string): Promise<string> {
  try {
    const md = await Deno.readTextFile(join(skillDir, "SKILL.md"));
    const m = md.match(/^name:\s*(\S+)/m);
    if (m) return m[1];
  } catch { /* no SKILL.md / unreadable */ }
  return basename(skillDir);
}

/**
 * The checkout-inside-the-skill layout: the target dir is an ancestor of this
 * repo, so it can't be replaced by a symlink. Link the skill's entries
 * (SKILL.md, references/, …) into it one by one. Existing symlinks that
 * point into this repo are re-pointed; anything else is left untouched.
 */
async function linkEntries(skillDir: string, target: string, repoReal: string) {
  for await (const entry of Deno.readDir(skillDir)) {
    const src = join(skillDir, entry.name);
    const dest = join(target, entry.name);
    const destReal = await real(dest);
    const srcReal = await real(src);
    if (destReal && srcReal && destReal === srcReal) continue; // already right
    const info = await lstat(dest);
    if (info) {
      // Replace only our own links: a symlink that points into this repo
      // (possibly dangling after a re-layout). Never touch real files.
      if (!info.isSymlink) {
        console.warn(`⚠ ${dest} exists and isn't ours — leaving it.`);
        continue;
      }
      const raw = await Deno.readLink(dest);
      const resolved = raw.startsWith("/") ? raw : join(target, raw);
      if (!resolved.startsWith(repoReal + "/")) {
        console.warn(`⚠ ${dest} links outside this repo — leaving it.`);
        continue;
      }
      await Deno.remove(dest);
    }
    await Deno.symlink(src, dest);
    console.log(`  ↳ linked ${entry.name}`);
  }
}

async function installSkill(skillDir: string, repoDir: string): Promise<void> {
  const home = Deno.env.get("HOME");
  if (!home) {
    console.warn("⚠ HOME not set — skipping skill install.");
    return;
  }
  const name = await skillName(skillDir);
  const skillsRoot = join(home, ".claude", "skills");
  const target = join(skillsRoot, name);

  const targetReal = await real(target);
  const sourceReal = await real(skillDir);
  const repoReal = (await real(repoDir)) ?? repoDir;

  // Already pointing at (or literally being) this skill → nothing to do.
  if (targetReal && sourceReal && targetReal === sourceReal) {
    console.log(`✓ skill '${name}' already installed → ${target}`);
    return;
  }

  // The dev layout where this checkout lives INSIDE the target skill dir
  // (e.g. ~/.claude/skills/deno-fresh2/isolate): link entries individually.
  if (targetReal && repoReal.startsWith(targetReal + "/")) {
    console.log(`✓ skill '${name}' hosts this checkout — linking entries:`);
    await linkEntries(skillDir, target, repoReal);
    return;
  }

  const info = await lstat(target);
  if (info) {
    // Something else is already there — don't destroy it.
    console.warn(
      `⚠ ${target} already exists and points elsewhere (${
        targetReal ?? "?"
      }).\n` +
        `  Leaving it untouched. Remove it and re-run if you want to link this checkout.`,
    );
    return;
  }

  await Deno.mkdir(skillsRoot, { recursive: true });
  await Deno.symlink(skillDir, target);
  console.log(`✓ linked skill '${name}' → ${target}`);
}

async function installCli(): Promise<void> {
  console.log(`Installing the '${CLI_NAME}' CLI globally from ${JSR_PKG}…`);
  const cmd = new Deno.Command("deno", {
    // -g global · -A all perms (it spawns deno/npm/playwright + touches the fs)
    // -f force overwrite of any existing bin · -n names the binary `isolate`
    args: ["install", "-gA", "-f", "-n", CLI_NAME, JSR_PKG],
    stdout: "inherit",
    stderr: "inherit",
  });
  const { success } = await cmd.output();
  if (!success) {
    console.error(
      `✗ '${CLI_NAME}' global install failed. You can retry with:\n` +
        `    deno install -gA -f -n ${CLI_NAME} ${JSR_PKG}`,
    );
    Deno.exit(1);
  }
  console.log(
    `✓ '${CLI_NAME}' installed. If it isn't found, add Deno's bin dir to PATH ` +
      `(deno reports it above; usually ~/.deno/bin).`,
  );
}

const repoDir = import.meta.dirname;
if (!repoDir) {
  console.error("Cannot resolve the install directory.");
  Deno.exit(1);
}

// Every directory under skills/ that carries a SKILL.md is an installable skill.
const skillsDir = join(repoDir, "skills");
for await (const entry of Deno.readDir(skillsDir)) {
  if (!entry.isDirectory) continue;
  const dir = join(skillsDir, entry.name);
  if (!(await lstat(join(dir, "SKILL.md")))) continue;
  await installSkill(dir, repoDir);
}

await installCli();
console.log("\nDone. Try:  isolate list   (from inside a Fresh project)");
