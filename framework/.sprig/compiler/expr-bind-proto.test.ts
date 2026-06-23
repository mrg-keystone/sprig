import { assertEquals } from "@std/assert";
import { field, named, parseTemplate } from "./parse.ts";
import { evalExpr, type Scope } from "./expr.ts";

async function expr(src: string) {
  const root = await parseTemplate(`{{ ${src} }}`);
  const interp = named(root).find((n) => n.type === "interpolation")!;
  return field(interp, "expression");
}

// BUG (cross-model lens P1) — a computed-member method call must bind `this` to
// the receiver exactly like a dotted call: obj.add() and obj['add']() must agree.
// Before the fix, the subscript callee fell through the receiver-rebind branch and
// was invoked unbound → `this` undefined → TypeError reading this.total.
Deno.test("computed-member call obj[key]() binds `this` to the receiver", async () => {
  const scope: Scope = {
    key: "add",
    obj: { total: 10, add() { return (this as { total: number }).total + 1; } },
  };
  assertEquals(evalExpr(await expr("obj[key]()"), scope), 11);
  // dotted control behaves the same
  const dotted: Scope = { obj: { total: 10, add() { return (this as { total: number }).total + 1; } } };
  assertEquals(evalExpr(await expr("obj.add()"), dotted), 11);
});

// BUG (cross-model lens P3) — an arrow body must still resolve a class-instance
// scope's PROTOTYPE methods/fields. makeArrow used `{...scope}` (own props only),
// dropping the prototype, so a prototype method called inside an arrow returned
// undefined. Mirrors evalStatement's deliberate Object.create(scope) handling.
Deno.test("arrow body resolves a class-instance scope's prototype method", async () => {
  class Logic {
    value = 41;
    method() { return this.value + 1; }
  }
  const fn = evalExpr(await expr("(() => method())"), new Logic() as unknown as Scope) as () => unknown;
  assertEquals(fn(), 42);
});
