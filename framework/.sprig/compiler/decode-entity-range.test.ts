// BUG AE: decodeEntities (render.ts) decodes a numeric HTML entity via
// String.fromCodePoint(code) guarded ONLY by Number.isFinite(code). The regex allows
// unbounded magnitudes (&#xHH…; and &#NN…;), so an author entity ABOVE U+10FFFF — e.g.
// &#1114112; / &#x110000; / &#9999999999; — is finite, passes the guard, and
// String.fromCodePoint THROWS RangeError: Invalid code point. Uncaught, it propagates out
// of decodeEntities → inputText → computeInputs → renderComponent → renderNodes → HTTP 500.
// The function already has a graceful fallback (return the raw match) for non-decodable
// cases; the range/integer check that makes it hold is missing.
// FIX: bound-check the code point: (Number.isInteger(code) && 0 <= code <= 0x10FFFF)
// ? fromCodePoint : raw match. Named + valid numeric entities keep working.
import { assert, assertStringIncludes } from "jsr:@std/assert";
import { named, parseTemplate } from "./parse.ts";
import { clearStaticCache, renderNodes } from "./render.ts";

// deno-lint-ignore no-explicit-any
async function staticDef(selector: string, src: string): Promise<any> {
  return { selector, template: await parseTemplate(src), scope: "sc" };
}

Deno.test("BUG AE: an out-of-range numeric entity in a component-tag attr does NOT throw", async () => {
  clearStaticCache();
  const card = await staticDef("my-card", `<span>{{ title }}</span>`);
  const registry = { get: (s: string) => (s === "my-card" ? card : undefined) };
  const root = await parseTemplate(`<my-card title="x &#1114112; y"></my-card>`);

  let html = "";
  // renderNodes MUST NOT throw on an out-of-range code point.
  html = renderNodes(named(root), { scope: {}, registry, source: root.text });

  // It is left intact (raw match — the child re-escapes the '&' to '&amp;' on render)
  // or replaced by U+FFFD — never a crash.
  assert(
    html.includes("#1114112;") || html.includes("�"),
    `out-of-range entity left literal or replaced, got: ${html}`,
  );
  assertStringIncludes(html, "x ", "surrounding literal text preserved");
  assertStringIncludes(html, " y", "surrounding literal text preserved");
});

Deno.test("BUG AE: other out-of-range forms (&#x110000; / huge decimal) also do NOT throw", async () => {
  clearStaticCache();
  const card = await staticDef("my-card", `<span>{{ title }}</span>`);
  const registry = { get: (s: string) => (s === "my-card" ? card : undefined) };
  for (const ent of ["&#x110000;", "&#9999999999;"]) {
    const root = await parseTemplate(`<my-card title="a ${ent} b"></my-card>`);
    const html = renderNodes(named(root), { scope: {}, registry, source: root.text });
    // raw match preserved (the leading '&' re-escapes to '&amp;') or U+FFFD; never a crash.
    assert(
      html.includes(ent.slice(1)) || html.includes("�"),
      `${ent} left literal or replaced, got: ${html}`,
    );
  }
});

Deno.test("BUG AE: valid numeric + named entities still decode", async () => {
  clearStaticCache();
  const card = await staticDef("my-card", `<span>{{ title }}</span>`);
  const registry = { get: (s: string) => (s === "my-card" ? card : undefined) };

  const r1 = await parseTemplate(`<my-card title="&#65;"></my-card>`);
  assertStringIncludes(
    renderNodes(named(r1), { scope: {}, registry, source: r1.text }),
    ">A<",
    "&#65; decodes to A",
  );

  const r2 = await parseTemplate(`<my-card title="&#128512;"></my-card>`);
  assertStringIncludes(
    renderNodes(named(r2), { scope: {}, registry, source: r2.text }),
    ">\u{1F600}<",
    "&#128512; decodes to the emoji",
  );

  const r3 = await parseTemplate(`<my-card title="Tom &amp; Jerry"></my-card>`);
  assertStringIncludes(
    renderNodes(named(r3), { scope: {}, registry, source: r3.text }),
    ">Tom &amp; Jerry<",
    "named &amp; still decodes then re-escapes once",
  );
});
