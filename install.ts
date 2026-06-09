// `deno task install` — set isolate up for everyday use:
//   1. Install the Fresh 2 skill (this repo's parent folder) at USER scope so
//      Claude Code picks it up: ~/.claude/skills/<skill-name>.
//   2. Install the `isolate` CLI at GLOBAL scope from JSR, so `isolate <cmd>`
//      works in any project.
//
// The skill source is the repo's PARENT directory (the repo lives inside the
// skill, e.g. <skill>/isolate). Installing is a symlink, so edits to the skill
// reflect live. Idempotent and non-destructive: it never clobbers an existing,
// different skill folder, and on a checkout that already lives at the install
// location it just reports "already installed".
import { basename, dirname, join } from "jsr:@std/path@^1";

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

async function installSkill(skillDir: string): Promise<void> {
  const home = Deno.env.get("HOME");
  if (!home) {
    console.warn("⚠ HOME not set — skipping skill install.");
    return;
  }
  if (!(await lstat(join(skillDir, "SKILL.md")))) {
    console.warn(
      `⚠ no SKILL.md in ${skillDir} — this checkout doesn't carry the skill, ` +
        `so there's nothing to install at user scope. Installing the CLI only.`,
    );
    return;
  }

  const name = await skillName(skillDir);
  const skillsRoot = join(home, ".claude", "skills");
  const target = join(skillsRoot, name);

  const targetReal = await real(target);
  const sourceReal = await real(skillDir);

  // Already pointing at (or literally being) this skill → nothing to do.
  if (targetReal && sourceReal && targetReal === sourceReal) {
    console.log(`✓ skill '${name}' already installed at user scope → ${target}`);
    return;
  }

  const info = await lstat(target);
  if (info) {
    // Something else is already there — don't destroy it.
    console.warn(
      `⚠ ${target} already exists and points elsewhere (${targetReal ?? "?"}).\n` +
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
const skillDir = dirname(repoDir); // the repo lives inside the skill folder

await installSkill(skillDir);
await installCli();
console.log("\nDone. Try:  isolate list   (from inside a Fresh project)");
