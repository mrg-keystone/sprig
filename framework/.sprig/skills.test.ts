import { assert, assertEquals } from "@std/assert";
import { dirname, join } from "@std/path";
import { installSkills } from "./skills.ts";

async function exists(p: string): Promise<boolean> {
  try {
    await Deno.lstat(p);
    return true;
  } catch {
    return false;
  }
}
async function writeFile(p: string, body: string): Promise<void> {
  await Deno.mkdir(dirname(p), { recursive: true });
  await Deno.writeTextFile(p, body);
}

// Acceptance: base-level (whole-folder) replace into a SANDBOX user-scope dir.
// Seed: a same-named skill with a stray user file + one unrelated existing skill.
// Source: an updated same-named skill + a brand-new skill (+ the interfaces contracts
// sibling, + a no-SKILL.md dir that must be skipped).
Deno.test("installSkills: base-level whole-folder replace into user scope", async () => {
  const dest = await Deno.makeTempDir({ prefix: "sprig-skills-dest-" });
  const src = await Deno.makeTempDir({ prefix: "sprig-skills-src-" });
  const prev = Deno.env.get("CLAUDE_SKILLS_DIR");
  Deno.env.set("CLAUDE_SKILLS_DIR", dest); // sandbox — never the real ~/.claude/skills
  try {
    // --- seed the destination (a prior install) ---
    await writeFile(join(dest, "build", "SKILL.md"), "name: sprig:build\nOLD BUILD\n");
    await writeFile(join(dest, "build", "USER_NOTES.md"), "a file the user added inside build/");
    await writeFile(join(dest, "myskill", "SKILL.md"), "name: me:myskill\n");
    await writeFile(join(dest, "myskill", "MARKER.txt"), "untouched");

    // --- the source skills/ to install ---
    await writeFile(join(src, "build", "SKILL.md"), "name: sprig:build\nNEW BUILD\n");
    await writeFile(join(src, "fresh", "SKILL.md"), "name: sprig:fresh\n");
    await writeFile(join(src, "interfaces", "design-system.md"), "shared contract"); // no SKILL.md, exempt
    await writeFile(join(src, "nogood", "README.md"), "not a skill — no SKILL.md");

    await installSkills(src);

    // same-named skill is UPDATED ...
    assertEquals(
      (await Deno.readTextFile(join(dest, "build", "SKILL.md"))).trim(),
      "name: sprig:build\nNEW BUILD".trim(),
    );
    // ... and its stray user file is GONE (wholesale replace) ...
    assertEquals(await exists(join(dest, "build", "USER_NOTES.md")), false);
    // ... the new skill is INSTALLED ...
    assert(await exists(join(dest, "fresh", "SKILL.md")));
    // ... the unrelated existing skill is UNTOUCHED ...
    assert(await exists(join(dest, "myskill", "SKILL.md")));
    assertEquals(await Deno.readTextFile(join(dest, "myskill", "MARKER.txt")), "untouched");
    // ... the interfaces contracts sibling is carried (exempt from the SKILL.md guard) ...
    assert(await exists(join(dest, "interfaces", "design-system.md")));
    // ... and a dir without SKILL.md is skipped.
    assertEquals(await exists(join(dest, "nogood")), false);
  } finally {
    if (prev === undefined) Deno.env.delete("CLAUDE_SKILLS_DIR");
    else Deno.env.set("CLAUDE_SKILLS_DIR", prev);
    await Deno.remove(dest, { recursive: true }).catch(() => {});
    await Deno.remove(src, { recursive: true }).catch(() => {});
  }
});

// A pre-existing skill installed as a SYMLINK must be unlinked + replaced by a real
// folder, not written through the link.
Deno.test("installSkills: replaces a symlinked skill in place (no write-through)", async () => {
  const dest = await Deno.makeTempDir({ prefix: "sprig-skills-dest-" });
  const src = await Deno.makeTempDir({ prefix: "sprig-skills-src-" });
  const elsewhere = await Deno.makeTempDir({ prefix: "sprig-skills-link-" });
  const prev = Deno.env.get("CLAUDE_SKILLS_DIR");
  Deno.env.set("CLAUDE_SKILLS_DIR", dest);
  try {
    await writeFile(join(elsewhere, "SKILL.md"), "linked target");
    await Deno.symlink(elsewhere, join(dest, "build"));
    await writeFile(join(src, "build", "SKILL.md"), "real folder");

    await installSkills(src);

    const li = await Deno.lstat(join(dest, "build"));
    assert(!li.isSymlink, "destination is a real dir, not a symlink");
    assertEquals(await Deno.readTextFile(join(dest, "build", "SKILL.md")), "real folder");
    // the link target was not written through
    assertEquals(await Deno.readTextFile(join(elsewhere, "SKILL.md")), "linked target");
  } finally {
    if (prev === undefined) Deno.env.delete("CLAUDE_SKILLS_DIR");
    else Deno.env.set("CLAUDE_SKILLS_DIR", prev);
    await Deno.remove(dest, { recursive: true }).catch(() => {});
    await Deno.remove(src, { recursive: true }).catch(() => {});
    await Deno.remove(elsewhere, { recursive: true }).catch(() => {});
  }
});
