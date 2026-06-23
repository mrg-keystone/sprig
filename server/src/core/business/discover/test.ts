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

Deno.test("discover shows a shared-component without isolate/ via a Default case, and skips a case-less page", async () => {
  const dir = await Deno.makeTempDir();
  try {
    // a leaf component in sprig's documented root, with NO isolate/ folder
    await Deno.mkdir(`${dir}/src/shared-components/ui-button`, { recursive: true });
    await Deno.writeTextFile(`${dir}/src/shared-components/ui-button/template.html`, "<button>hi</button>");
    // a page, also with no isolate/ — must be skipped (data deps can't be isolated unmodified)
    await Deno.mkdir(`${dir}/src/pages/home`, { recursive: true });
    await Deno.writeTextFile(`${dir}/src/pages/home/template.html`, "<main>home</main>");

    const r = await discover(dir);
    assertEquals(r.problems, []);
    assertEquals(r.entries.length, 1); // the component shows; the case-less page is skipped
    const e = r.entries[0];
    assertEquals(e.label, "ui-button");
    assertEquals(e.root, "shared-components");
    assertEquals(e.cases.length, 1);
    assertEquals(e.cases[0].name, "default");
    assertEquals(e.cases[0].label, "Default");
    assertEquals(e.cases[0].route, "/components/ui-button/default");
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
});
