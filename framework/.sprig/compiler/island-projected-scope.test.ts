// BUG AF: an island passed as PROJECTED (slotted) content into a component —
// e.g. <u-card><a-isl [n]="7"></a-isl></u-card> where u-card has <ng-content> — is NEVER
// pre-resolved by the async pre-pass resolveIslands. Its component branch recurses ONLY
// into named(comp.template) (the wrapper's own template), never into the call-site
// projected children (tagInfo(N).children). So a class island whose async resolve()
// fetches data renders with its STALE synchronous scope() at SSR (the resolved lookup
// misses), and the hydration __snapshot carries the stale state. The directly-embedded
// (BUG H control) and nested-in-template (BUG H) cases already work.
//
// FIX: when resolveIslands descends into a component at call-site node N, ALSO pre-resolve
// the call-site projected children — at the SAME path/scope the render uses. render renders
// projected nodes in the PARENT scope (projected.scope) but at the WRAPPER body path
// (resolvedPath = rkey(P, N), since <ng-content>/renderContent spreads the wrapper-body
// opts). So call resolveIslands(tagInfo(N).children, { ...opts /* keep PARENT scope */,
// resolvedPath: rkey(opts.resolvedPath, N) }, resolved) for BOTH the resolve-island and
// static-component component branches.
import { assert, assertStringIncludes } from "jsr:@std/assert";
import { named, parseTemplate } from "./parse.ts";
import { islandHost, renderNodes, resolveIslands, type ComponentDef } from "./render.ts";
import type { Scope } from "./expr.ts";

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

// a-isl: a CLASS island — sync scope() returns "sync:N"; async resolve() awaits a "fetch"
// and returns "async:N" derived from its @input n. snapshot:true.
async function makeIsland(): Promise<ComponentDef> {
  return {
    selector: "a-isl",
    template: await parseTemplate(`<span>{{ label }}</span>`),
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

function registryWith(...defs: ComponentDef[]) {
  const map: Record<string, ComponentDef> = {};
  for (const d of defs) map[d.selector] = d;
  return { get: (s: string) => map[s] };
}

Deno.test("BUG AF: an island PROJECTED into a static wrapper uses its awaited (resolved) scope", async () => {
  const aIsl = await makeIsland();
  const uCard: ComponentDef = {
    selector: "u-card",
    template: await parseTemplate(`<div class="card"><ng-content></ng-content></div>`),
    scope: "ucard",
  };
  const registry = registryWith(aIsl, uCard);
  const page = await parseTemplate(`<u-card><a-isl [n]="7"></a-isl></u-card>`);
  const base = { scope: {} as Scope, registry, source: page.text };

  const resolved = new Map<string, Scope>();
  await resolveIslands(named(page), base, resolved);
  const html = renderNodes(named(page), { ...base, resolved });

  assertStringIncludes(html, ">async:7<", "the projected island must render its awaited resolved scope");
  assert(!html.includes(">sync:7<"), "the projected island must NOT fall back to the stale sync scope");

  // and its hydration __snapshot must carry the async state, not the stale sync one.
  const expected = islandHost("aisl", "a-isl", "load", { n: 7, __snapshot: { label: "async:7" } }, "");
  const snap = expected.match(/<script[^>]*class="sprig-props">(.*?)<\/script>/)![1];
  assertStringIncludes(html, snap, "the projected island snapshot must be {label:async:7}");
});

Deno.test("BUG AF control: an island PROJECTED into an ISLAND wrapper also resolves", async () => {
  const aIsl = await makeIsland();
  // wrapper is itself a class island (its own resolve), with <ng-content>
  const wIsl: ComponentDef = {
    selector: "w-isl",
    template: await parseTemplate(`<div class="wrap"><ng-content></ng-content></div>`),
    scope: "wisl",
    island: {
      scope: () => ({}),
      trigger: "load",
      snapshot: true,
      resolve: async () => {
        await sleep(5);
        return {};
      },
    },
  };
  const registry = registryWith(aIsl, wIsl);
  const page = await parseTemplate(`<w-isl><a-isl [n]="9"></a-isl></w-isl>`);
  const base = { scope: {} as Scope, registry, source: page.text };

  const resolved = new Map<string, Scope>();
  await resolveIslands(named(page), base, resolved);
  const html = renderNodes(named(page), { ...base, resolved });

  assertStringIncludes(html, ">async:9<", "a projected island under an island wrapper resolves too");
  assert(!html.includes(">sync:9<"), "no fallback to the stale sync scope");
});
