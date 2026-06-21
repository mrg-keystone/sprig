// Group a-collision — bugs 2, 3, 12, 20 (shared root: components keyed by
// basename(dir) collide). All tests build a TEMPORARY copy of ui/src so the real
// fixture tree (and spine.test.ts's board assertions) are untouched, then add the
// colliding folder(s) described in the buglist and drive the compiler directly.
import { assert, assertEquals, assertStringIncludes } from "@std/assert";
import { copy } from "@std/fs/copy";
import { join } from "@std/path";
import { createRenderer } from "../ui/.sprig/compiler/mod.ts";
import { scopeId } from "../ui/.sprig/compiler/scope.ts";

const SRC = new URL("../ui/src", import.meta.url).pathname;

const issue = {
  id: "X1", title: "T-X1", priority: "high", points: 3,
  tags: [{ label: "bug", tone: "red" }], assignees: ["a"],
};
const board = {
  project: { name: "Demo", key: "DMO", velocity: 20 },
  groups: [{ column: { id: "todo", label: "Todo", wip: 0 }, issues: [issue] }],
};

async function tmpTree(): Promise<string> {
  const dir = await Deno.makeTempDir({ prefix: "a-collision-" });
  await copy(SRC, join(dir, "src"), { overwrite: true });
  return join(dir, "src");
}

// add a page-local issue-card under pages/board → must SHADOW the shared one
// within the board page only, with its OWN distinct scope id.
async function addPageLocalIssueCard(src: string): Promise<string> {
  const dir = join(src, "pages", "board", "components", "issue-card");
  await Deno.mkdir(dir, { recursive: true });
  await Deno.writeTextFile(
    join(dir, "template.html"),
    `<div class="page-local">PAGE-LOCAL ISSUE CARD OVERRIDE</div>`,
  );
  return dir;
}

// ─────────────────────────────────────────────────────────────────────────────
// bug 2: same-basename folder-components collide in the SSR registry, silently
// clobbering one with the other. After the fix the two distinct components must
// COEXIST (no silent last-write-wins) and the page-local one shadows on its page.
Deno.test("bug 2: same-basename components coexist (no silent registry clobber)", async () => {
  const src = await tmpTree();
  await addPageLocalIssueCard(src);
  const r = await createRenderer(src, "/ui");
  // Before the fix: the Map keyed on basename collapses both to ONE "issue-card"
  // entry (length 1). After: both distinct components are registered (length 2).
  const count = r.selectors().filter((s) => s === "issue-card").length;
  assertEquals(count, 2, "both issue-card components must be registered, not clobbered");
  // the page-local component shadows the shared one *within the board page*
  const html = await r.renderDocument("board", { board });
  assertStringIncludes(html, "PAGE-LOCAL ISSUE CARD OVERRIDE");
});

// bug 3: selector collision silently overwrites. Two GLOBAL (non-page-local)
// components with the same basename have no page to scope them apart — the build
// must FAIL LOUDLY (like assertStaticPage) instead of silently dropping one.
Deno.test("bug 3: a true duplicate selector throws instead of silently overwriting", async () => {
  const src = await tmpTree();
  // a second, top-level (global) component folder sharing basename "issue-card"
  const dup = join(src, "widgets", "issue-card");
  await Deno.mkdir(dup, { recursive: true });
  await Deno.writeTextFile(join(dup, "template.html"), `<div class="dup">DUP</div>`);
  let threw = false;
  try {
    await createRenderer(src, "/ui");
  } catch (e) {
    threw = true;
    assertStringIncludes(String(e), "issue-card");
  }
  assert(threw, "duplicate global selector 'issue-card' must throw a collision error");
});

// bug 12: same scopeId + silent overwrite. After the fix the page-local override
// renders (intended shadowing) AND it carries a scope marker that is NOT the
// basename-only sc44799d1 it shared with the shared component before.
Deno.test("bug 12: shadowed component renders with its OWN (distinct) scope marker", async () => {
  const src = await tmpTree();
  await addPageLocalIssueCard(src);
  const r = await createRenderer(src, "/ui");
  const html = await r.renderDocument("board", { board });
  assertStringIncludes(html, "PAGE-LOCAL ISSUE CARD OVERRIDE");
  const basenameOnly = scopeId("issue-card"); // the colliding marker (sc44799d1)
  // the page-local override div must NOT carry the basename-only marker
  const m = html.match(/<div (s[0-9a-f]{8}) class="page-local"/);
  assert(m, "page-local override div should carry a scope marker");
  assert(
    m![1] !== basenameOnly,
    `page-local issue-card marker (${m![1]}) must differ from the basename-only id (${basenameOnly})`,
  );
});

// bug 20: scopeId is basename-only, so two same-basename components share one CSS
// scope attribute. After the fix each component's scope id is derived from its
// unique path, so the two issue-card folders get DIFFERENT scope ids — and the
// board page's element no longer carries the shared sc44799d1.
Deno.test("bug 20: same-basename folders get DIFFERENT scope ids (no cross-folder CSS leak)", async () => {
  const src = await tmpTree();
  await addPageLocalIssueCard(src);
  const r = await createRenderer(src, "/ui");
  const html = await r.renderDocument("board", { board });
  // the page-local override carries a path-derived marker, distinct from the
  // shared issue-card's. Before the fix both were sc44799d1 (= scopeId("issue-card")).
  const sharedMarker = scopeId("issue-card");
  // the board page itself (pages/board) also has a marker; the override's marker
  // is the issue-card component's. Assert the override is NOT the shared id.
  assert(
    !new RegExp(`<div ${sharedMarker} class="page-local"`).test(html),
    "the page-local stub must not carry the shared basename-only scope attribute",
  );
});
