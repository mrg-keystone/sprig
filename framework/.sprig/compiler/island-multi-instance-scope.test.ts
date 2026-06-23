// BUG AB: resolveIslands keys the awaited island scope by the island AST Node, but a
// static (or island) component instantiated MULTIPLE times shares ONE template AST. So
// every instance writes the SAME node key in `resolved` (last-write-wins), and the sync
// render hands that one scope to ALL instances. For two <u-card> wrappers (n=1, n=2) around
// a class island whose onServerInit derives data from n, BOTH cards render the n=2 scope —
// and the n=1 card's hydration __snapshot carries n=2 state (a cross-instance data leak that
// crosses to the client). The control (two distinct <a-isl> nodes) is correct.
import { assert, assertStringIncludes } from "jsr:@std/assert";
import { named, parseTemplate } from "./parse.ts";
import { islandHost, renderNodes, resolveIslands, type ComponentDef } from "./render.ts";
import type { Scope } from "./expr.ts";
import type { Node } from "./node.ts";

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

// a-isl: a CLASS island — sync scope() returns "sync:N"; async resolve() awaits a "fetch"
// and returns "async:N" derived from its @input n. snapshot:true → its post-init state is
// serialized into the props bridge for the client.
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

Deno.test("BUG AB: two static wrappers around the same island each get THEIR OWN resolved scope", async () => {
  const aIsl = await makeIsland();
  const uCard: ComponentDef = { selector: "u-card", template: await parseTemplate(`<div><a-isl [n]="n"></a-isl></div>`), scope: "ucard" };
  const registry = await registryWith(aIsl, uCard);
  const page = await parseTemplate(`<u-card [n]="1"></u-card><u-card [n]="2"></u-card>`);
  const base = { scope: {} as Scope, registry, source: page.text };

  const resolved = new Map<string, Scope>();
  await resolveIslands(named(page), base, resolved);
  // each <u-card> instance carries a DISTINCT a-isl scope — not one collapsed key
  assert(resolved.size === 2, `both instances pre-resolved under distinct keys, got ${resolved.size}`);

  const html = renderNodes(named(page), { ...base, resolved });

  // BOTH cards must render their own awaited scope (n=1 → async:1, n=2 → async:2).
  assertStringIncludes(html, ">async:1<", "the n=1 card must render its OWN awaited scope");
  assertStringIncludes(html, ">async:2<", "the n=2 card must render its OWN awaited scope");
  assert(!html.includes(">sync:1<") && !html.includes(">sync:2<"), "neither island falls back to the stale sync scope");

  // and the n=1 card's hydration __snapshot must carry n=1 state, NOT n=2 (no cross-instance leak).
  const expected1 = islandHost("aisl", "a-isl", "load", { n: 1, __snapshot: { label: "async:1" } }, "");
  const snap1 = expected1.match(/<script[^>]*class="sprig-props">(.*?)<\/script>/)![1];
  assertStringIncludes(html, snap1, "the n=1 island snapshot must be {label:async:1} (no n=2 leak)");
});

Deno.test("BUG AB control: two DIRECTLY-embedded islands already resolve independently", async () => {
  const aIsl = await makeIsland();
  const registry = await registryWith(aIsl);
  const page = await parseTemplate(`<div><a-isl [n]="1"></a-isl><a-isl [n]="2"></a-isl></div>`);
  const base = { scope: {} as Scope, registry, source: page.text };

  const resolved = new Map<string, Scope>();
  await resolveIslands(named(page), base, resolved);
  const html = renderNodes(named(page), { ...base, resolved });

  assertStringIncludes(html, ">async:1<", "first directly-embedded island resolves (control)");
  assertStringIncludes(html, ">async:2<", "second directly-embedded island resolves (control)");
});
