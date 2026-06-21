import { assert, assertEquals, assertStringIncludes } from "@std/assert";
import { field, named, parseTemplate } from "../ui/.sprig/compiler/parse.ts";
import { type Scope } from "../ui/.sprig/compiler/expr.ts";
import { type Handler, renderNodes } from "../ui/.sprig/compiler/render.ts";

// deno-lint-ignore no-explicit-any
const NO_REG: any = { get: () => undefined };

async function render(src: string, scope: Scope): Promise<string> {
  const root = await parseTemplate(src);
  return renderNodes(named(root), { scope, registry: NO_REG, source: root.text });
}

async function renderClient(src: string, scope: Scope): Promise<{ html: string; handlers: Handler[] }> {
  const root = await parseTemplate(src);
  const handlers: Handler[] = [];
  const html = renderNodes(named(root), { scope, registry: NO_REG, source: root.text, handlers });
  return { html, handlers };
}

// ─────────────────────────────────────────────────────────────────────────────
// Bug 4: two (event) bindings with the same base event collide — only the LAST
// is reachable. render must emit a marker that references BOTH handler indices
// (not overwrite the first), so hydrate can pick the one whose modifier matches.
Deno.test("bug 4: same-base event bindings both reachable in marker", async () => {
  const { html, handlers } = await renderClient(
    `<input (keyup.enter)="onEnter()" (keyup.escape)="onEscape()" />`,
    { onEnter: () => {}, onEscape: () => {} },
  );
  // both handlers were collected
  assertEquals(handlers.length, 2);
  assertEquals(handlers[0].modifiers, ["enter"]);
  assertEquals(handlers[1].modifiers, ["escape"]);

  // the data-sprig-keyup marker must reference BOTH indices (0 and 1), not just
  // the last one. Before the fix it was just "1" (escape), orphaning enter.
  const m = html.match(/data-sprig-keyup="([^"]*)"/);
  assert(m, "expected a data-sprig-keyup marker");
  const indices = m![1].trim().split(/\s+/).map(Number).sort((a, b) => a - b);
  assertEquals(indices, [0, 1], `marker should list both handler indices, got "${m![1]}"`);
});

// ─────────────────────────────────────────────────────────────────────────────
// Bug 56: escapeAttr must escape < > and ' (single-quote) in addition to & and "
Deno.test("bug 56: escapeAttr escapes < > and single-quote", async () => {
  const html = await render(`<a title="{{ v }}">x</a>`, { v: `a<b>c'd&e"f` });
  assertStringIncludes(html, `title="a&lt;b&gt;c&#39;d&amp;e&quot;f"`);
  // no raw < > inside the attribute value
  assert(!/title="[^"]*</.test(html), "raw < leaked into attribute value");
  assert(!/title="[^"]*>/.test(html.replace(/">x/, '"X')), "raw > leaked into attribute value");
});

// ─────────────────────────────────────────────────────────────────────────────
// Bug 77: @let inside an aliasless @if must NOT leak into the parent scope.
Deno.test("bug 77: @let is block-scoped and does not leak out of @if", async () => {
  const src = "@if (cond) { @let x = 'inner'; <a>{{ x }}</a> } <b>{{ x }}</b>";
  const out = await render(src, { cond: true, x: "OUTER" });
  assertStringIncludes(out, "<a>inner</a>"); // visible inside the block
  assertStringIncludes(out, "<b>OUTER</b>"); // parent binding preserved outside
});
