import { assert, assertEquals } from "@std/assert";
import { field, named, parseTemplate } from "../ui/.sprig/compiler/parse.ts";
import { evalExpr, evalStatement, type Scope } from "../ui/.sprig/compiler/expr.ts";
import { fromSerialized, serialize } from "../ui/.sprig/compiler/serialize.ts";
import type { Node } from "../ui/.sprig/compiler/node.ts";

function find(n: Node, t: string): Node | null {
  if (n.type === t) return n;
  for (const c of n.namedChildren) {
    if (!c) continue;
    const r = find(c, t);
    if (r) return r;
  }
  return null;
}

// Parse `{{ <src> }}` and evaluate the interpolation expression against `scope`.
async function evalInterp(src: string, scope: Scope): Promise<unknown> {
  const root = await parseTemplate(`{{ ${src} }}`);
  const interp = named(root).find((n: Node) => n.type === "interpolation")!;
  return evalExpr(field(interp, "expression"), scope);
}

// ─────────────────────────── bug 9 ───────────────────────────
// Multi-statement event handlers must run EVERY ';'-separated statement.
// The real-world drop happens because render.ts hands evalStatement only
// `field(event_binding, "handler")` (the FIRST statement). The fix in expr.ts is
// that evalStatement now accepts the whole `event_binding` node and runs every
// statement child; render.ts must pass that node (crossFileNeeded: render.ts).
Deno.test("bug 9: multi-statement event handler runs all statements", async () => {
  const root = await parseTemplate(`<button (click)="open = true; ready = true">x</button>`);
  const ev = find(root, "event_binding")!;
  // Production scope vars are signals ({ set }); evalStatement copies the scope
  // for $event binding, so assignment must go through the shared signal target.
  const make = () => {
    let open = false, ready = false;
    return {
      scope: {
        open: { set: (v: unknown) => (open = v as boolean) },
        ready: { set: (v: unknown) => (ready = v as boolean) },
      } as Scope,
      get: () => ({ open, ready }),
    };
  };

  // Demonstrate the production-seam defect: render.ts passes field(.,"handler") =
  // the FIRST statement only → the second statement is silently dropped.
  const a = make();
  const firstStmtOnly = field(ev, "handler")!; // what render.ts hands over today
  evalStatement(firstStmtOnly, a.scope, {});
  assertEquals(a.get(), { open: true, ready: false }, "first-statement-only drops stmt 2");

  // Corrected contract: pass the whole event_binding node → ALL statements run.
  const b = make();
  evalStatement(ev, b.scope, {});
  assertEquals(b.get(), { open: true, ready: true }, "all statements must run");
});

// ─────────────────────────── bug 10 ──────────────────────────
// Multi-arg pipes (slice:1:3) must receive every argument.
Deno.test("bug 10: multi-arg pipe slice:1:3 passes both args", async () => {
  const out = await evalInterp("items | slice:1:3", { items: [10, 20, 30, 40, 50] });
  assertEquals(out, [20, 30]); // items.slice(1,3); buggy code gave [20,30,40,50]
});

// ─────────────────────────── bug 32 ──────────────────────────
// Serialized AST must not diverge from the wasm tree for repeated fields.
Deno.test("bug 32: multi-arg pipe SSR (wasm) === client (serialized)", async () => {
  const root = await parseTemplate(`{{ items | slice:1:3 }}`);
  const scope: Scope = { items: ["a", "b", "c", "d", "e"] };
  const serverPipe = find(root, "pipe_expression")!;
  const server = evalExpr(serverPipe, scope);
  const clientPipe = find(fromSerialized(serialize(root)), "pipe_expression")!;
  const client = evalExpr(clientPipe, scope);
  assertEquals(server, ["b", "c"], "server slice(1,3)");
  assertEquals(client, ["b", "c"], "client slice(1,3)");
  assertEquals(
    JSON.stringify(server),
    JSON.stringify(client),
    "SSR and client must agree",
  );
});

// ─────────────────────────── bug 33 ──────────────────────────
// Contradictory / out-of-range digitsInfo must not throw a RangeError.
Deno.test("bug 33: number/percent digitsInfo minFrac>maxFrac does not crash", async () => {
  // '1.3-2' (min 3 > max 2) and '1.0-101' (max > 100) threw RangeError before.
  const a = await evalInterp("value | number:'1.3-2'", { value: 42 });
  assertEquals(typeof a, "string");
  assertEquals(a, "42.000"); // clamped: maxFrac raised to minFrac=3 ⇒ no crash
  const b = await evalInterp("value | percent:'1.0-101'", { value: 0.5 });
  assertEquals(typeof b, "string");
});

// ─────────────────────────── bug 34 ──────────────────────────
// digitsInfo without the optional '-max' segment must still apply minFraction.
Deno.test("bug 34: number:'1.2' applies minFraction (3.50)", async () => {
  assertEquals(await evalInterp("v | number:'1.2'", { v: 3.5 }), "3.50");
  assertEquals(await evalInterp("v | number:'1.4'", { v: 3.5 }), "3.5000");
});

// ─────────────────────────── bug 35 ──────────────────────────
// date pipe must format custom/unsupported formats, not leak raw ISO.
Deno.test("bug 35: date pipe formats custom patterns and extra aliases", async () => {
  const scope: Scope = { d: "2026-06-21T14:30:00Z" };
  assertEquals(await evalInterp("d | date:'yyyy-MM-dd'", scope), "2026-06-21");
  assertEquals(await evalInterp("d | date:'longDate'", scope), "June 21, 2026");
  const mmm = await evalInterp("d | date:'MMM d, y'", scope) as string;
  assertEquals(mmm, "Jun 21, 2026");
  // must NOT be the raw ISO timestamp
  for (const fmt of ["yyyy-MM-dd", "longDate", "shortTime", "fullTime"]) {
    const out = await evalInterp(`d | date:'${fmt}'`, scope) as string;
    assert(!out.includes("T") || !out.endsWith("Z"), `raw ISO leaked for ${fmt}: ${out}`);
  }
});

// ─────────────────────────── bug 76 ──────────────────────────
// titlecase must capitalize non-ASCII initial letters.
Deno.test("bug 76: titlecase handles non-ASCII initials", async () => {
  assertEquals(await evalInterp("name | titlecase", { name: "éric" }), "Éric");
  assertEquals(await evalInterp("name | titlecase", { name: "über" }), "Über");
  assertEquals(await evalInterp("name | titlecase", { name: "éric dupont" }), "Éric Dupont");
  assertEquals(await evalInterp("name | titlecase", { name: "hello world" }), "Hello World");
});

// ─────────────────────────── bug 78 ──────────────────────────
// i18nPlural must not throw when the matched ICU value is not a string.
Deno.test("bug 78: i18nPlural tolerates non-string map values", async () => {
  const out = await evalInterp("count | i18nPlural: { '=1': 1, other: 0 }", { count: 1 });
  assertEquals(out, "1"); // String(1).replace('#', '1') === "1"; was a TypeError
});

// ─────────────────────────── bug 79 ──────────────────────────
// minIntegerDigits in digitsInfo must pad the integer part.
Deno.test("bug 79: number:'3.0-0' pads integer digits → 005", async () => {
  assertEquals(await evalInterp("v | number:'3.0-0'", { v: 5 }), "005");
});

// ─────────────────────────── bug 80 ──────────────────────────
// Subscript assignment (arr[i] = x / obj['k'] = x) must write.
Deno.test("bug 80: subscript assignment writes in event handlers", async () => {
  const root = await parseTemplate(`<button (click)="items[0] = 5">x</button>`);
  const ev = find(root, "event_binding")!;
  const items = [1, 2, 3];
  evalStatement(ev, { items }, {});
  assertEquals(items[0], 5, "items[0] should be written");

  const root2 = await parseTemplate(`<button (click)="obj['k'] = 9">x</button>`);
  const ev2 = find(root2, "event_binding")!;
  const obj: Record<string, unknown> = {};
  evalStatement(ev2, { obj }, {});
  assertEquals(obj.k, 9, "obj['k'] should be written");
});

// ─────────────────────────── bug 81 ──────────────────────────
// number/percent/currency must not render literal NaN.
Deno.test("bug 81: pipes return '' for non-numeric/undefined input", async () => {
  assertEquals(await evalInterp("missing | number", {}), "");
  assertEquals(await evalInterp("missing | percent", {}), "");
  assertEquals(await evalInterp("missing | currency", {}), "");
  assertEquals(await evalInterp("x | number", { x: "abc" }), "");
});

// ─────────────────────────── bug 82 ──────────────────────────
// percent default digitsInfo is '1.0-0' (0 fraction digits).
Deno.test("bug 82: percent default rounds to 0 fraction digits", async () => {
  assertEquals(await evalInterp("v | percent", { v: 0.12345 }), "12%");
  assertEquals(await evalInterp("ratio | percent", { ratio: 0.1234 }), "12%");
});

// ─────────────────────────── bug 83 ──────────────────────────
// minIntegerDigits honored even with a full digitsInfo.
Deno.test("bug 83: number:'3.1-5' pads integer digits → 005.0", async () => {
  assertEquals(await evalInterp("v | number:'3.1-5'", { v: 5 }), "005.0");
});
