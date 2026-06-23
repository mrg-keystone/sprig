// BUG H: an island nested inside a STATIC component loses the async pre-pass `resolved`
// scope. resolveIslands() awaits each class-island's onServerInit and records node→scope in
// `resolved`, but renderComponent's static-child (and island-body) renderNodes calls did NOT
// forward opts.resolved, so when render reaches the nested island it can't find its resolved
// scope and falls back to comp.island.scope(inputs) — the STALE pre-fetch value.
import { assert, assertStringIncludes } from "jsr:@std/assert";
import { named, parseTemplate } from "./parse.ts";
import { renderNodes, resolveIslands, type ComponentDef } from "./render.ts";
import type { Scope } from "./expr.ts";
import type { Node } from "./node.ts";

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

// a-isl: a CLASS island — sync scope() returns the stale "sync:N"; async resolve() awaits a
// "fetch" and returns the correct "async:N" (mirrors mod.ts sync-fallback vs awaited pre-pass).
async function makeIsland(): Promise<ComponentDef> {
  return {
    selector: "a-isl",
    template: await parseTemplate(`<span>{{label}}</span>`),
    scope: "aisl",
    island: {
      scope: (i: Scope) => ({ label: `sync:${i.n}` }),
      trigger: "load",
      snapshot: true,
      resolve: async (i: Scope) => {
        await sleep(10);
        return { label: `async:${i.n}` };
      },
    },
  };
}

async function registryWith(...defs: ComponentDef[]) {
  const map: Record<string, ComponentDef> = {};
  for (const d of defs) map[d.selector] = d;
  return { get: (s: string) => map[s] };
}

Deno.test("BUG H: an island nested in a STATIC component uses its awaited (resolved) scope", async () => {
  const aIsl = await makeIsland();
  const uCard: ComponentDef = { selector: "u-card", template: await parseTemplate(`<div><a-isl [n]="n"></a-isl></div>`), scope: "ucard" };
  const registry = await registryWith(aIsl, uCard);
  const page = await parseTemplate(`<u-card [n]="1"></u-card>`);
  const base = { scope: {} as Scope, registry, source: page.text };

  const resolved = new Map<Node, Scope>();
  await resolveIslands(named(page), base, resolved);
  const html = renderNodes(named(page), { ...base, resolved });

  assertStringIncludes(html, ">async:1<", "nested island must render the awaited resolved scope");
  assert(!html.includes(">sync:1<"), "nested island must NOT fall back to the stale sync scope");
});

Deno.test("BUG H control: an island embedded DIRECTLY (no static wrapper) already resolves", async () => {
  const aIsl = await makeIsland();
  const registry = await registryWith(aIsl);
  const page = await parseTemplate(`<div><a-isl [n]="2"></a-isl></div>`);
  const base = { scope: {} as Scope, registry, source: page.text };

  const resolved = new Map<Node, Scope>();
  await resolveIslands(named(page), base, resolved);
  const html = renderNodes(named(page), { ...base, resolved });

  assertStringIncludes(html, ">async:2<", "directly-embedded island resolves (control)");
});
