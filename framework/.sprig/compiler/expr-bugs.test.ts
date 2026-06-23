import { assert, assertEquals } from "@std/assert";
import { field, named, parseTemplate } from "./parse.ts";
import { evalExpr, type Scope } from "./expr.ts";

// Build the expression sub-AST from `{{ <src> }}` exactly like compiler.test.ts.
async function expr(src: string) {
  const root = await parseTemplate(`{{ ${src} }}`);
  const interp = named(root).find((n) => n.type === "interpolation")!;
  return field(interp, "expression");
}

// ───────────────────────── BUG G: member call double-eval ──────────────────
Deno.test("BUG G: a member call evaluates its receiver exactly once", async () => {
  let calls = 0;
  const scope: Scope = {
    factory: () => {
      calls++;
      return { value: () => 1 };
    },
  };
  // factory() must run ONCE, and .value() must return its result (1), not the
  // result of a second factory() invocation.
  const result = evalExpr(await expr("factory().value()"), scope);
  assertEquals(result, 1, "value() should return 1 from a single factory()");
  assertEquals(calls, 1, "factory() must be invoked exactly once");
});

Deno.test("BUG G: `this` binds to the same receiver the method was read from", async () => {
  let calls = 0;
  const scope: Scope = {
    factory: () => {
      calls++;
      const obj = { id: calls, who(this: { id: number }) { return this.id; } };
      return obj;
    },
  };
  // The receiver of who() is the object factory() returned; with a single eval
  // its id is 1. (A double-eval would read who from obj#1 but apply it to obj#2.)
  assertEquals(evalExpr(await expr("factory().who()"), scope), 1);
  assertEquals(calls, 1);
});

Deno.test("BUG G: existing member-call behavior (items.reduce) still works", async () => {
  const scope: Scope = { items: [1, 2, 3] };
  assertEquals(evalExpr(await expr("items.reduce((s, i) => s + i, 0)"), scope), 6);
});

// ───────────────────────── BUG B: i18nPlural NaN leak ──────────────────────
Deno.test("BUG B: i18nPlural never renders the literal 'NaN'", async () => {
  const map = { "=0": "none", other: "# items" };
  const run = async (count: unknown) =>
    evalExpr(await expr("count | i18nPlural: m"), { count, m: map }) as string;

  // non-numeric / undefined input must NOT leak "NaN"
  const undef = await run(undefined);
  assert(!undef.includes("NaN"), `undefined count leaked NaN: "${undef}"`);
  const str = await run("abc");
  assert(!str.includes("NaN"), `non-numeric count leaked NaN: "${str}"`);

  // numeric cases still work
  assertEquals(await run(0), "none");
  assertEquals(await run(5), "5 items");
});

// ───────────────────────── BUG F: titlecase astral initial ─────────────────
Deno.test("BUG F: titlecase uppercases an astral-plane initial", async () => {
  // U+10428/U+10429 are lowercase Deseret; uppercasing the initial → U+10400.
  const scope: Scope = { w: "\u{10428}\u{10429}" };
  const out = evalExpr(await expr("w | titlecase"), scope) as string;
  assertEquals([...out][0], "\u{10400}", "first code point must be uppercased");
});

Deno.test("BUG F: titlecase keeps BMP cases working", async () => {
  const tc = async (v: string) => evalExpr(await expr("w | titlecase"), { w: v });
  assertEquals(await tc("éric"), "Éric");
  assertEquals(await tc("hello world"), "Hello World");
});
