import { assertEquals } from "jsr:@std/assert@^1";
import { skillGroups, skillNameFrom } from "./update.ts";

Deno.test("skillGroups groups /skills/ paths by skill dir, requires SKILL.md", () => {
  const manifest = {
    "/main.ts": { size: 1 },
    "/skills/deno-fresh2/SKILL.md": { size: 2 },
    "/skills/deno-fresh2/references/isolate.md": { size: 3 },
    "/skills/prototype/SKILL.md": { size: 4 },
    "/skills/prototype/design-lint/bin/detect.mjs": { size: 5 },
    "/skills/not-a-skill/notes.md": { size: 6 }, // no SKILL.md → dropped
    "/skills-notes.md": { size: 7 },
    "/.github/workflows/publish.yml": { size: 8 },
  };
  const groups = skillGroups(manifest);
  assertEquals([...groups.keys()].sort(), ["deno-fresh2", "prototype"]);
  assertEquals(groups.get("deno-fresh2")!.sort(), [
    "/skills/deno-fresh2/SKILL.md",
    "/skills/deno-fresh2/references/isolate.md",
  ]);
  assertEquals(groups.get("prototype")!.sort(), [
    "/skills/prototype/SKILL.md",
    "/skills/prototype/design-lint/bin/detect.mjs",
  ]);
});

Deno.test("skillNameFrom reads frontmatter name, falls back otherwise", () => {
  assertEquals(
    skillNameFrom("---\nname: deno-fresh2\ndescription: x\n---\n", "fb"),
    "deno-fresh2",
  );
  assertEquals(skillNameFrom("# no frontmatter", "fb"), "fb");
});
