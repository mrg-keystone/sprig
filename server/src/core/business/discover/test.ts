import { assert, assertEquals } from "#std/assert";
import { discover } from "./mod.ts";

// Build a minimal Fresh-shaped project with one isolatable component.
async function tempProject(): Promise<string> {
  const dir = await Deno.makeTempDir();
  const iso = `${dir}/components/btn/isolate`;
  await Deno.mkdir(`${iso}/cases/primary`, { recursive: true });
  await Deno.writeTextFile(
    `${dir}/components/btn/Btn.tsx`,
    "export function Btn() { return null; }",
  );
  await Deno.writeTextFile(
    `${iso}/fixture.json`,
    JSON.stringify({
      category: "btns",
      controls: { disabled: { type: "boolean" } },
    }),
  );
  await Deno.writeTextFile(
    `${iso}/cases/primary/primary.json`,
    JSON.stringify({ _name: "Primary" }),
  );
  return dir;
}

Deno.test("discover finds an isolatable component and its case", async () => {
  const dir = await tempProject();
  try {
    const r = await discover(dir);
    assertEquals(r.problems, []);
    assertEquals(r.entries.length, 1);
    const e = r.entries[0];
    assertEquals(e.label, "btn");
    assertEquals(e.kind, "static");
    assertEquals(e.root, "components");
    assertEquals(e.exportName, "Btn");
    assertEquals(e.category, "btns");
    assertEquals(e.cases.length, 1);
    assertEquals(e.cases[0].route, "/components/btns/primary");
    assertEquals(e.cases[0].label, "Primary");
    assert("disabled" in e.controlDefs);
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
});

Deno.test("discover returns empty for a project with no isolate/ folders", async () => {
  const dir = await Deno.makeTempDir();
  try {
    const r = await discover(dir);
    assertEquals(r.entries, []);
    assertEquals(r.problems, []);
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
});
