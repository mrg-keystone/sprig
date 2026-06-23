// BUG E: author-written HTML entities in a STATIC attribute are double-escaped.
// quotedText returns author attribute_text raw (incl. "&amp;"); buildAttrs then runs the
// whole value through escapeAttr → the author's "&amp;" becomes "&amp;amp;".
// Element CONTENT is asymmetric: literal author text is trusted/raw, only interpolations
// are escaped — the attribute path must mirror that.
// SECURITY: interpolated + property-binding attribute values are UNTRUSTED and MUST stay escaped.
import { assert, assertStringIncludes } from "jsr:@std/assert";
import { named, parseTemplate } from "./parse.ts";
import { renderNodes } from "./render.ts";

// deno-lint-ignore no-explicit-any
async function renderSrc(src: string, scope: any = {}): Promise<string> {
  const root = await parseTemplate(src);
  return renderNodes(named(root), { scope, registry: { get: () => undefined }, source: root.text });
}

Deno.test("BUG E: author HTML entities in a static attribute are single-escaped, not doubled", async () => {
  const out = await renderSrc(`<a href="/s?q=a&amp;b" title="Tom &amp; Jerry">x</a>`);
  assertStringIncludes(out, `href="/s?q=a&amp;b"`);
  assertStringIncludes(out, `title="Tom &amp; Jerry"`);
  assert(!out.includes("&amp;amp;"), "author entity must not be double-escaped");
});

Deno.test("BUG E security: an INTERPOLATED attribute value is still escaped (no quote breakout)", async () => {
  const out = await renderSrc(`<a title="{{ x }}">y</a>`, { x: `" onmouseover="alert(1)` });
  assert(!out.includes(`title="" onmouseover="alert(1)`), "interpolation must not break out of the attribute quotes");
  assertStringIncludes(out, "&quot; onmouseover=&quot;alert(1)", "untrusted interpolation must be HTML-escaped");
});

Deno.test("BUG E security: a property-binding attribute value is still escaped (no quote breakout)", async () => {
  const out = await renderSrc(`<a [title]="x">y</a>`, { x: `" onmouseover="alert(1)` });
  assert(!out.includes(`title="" onmouseover="alert(1)`), "property binding must not break out of the attribute quotes");
  assertStringIncludes(out, "&quot; onmouseover=&quot;alert(1)", "untrusted property-binding value must be HTML-escaped");
});

// A LITERAL `style` attribute and a `[style.x]` binding on the same element: the literal
// is author text but `style` is re-AGGREGATED with the binding's raw runtime value at the
// end of buildAttrs, so the combined value must still be escaped. The `preEscaped` exemption
// must NOT cover `style` (or `class`) — only single-valued text attributes.
Deno.test("BUG E security: a [style.x] binding alongside a literal style is escaped (no quote breakout)", async () => {
  const out = await renderSrc(`<div style="color:red" [style.width]="x"></div>`, { x: `100px;" onmouseover="alert(1)` });
  assert(!out.includes(`;" onmouseover="alert(1)`), "style binding must not break out of the attribute quotes");
  assertStringIncludes(out, "&quot;", "untrusted style-binding value must be HTML-escaped");
});

Deno.test("BUG E security: a [style] object binding alongside a literal style is escaped", async () => {
  const out = await renderSrc(`<div style="color:red" [style]="s"></div>`, { s: { content: `" onmouseover="alert(1)` } });
  assert(!out.includes(`" onmouseover="alert(1)"`), "style object binding must not break out of the attribute quotes");
});
