// Phase 4 (evaluator): a class instance can BE an island's scope — template method
// calls bind `this`, and prototype methods resolve inside event handlers (no spread).
// Backward-compatible with today's plain-object/arrow-function scopes.
import { assert, assertEquals } from "jsr:@std/assert";
import { signal } from "@sprig/core";
import { named, parseTemplate } from "./parse.ts";
import { evalStatement, type Scope } from "./expr.ts";
import { renderNodes } from "./render.ts";
import type { Node } from "./node.ts";

const render = async (src: string, scope: Scope): Promise<string> => {
  const root = await parseTemplate(src);
  return renderNodes(named(root), { scope, registry: { get: () => undefined }, source: root.text });
};

function findEventBinding(node: Node): Node | null {
  if (node.type === "event_binding") return node;
  for (const c of named(node)) {
    const f = findEventBinding(c);
    if (f) return f;
  }
  return null;
}

Deno.test("class method using `this` works in interpolation", async () => {
  class Greeter {
    constructor(public name: string) {}
    greet() { return `Hi ${this.name}`; }     // regular method → needs `this`
    shout() { return `${this.greet()}!`; }     // method → method (this.greet)
  }
  const g = () => new Greeter("Ada") as unknown as Scope;
  assertEquals(await render(`<p>{{ greet() }}</p>`, g()), "<p>Hi Ada</p>");
  assertEquals(await render(`<p>{{ shout() }}</p>`, g()), "<p>Hi Ada!</p>");
});

Deno.test("prototype method resolves + `this` binds inside an event handler", async () => {
  class Counter {
    count = signal(0);
    inc() { this.count.set(this.count() + 1); } // both: method on proto, this.count signal
  }
  const inst = new Counter();
  const root = await parseTemplate(`<button (click)="inc()">+</button>`);
  const ev = findEventBinding(root)!;
  assert(ev, "found the (click) binding");

  evalStatement(ev, inst as unknown as Scope, new Event("click"));
  evalStatement(ev, inst as unknown as Scope, new Event("click"));
  assertEquals(inst.count(), 2, "the prototype method ran twice with `this` bound to the instance");
});

Deno.test("backward-compatible: plain-object arrow scopes still work", async () => {
  // today's model: a returned object of signals + arrow closures (no `this`)
  const count = signal(5);
  const scope = { count, inc: () => count.set(count() + 1) };
  assertEquals(await render(`<p>{{ count() }}</p>`, scope), "<p>5</p>");
  const root = await parseTemplate(`<button (click)="inc()">+</button>`);
  evalStatement(findEventBinding(root)!, scope, new Event("click"));
  assertEquals(count(), 6, "arrow-closure handler still fires (this-binding is harmless to it)");
});

Deno.test("$event is available and does not leak into the scope", async () => {
  const seen: unknown[] = [];
  const scope = { grab: (e: unknown) => seen.push(e) };
  const root = await parseTemplate(`<button (click)="grab($event)">x</button>`);
  const ev = findEventBinding(root)!;
  const realEvent = new Event("click");
  evalStatement(ev, scope, realEvent);
  assertEquals(seen[0], realEvent, "$event passed through");
  assert(!("$event" in scope), "$event must not be written onto the real scope");
});
