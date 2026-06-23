import { assertEquals } from "@std/assert";
import { field, named, parseTemplate } from "./parse.ts";
import { evalExpr } from "./expr.ts";

async function expr(src: string) {
  const root = await parseTemplate(`{{ ${src} }}`);
  const interp = named(root).find((n) => n.type === "interpolation")!;
  return field(interp, "expression");
}

// BUG J — truncate pipe must clamp a negative/zero limit instead of slicing from the end.
Deno.test("BUG J: truncate clamps a negative limit (no end-slicing)", async () => {
  const e = async (s: string) => evalExpr(await expr(s), {});
  assertEquals(await e("'hello' | truncate:-2"), "hello"); // NOT "hel…"
  assertEquals(await e("'hello' | truncate:3"), "hel…"); // positive limit unchanged
  assertEquals(await e("'hi' | truncate:10"), "hi"); // shorter than limit unchanged
});
