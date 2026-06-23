import { assertEquals } from "@std/assert";
import { field, named, parseTemplate } from "./parse.ts";
import { evalExpr } from "./expr.ts";

async function expr(src: string) {
  const root = await parseTemplate(`{{ ${src} }}`);
  const interp = named(root).find((n) => n.type === "interpolation")!;
  return field(interp, "expression");
}

// BUG O — unquote() must INTERPRET standard C-style escapes in string literals.
Deno.test("BUG O: string-literal escapes are interpreted (\\n \\t \\r \\u \\x)", async () => {
  const e = async (s: string) => evalExpr(await expr(s), {});
  assertEquals(await e("'line1\\nline2'"), "line1\nline2"); // real newline, not "line1nline2"
  assertEquals(await e("'a\\tb'"), "a\tb");
  assertEquals(await e("'a\\rb'"), "a\rb");
  assertEquals(await e("'\\u0041'"), "A");
  assertEquals(await e("'\\x41'"), "A");
  // these must STAY correct
  assertEquals(await e("'a\\\\b'"), "a\\b"); // \\ → single backslash
  assertEquals(await e("'q\\'s'"), "q's"); // \' → '
});
