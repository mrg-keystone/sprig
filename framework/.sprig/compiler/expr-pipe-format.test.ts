// Force a UTC-negative timezone BEFORE any Date is constructed, so the date-only
// off-by-one is a deterministic RED→GREEN guard regardless of the CI's ambient TZ.
// (Verified to take effect in Deno; date-only formatting is TZ-invariant post-fix,
// so this leaks no TZ-dependence into other suites.)
Deno.env.set("TZ", "America/Los_Angeles");

import { assertEquals } from "@std/assert";
import { field, named, parseTemplate } from "./parse.ts";
import { evalExpr } from "./expr.ts";

async function val(src: string): Promise<unknown> {
  const root = await parseTemplate(`{{ ${src} }}`);
  const interp = named(root).find((n) => n.type === "interpolation")!;
  return evalExpr(field(interp, "expression"), {});
}

// BUG (workflow numeric-1) — the percent pipe scaled with a binary-float multiply
// (Number(v)*100), so a product landing just under a .5 boundary rounded DOWN one
// integer too far (0.575*100 = 57.4999… → "57%"). Must agree with Angular/Intl.
Deno.test("percent pipe rounds like Angular/Intl (no binary-float ×100 error)", async () => {
  assertEquals(await val("0.575 | percent"), "58%");
  assertEquals(await val("0.145 | percent"), "15%");
  assertEquals(await val("0.565 | percent"), "57%");
  assertEquals(await val("0.385 | percent"), "39%"); // already-correct case stays correct
  assertEquals(await val("0.5 | percent"), "50%");
});

// BUG (workflow encoding-2) — a date-only ISO string parsed as UTC midnight but
// formatted with LOCAL getters → off-by-one day in a UTC-negative TZ (and an SSR
// vs client hydration mismatch). Angular's DatePipe treats it as LOCAL midnight.
Deno.test("date pipe treats a date-only ISO string as LOCAL midnight (TZ-stable)", async () => {
  assertEquals(await val("'2024-01-15' | date:'yyyy-MM-dd'"), "2024-01-15");
  assertEquals(await val("'2024-01-15' | date:'mediumDate'"), "Jan 15, 2024");
});
