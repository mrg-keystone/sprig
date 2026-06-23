import { assertEquals } from "@std/assert";
import { field, named, parseTemplate } from "./parse.ts";
import { evalExpr } from "./expr.ts";

async function val(src: string): Promise<unknown> {
  const root = await parseTemplate(`{{ ${src} }}`);
  const interp = named(root).find((n) => n.type === "interpolation")!;
  return evalExpr(field(interp, "expression"), {});
}

// BUG (cross-model lens P4 / workflow encoding-1) — a string-literal escape must
// NEVER crash the evaluator. unquote()'s regex only matched \uXXXX / \xNN; the
// ES2015 brace form \u{...} and any malformed \u/\x fell through to `.`, capturing
// a bare "u"/"x" → parseInt("",16)=NaN → String.fromCodePoint(NaN) threw RangeError,
// aborting the WHOLE SSR render from a syntactically-valid template.
Deno.test("braced unicode escape \\u{...} decodes (incl. astral)", async () => {
  assertEquals(await val("'\\u{1F600}'"), "😀");
  assertEquals(await val("'\\u{41}'"), "A");
  assertEquals(await val("'a\\u{1F600}b'"), "a😀b");
});

Deno.test("malformed \\u / \\x escapes degrade to the literal char, never throw", async () => {
  assertEquals(await val("'\\u'"), "u"); // bare \u
  assertEquals(await val("'\\users'"), "users"); // \u not followed by 4 hex
  assertEquals(await val("'\\x'"), "x");
  assertEquals(await val("'\\xG1'"), "xG1");
});

Deno.test("standard \\uXXXX / \\xNN and named escapes still work", async () => {
  assertEquals(await val("'\\u0041'"), "A");
  assertEquals(await val("'\\x41'"), "A");
  assertEquals(await val("'l1\\nl2'"), "l1\nl2");
  assertEquals(await val("'a\\\\b'"), "a\\b");
});
