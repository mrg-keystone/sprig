// The dev AST endpoint (`/_sprig/ast/<sel>`) serves island chunks' fetchAst, keyed by the
// island's BARE selector (its data-sel). A page may legally share its basename with the
// island it mounts — pages/workbench mounting pages/workbench/components/workbench is the
// "page mounts the shell island" pattern — and astFor's old first-registered-def fallback
// then returned the PAGE's template. Served to the island, that template renders the
// island ITSELF, so every hydration re-render nests a fresh <sprig-island data-sel=self>
// shell: observed live as 400+ self-nested workbench hosts and a "Maximum call stack size
// exceeded" hydration failure under `sprig isolate` dev mode.
import { assert } from "jsr:@std/assert";
import { dirname, join as joinPath } from "@std/path";
import { createRenderer } from "./mod.ts";

Deno.test("astFor(bare selector) resolves the ISLAND def, not a same-basename page", async () => {
  const tmp = await Deno.makeTempDir({ prefix: "sprig-ast-island-" });
  try {
    const write = async (rel: string, body: string) => {
      const dir = joinPath(tmp, ...rel.split("/"));
      await Deno.mkdir(dirname(dir), { recursive: true });
      await Deno.writeTextFile(dir, body);
    };
    await write("shell/template.html", `<div><router-outlet></router-outlet></div>`);
    // the page (basename "panel") mounts the island of the SAME basename
    await write("pages/panel/template.html", `<panel [items]="items"></panel>`);
    await write("pages/panel/components/panel/template.html", `<div class="panel-body">ISLAND BODY</div>`);
    await write("pages/panel/components/panel/logic.ts", `export default { setup: () => ({}) };`);

    const r = await createRenderer(tmp, "", { dev: true });

    const ast = r.astFor("panel"); // what the island chunk's fetchAst asks for
    assert(ast, "astFor must resolve the bare selector");
    assert(ast!.source.includes("ISLAND BODY"), "the ISLAND's own template must be served");
    assert(
      !ast!.source.includes("<panel"),
      "NOT the page template that mounts the island — that poisons hydration into a self-nesting loop",
    );

    // relDir addressing (the dev watcher's path) is untouched: each def stays reachable.
    assert(r.astFor("pages/panel")!.source.includes("<panel"), "the page def stays reachable by relDir");
    assert(r.astFor("pages/panel/components/panel")!.source.includes("ISLAND BODY"), "the island def stays reachable by relDir");
  } finally {
    await Deno.remove(tmp, { recursive: true });
  }
});
