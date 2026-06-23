// BUG AC: an author HTML entity in a STATIC attribute on a COMPONENT tag is
// double-escaped after crossing the @input boundary. computeInputs stores the literal
// author attribute_text RAW (incl. "&amp;") — correct for the native-element emit path
// (buildAttrs exempts it via preEscaped) — but here it becomes a DATA @input and the
// CHILD re-escapes it (escape() for {{x}} / escapeAttr for [x]) so "&amp;" → "&amp;amp;".
// FIX: computeInputs must pass the DECODED author value so the child escapes it once;
// interpolation segments stay RAW runtime data (child escapes once → still XSS-safe).
import { assert, assertStringIncludes } from "jsr:@std/assert";
import { named, parseTemplate } from "./parse.ts";
import { clearStaticCache, renderNodes } from "./render.ts";

// deno-lint-ignore no-explicit-any
async function staticDef(selector: string, src: string): Promise<any> {
  return { selector, template: await parseTemplate(src), scope: "sc" };
}

Deno.test("BUG AC: author entity in a component-tag attribute → single-escaped in {{x}}", async () => {
  clearStaticCache();
  const card = await staticDef("my-card", `<span>{{ title }}</span>`);
  const registry = { get: (s: string) => (s === "my-card" ? card : undefined) };
  const root = await parseTemplate(`<my-card title="Tom &amp; Jerry"></my-card>`);
  const html = renderNodes(named(root), { scope: {}, registry, source: root.text });

  assertStringIncludes(html, ">Tom &amp; Jerry<", "single-escaped: author '&amp;' decoded then escaped once");
  assert(!html.includes("&amp;amp;"), "must NOT double-escape into '&amp;amp;'");
});

Deno.test("BUG AC: author entity re-emitted via [title] → single-escaped attribute", async () => {
  clearStaticCache();
  const card = await staticDef("my-card", `<div [title]="title"></div>`);
  const registry = { get: (s: string) => (s === "my-card" ? card : undefined) };
  const root = await parseTemplate(`<my-card title="a &amp; b"></my-card>`);
  const html = renderNodes(named(root), { scope: {}, registry, source: root.text });

  assertStringIncludes(html, `title="a &amp; b"`, "child re-emits the decoded value, escaped once");
  assert(!html.includes("&amp;amp;"), "must NOT double-escape into '&amp;amp;'");
});

Deno.test("BUG AC SECURITY: an INTERPOLATED component-tag attribute is still escaped by the child", async () => {
  clearStaticCache();
  const card = await staticDef("my-card", `<div [title]="title"></div>`);
  const registry = { get: (s: string) => (s === "my-card" ? card : undefined) };
  const root = await parseTemplate(`<my-card title="{{ x }}"></my-card>`);
  const html = renderNodes(named(root), { scope: { x: `"><script>` }, registry, source: root.text });

  // interpolation stays RAW data → child escapes once → no breakout
  assert(!html.includes(`"><script>`), "interpolated value must be escaped — no attribute breakout");
  assertStringIncludes(html, `title="&quot;&gt;&lt;script&gt;"`, "runtime data is escaped exactly once by the child");
});
