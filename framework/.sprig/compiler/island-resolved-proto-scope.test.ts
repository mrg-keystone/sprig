// BUG AK: resolveIslands clones the scope for @let isolation via
// `opts = { ...opts, scope: { ...opts.scope } }`. But when a CLASS island's resolve()
// returns a class INSTANCE, its methods live on the PROTOTYPE; the object-spread copies
// only OWN enumerable props, DROPPING the prototype methods. So when that island's
// template binds a NESTED async island input to a method call (e.g. <child-isl
// [msg]="format()">), the pre-pass computeInputs evaluates format() against the
// prototype-stripped plain object → undefined → the nested async island's resolve() gets
// undefined → its SSR body + hydration __snapshot are wrong (empty), while the parent sync
// render (real instance, unspread) puts the correct value in the props bridge → SSR /
// hydration divergence.
//
// FIX: clone while PRESERVING the prototype so class-instance methods survive:
//   Object.create(Object.getPrototypeOf(opts.scope), Object.getOwnPropertyDescriptors(opts.scope))
// This keeps @let isolation (a @let write adds/overrides an OWN data prop on the front
// clone, not the shared instance, since own data-prop descriptors are copied by value) AND
// lets scope.method() resolve through the prototype, matching the sync render.
import { assert, assertStringIncludes } from "jsr:@std/assert";
import { named, parseTemplate } from "./parse.ts";
import { islandHost, renderNodes, resolveIslands, type ComponentDef } from "./render.ts";
import type { Scope } from "./expr.ts";

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

// child-isl: a nested CLASS island whose async resolve() echoes its @input msg into both
// its rendered body and (via snapshot:true) its hydration props bridge.
async function makeChild(): Promise<ComponentDef> {
  return {
    selector: "child-isl",
    template: await parseTemplate(`<span>{{ msg }}</span>`),
    scope: "ci",
    island: {
      scope: (i: Scope) => ({ msg: i.msg }),
      trigger: "load",
      snapshot: true,
      resolve: async (i: Scope) => {
        await sleep(10);
        return { msg: i.msg };
      },
    },
  };
}

function registryWith(...defs: ComponentDef[]) {
  const map: Record<string, ComponentDef> = {};
  for (const d of defs) map[d.selector] = d;
  return { get: (s: string) => map[s] };
}

// CASE-B: parent island resolve() returns a class INSTANCE whose format() lives on the
// PROTOTYPE. The nested child-isl binds [msg]="format()". With the prototype-stripping
// clone bug, the pre-pass sees format===undefined → child resolves msg=undefined → empty.
Deno.test("BUG AK CASE-B: a nested island bound to a parent-island PROTOTYPE method resolves correctly", async () => {
  const child = await makeChild();

  class VM {
    // index signature so a VM instance is assignable to Scope (string-keyed record)
    [k: string]: unknown;
    name: string;
    constructor(name: string) {
      this.name = name;
    }
    format() {
      return "Hi " + this.name;
    }
  }
  const vmIsl: ComponentDef = {
    selector: "vm-isl",
    template: await parseTemplate(`<child-isl [msg]="format()"></child-isl>`),
    scope: "vm",
    island: {
      // sync scope() also returns an instance (so the sync render works); the bug is in
      // the async pre-pass clone that strips the prototype before the nested computeInputs.
      scope: (i: Scope) => new VM(i.name as string),
      trigger: "load",
      snapshot: true,
      resolve: async (i: Scope) => {
        await sleep(5);
        return new VM(i.name as string);
      },
    },
  };
  const registry = registryWith(child, vmIsl);
  const page = await parseTemplate(`<vm-isl [name]="who"></vm-isl>`);
  const base = { scope: { who: "Ada" } as Scope, registry, source: page.text };

  const resolved = new Map<string, Scope>();
  await resolveIslands(named(page), base, resolved);
  const html = renderNodes(named(page), { ...base, resolved });

  assertStringIncludes(html, ">Hi Ada<", "the nested island must render the parent prototype method's value");

  // and the nested island's hydration __snapshot must carry {msg:"Hi Ada"}, not {} or undefined.
  const expected = islandHost("ci", "child-isl", "load", { msg: "Hi Ada", __snapshot: { msg: "Hi Ada" } }, "");
  const snap = expected.match(/<script[^>]*class="sprig-props">(.*?)<\/script>/)![1];
  assertStringIncludes(html, snap, "the nested island snapshot must be {msg:'Hi Ada'} (no prototype-stripping)");
});

// CASE-A control: parent island resolve() returns a PLAIN object with format() as an OWN
// property. Object-spread preserves own props, so this already passes regardless of the fix.
Deno.test("BUG AK CASE-A control: a parent-island OWN-property method already resolves", async () => {
  const child = await makeChild();
  const vmIsl: ComponentDef = {
    selector: "vm-isl",
    template: await parseTemplate(`<child-isl [msg]="format()"></child-isl>`),
    scope: "vm",
    island: {
      scope: (i: Scope) => ({ name: i.name, format() { return "Hi " + (i.name as string); } }),
      trigger: "load",
      snapshot: true,
      resolve: async (i: Scope) => {
        await sleep(5);
        return { name: i.name, format() { return "Hi " + (i.name as string); } };
      },
    },
  };
  const registry = registryWith(child, vmIsl);
  const page = await parseTemplate(`<vm-isl [name]="who"></vm-isl>`);
  const base = { scope: { who: "Bob" } as Scope, registry, source: page.text };

  const resolved = new Map<string, Scope>();
  await resolveIslands(named(page), base, resolved);
  const html = renderNodes(named(page), { ...base, resolved });

  assertStringIncludes(html, ">Hi Bob<", "control: an own-property method resolves with or without the fix");
  assert(!html.includes(">undefined<"), "control: must not be undefined");
});
