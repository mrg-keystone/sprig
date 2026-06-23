import { assertEquals } from "@std/assert";
import { field, named, parseTemplate } from "./parse.ts";
import { evalExpr, type Scope } from "./expr.ts";

async function expr(src: string) {
  const root = await parseTemplate(`{{ ${src} }}`);
  const interp = named(root).find((n) => n.type === "interpolation")!;
  return field(interp, "expression");
}

// BUG K — formatDatePattern 'yy' must emit two non-negative digits even for a BC (negative) year.
Deno.test("BUG K: 'yy' token never emits a sign for a negative year", async () => {
  const scope: Scope = {
    bc: new Date("-000005-06-15T00:00:00Z"),
    y2026: new Date("2026-06-15T00:00:00Z"),
    y2005: new Date("2005-06-15T00:00:00Z"),
  };
  const e = async (s: string) => evalExpr(await expr(s), scope);
  assertEquals(await e("bc | date:'yy'"), "95"); // (-5 % 100 + 100) % 100 → 95, no "-5"
  assertEquals(await e("y2026 | date:'yy'"), "26");
  assertEquals(await e("y2005 | date:'yy'"), "05");
});
