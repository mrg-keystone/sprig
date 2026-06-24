import { assert, assertEquals } from "#std/assert";
import { discover } from "./mod.ts";

// Build a minimal sprig-shaped project (folder-component + isolate/) with one
// isolatable component. A sprig component is a folder with a `template.html`
// under src/<root>/; the selector IS the folder basename (no .tsx scanning).
async function tempProject(): Promise<string> {
  const dir = await Deno.makeTempDir();
  const comp = `${dir}/src/components/btn`;
  const iso = `${comp}/isolate`;
  await Deno.mkdir(`${iso}/cases/primary`, { recursive: true });
  await Deno.writeTextFile(
    `${comp}/template.html`,
    "<button>{{ label }}</button>",
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
    // sprig selector is the folder basename (no .tsx export scanning).
    assertEquals(e.exportName, "btn");
    assertEquals(e.componentFile, `${dir}/src/components/btn/template.html`);
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

Deno.test("discover scans ALL top-level folders but requires an isolate/ folder (no default case)", async () => {
  const dir = await Deno.makeTempDir();
  try {
    // a shared-component WITHOUT isolate/ — must NOT show (no synthesized default case)
    await Deno.mkdir(`${dir}/src/shared-components/plain`, { recursive: true });
    await Deno.writeTextFile(`${dir}/src/shared-components/plain/template.html`, "<button>x</button>");
    // a component in a NON-standard top-level folder WITH isolate/ + a case — must show ("all folders")
    await Deno.mkdir(`${dir}/src/widgets/ui-button/isolate/cases/primary`, { recursive: true });
    await Deno.writeTextFile(`${dir}/src/widgets/ui-button/template.html`, "<button>x</button>");
    await Deno.writeTextFile(
      `${dir}/src/widgets/ui-button/isolate/cases/primary/primary.json`,
      JSON.stringify({ _name: "Primary" }),
    );

    const r = await discover(dir);
    assertEquals(r.problems, []);
    assertEquals(r.entries.length, 1); // only the one WITH an isolate/ folder
    const e = r.entries[0];
    assertEquals(e.label, "ui-button");
    assertEquals(e.root, "widgets"); // a non-standard top-level folder was scanned
    assertEquals(e.cases.length, 1);
    assertEquals(e.cases[0].label, "Primary"); // its real case — not a synthesized "Default"
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
});
