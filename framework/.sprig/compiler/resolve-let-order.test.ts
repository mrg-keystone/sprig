// BUG AG: resolveIslands skips EVERY non-element node (the early `continue` for any node
// whose type is not element/self_closing_element), so it NEVER applies @let
// (let_declaration) bindings — unlike the sync render (renderNode case let_declaration
// mutates opts.scope in document order). So for an async-resolve island that is a SIBLING
// following a @let in the same node list, computeInputs(attrs, opts.scope) in the pre-pass
// evaluates against a scope MISSING the @let binding; resolve() runs with stale/undefined
// inputs, and the resolved scope is reused verbatim by the sync render → the @let-derived
// value is DROPPED at SSR.
// FIX: process let_declaration nodes IN DOCUMENT ORDER in resolveIslands before the
// element-skip, mirroring renderNode — on a clone of the scope so the caller's object is
// not mutated. Following sibling islands then see the @let.
import { assert, assertStringIncludes } from "jsr:@std/assert";
import { named, parseTemplate } from "./parse.ts";
import { renderNodes, resolveIslands, type ComponentDef } from "./render.ts";
import type { Scope } from "./expr.ts";

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

// child-island: a CLASS island whose async resolve() echoes its @input msg.
async function makeIsland(): Promise<ComponentDef> {
  return {
    selector: "child-island",
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

Deno.test("BUG AG: an island sibling after a @let sees the @let value through the pre-pass", async () => {
  const child = await makeIsland();
  const registry = registryWith(child);
  const page = await parseTemplate(`@let answer = 42; <child-island [msg]="answer"></child-island>`);
  const base = { scope: {} as Scope, registry, source: page.text };

  const resolved = new Map<string, Scope>();
  await resolveIslands(named(page), base, resolved);
  const html = renderNodes(named(page), { ...base, resolved });

  assertStringIncludes(html, ">42<", "the island must see the @let-derived input via the pre-pass");
});

Deno.test("BUG AG control: a plain sync render (no pre-pass) already renders the @let value", async () => {
  const child = await makeIsland();
  const registry = registryWith(child);
  const page = await parseTemplate(`@let answer = 42; <child-island [msg]="answer"></child-island>`);
  // no resolveIslands: the sync render applies the @let in document order and the island
  // falls back to its synchronous scope() — which echoes msg=42 correctly.
  const html = renderNodes(named(page), { scope: {} as Scope, registry, source: page.text });
  assertStringIncludes(html, ">42<", "control: sync render applies @let in order");
});
