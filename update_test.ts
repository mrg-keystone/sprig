import { assertEquals } from "jsr:@std/assert@^1";
import { skillFiles, skillNameFrom } from "./update.ts";

Deno.test("skillFiles picks only /skill/ paths from a JSR manifest", () => {
  const manifest = {
    "/main.ts": { size: 1 },
    "/skill/SKILL.md": { size: 2 },
    "/skill/references/isolate.md": { size: 3 },
    "/skill-notes.md": { size: 4 },
    "/.github/workflows/publish.yml": { size: 5 },
  };
  assertEquals(skillFiles(manifest).sort(), [
    "/skill/SKILL.md",
    "/skill/references/isolate.md",
  ]);
});

Deno.test("skillNameFrom reads frontmatter name, falls back otherwise", () => {
  assertEquals(
    skillNameFrom("---\nname: deno-fresh2\ndescription: x\n---\n", "fb"),
    "deno-fresh2",
  );
  assertEquals(skillNameFrom("# no frontmatter", "fb"), "fb");
});
