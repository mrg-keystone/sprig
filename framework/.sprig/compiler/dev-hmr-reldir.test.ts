// BUG W: the dev HMR reparse/astFor path is keyed by BARE selector while a component's
// IDENTITY is its unique relDir. When a global shared component and a page-local
// component share a basename (the dual-registry design explicitly supports this),
// editing the PAGE-LOCAL one reparses/serves the WRONG (global) def:
//   - the dev watcher passed basename(dirname(p)) — discarding folder identity,
//   - reparse(selector) used findBySelector (first def) + found the path via the FIRST
//     relDir whose basename matched (so it could target the global folder),
//   - lastSource was keyed by bare selector (clobbered by whichever folder walked last),
//   - astFor(selector) had the same first-def limitation.
//
// FIX: key the dev/HMR path by relDir (component identity). reparse(relDir) / astFor(relDir)
// resolve the def by relDir; the dev watcher passes the relDir end to end.
import { assert } from "jsr:@std/assert";
import { dirname, join as joinPath } from "@std/path";
import { createRenderer } from "./mod.ts";

Deno.test("BUG W: editing a page-local component updates the PAGE-LOCAL def, not the same-basename global", async () => {
  const tmp = await Deno.makeTempDir({ prefix: "sprig-hmr-reldir-" });
  try {
    const write = async (rel: string, body: string) => {
      const dir = joinPath(tmp, ...rel.split("/"));
      await Deno.mkdir(dirname(dir), { recursive: true });
      await Deno.writeTextFile(dir, body);
    };
    await write("shell/template.html", `<div><router-outlet></router-outlet></div>`);
    // The board page renders <card> → resolves to its PAGE-LOCAL card via the per-page registry.
    await write("pages/board/template.html", `<section><card></card></section>`);
    // home has NO page-local card → <card> resolves to the GLOBAL card.
    await write("pages/home/template.html", `<main><card></card></main>`);
    // global shared card (basename "card")
    await write("shared/card/template.html", `<p>GLOBAL CARD</p>`);
    // page-local card under pages/board (SAME basename "card" — dual-registry shadow)
    await write("pages/board/components/card/template.html", `<p>LOCAL CARD V1</p>`);

    const r = await createRenderer(tmp, "/ui", { dev: true });

    // sanity: board uses the page-local card, home uses the global card
    let board = await r.renderDocument("pages/board", {});
    let home = await r.renderDocument("pages/home", {});
    assert(board.includes("LOCAL CARD V1"), "board should render its page-local card");
    assert(home.includes("GLOBAL CARD"), "home should render the global card");

    // EDIT ONLY the page-local template → V2, then drive the dev-watcher reparse path
    // with the PAGE-LOCAL relDir (the identifier the watcher passes after the fix).
    const localRelDir = "pages/board/components/card";
    await Deno.writeTextFile(
      joinPath(tmp, ...localRelDir.split("/"), "template.html"),
      `<p>LOCAL CARD V2</p>`,
    );
    const changed = await r.reparse(localRelDir);
    assert(changed, "reparse(page-local relDir) should report a real change");

    // The PAGE-LOCAL def must now be V2 — the untouched global must stay GLOBAL CARD.
    board = await r.renderDocument("pages/board", {});
    home = await r.renderDocument("pages/home", {});
    assert(board.includes("LOCAL CARD V2"), "board MUST reflect the edited page-local card (V2)");
    assert(!board.includes("LOCAL CARD V1"), "board must not keep the stale page-local V1");
    assert(home.includes("GLOBAL CARD"), "the untouched GLOBAL card must be unchanged");
    assert(!home.includes("LOCAL CARD"), "the global card must not be clobbered with the page-local one");

    // astFor(page-local relDir) must serve the V2 AST, NOT the global.
    const localAst = r.astFor(localRelDir);
    assert(localAst, "astFor(page-local relDir) returns an AST");
    assert(JSON.stringify(localAst).includes("LOCAL CARD V2"), "astFor serves the page-local V2 AST");
    assert(!JSON.stringify(localAst).includes("GLOBAL CARD"), "astFor must not serve the global def");

    // Editing the GLOBAL card still works: home (no page-local card) reflects it.
    const globalRelDir = "shared/card";
    await Deno.writeTextFile(
      joinPath(tmp, ...globalRelDir.split("/"), "template.html"),
      `<p>GLOBAL CARD V2</p>`,
    );
    const gChanged = await r.reparse(globalRelDir);
    assert(gChanged, "reparse(global relDir) should report a real change");
    home = await r.renderDocument("pages/home", {});
    board = await r.renderDocument("pages/board", {});
    assert(home.includes("GLOBAL CARD V2"), "home MUST reflect the edited global card (V2)");
    assert(board.includes("LOCAL CARD V2"), "board still uses its page-local card after the global edit");
    const globalAst = r.astFor(globalRelDir);
    assert(globalAst && JSON.stringify(globalAst).includes("GLOBAL CARD V2"), "astFor(global relDir) serves the global V2 AST");
  } finally {
    await Deno.remove(tmp, { recursive: true });
  }
});
