// BUG V: a page whose logic.ts uses the `{ setup }` (defineComponent function) model —
// not a class — never has its setup() scope built for SSR. renderBody builds the page
// scope only via page.island.resolve (the class path); a { setup } island has only
// .scope + .trigger (no .resolve), so pageScope falls back to raw route params and the
// page's setup signals render blank on the server (content mismatch + blank first paint).
// renderComponent (render.ts:243) already calls comp.island.scope for child islands; only
// the page ROOT skipped it.
import { assert } from "jsr:@std/assert";
import { dirname, join as joinPath } from "@std/path";
import { createRenderer } from "./mod.ts";

async function writeTree(tmp: string, files: Record<string, string>) {
  for (const [rel, body] of Object.entries(files)) {
    const path = joinPath(tmp, ...rel.split("/"));
    await Deno.mkdir(dirname(path), { recursive: true });
    await Deno.writeTextFile(path, body);
  }
}

Deno.test("BUG V: a { setup } (defineComponent) page builds its setup scope for SSR", async () => {
  const tmp = await Deno.makeTempDir({ prefix: "sprig-setup-page-" });
  try {
    await writeTree(tmp, {
      "shell/template.html": `<div><router-outlet></router-outlet></div>`,
      "pages/home/template.html": `<p>{{ greeting() }}</p>`,
      "pages/home/logic.ts":
        `import { defineComponent, signal } from "@mrg-keystone/sprig";\n` +
        `export default defineComponent(() => ({ greeting: signal("hello") }));`,
    });
    const r = await createRenderer(tmp, "/ui", { dev: true });
    const html = await r.renderDocument("pages/home", {});
    assert(html.includes(">hello</p>"), `setup() signal did not render server-side. Got:\n${html}`);
  } finally {
    await Deno.remove(tmp, { recursive: true });
  }
});

Deno.test("BUG V control: a class page with the same template already renders the value", async () => {
  const tmp = await Deno.makeTempDir({ prefix: "sprig-class-page-" });
  try {
    await writeTree(tmp, {
      "shell/template.html": `<div><router-outlet></router-outlet></div>`,
      "pages/home/template.html": `<p>{{ greeting() }}</p>`,
      "pages/home/logic.ts":
        `import { signal } from "@mrg-keystone/sprig";\n` +
        `export default class Home { greeting = signal("hello"); }`,
    });
    const r = await createRenderer(tmp, "/ui", { dev: true });
    const html = await r.renderDocument("pages/home", {});
    assert(html.includes(">hello</p>"), `class page control should render. Got:\n${html}`);
  } finally {
    await Deno.remove(tmp, { recursive: true });
  }
});
