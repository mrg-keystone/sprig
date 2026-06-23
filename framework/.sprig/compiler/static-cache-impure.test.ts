// Regression tests for the static leaf-component HTML memo caching impure subtrees.
// BUG C: a static wrapper whose template NESTS a component containing <router-outlet>
//        is cached non-transitively → it replays an earlier request's outlet content.
// BUG D: a static wrapper whose template (transitively) contains an ISLAND is cached →
//        the island's per-request scope output is frozen and leaks across requests.
import { assert } from "jsr:@std/assert";
import { named, parseTemplate } from "./parse.ts";
import { clearStaticCache, type ComponentDef, renderNodes } from "./render.ts";

async function staticDef(selector: string, src: string): Promise<ComponentDef> {
  return { selector, template: await parseTemplate(src), scope: "sc-" + selector } as ComponentDef;
}

Deno.test("BUG C: a static wrapper nesting a <router-outlet> component must NOT be cached across outlets", async () => {
  clearStaticCache();
  // x-inner OWN template has the outlet (depth 1); x-wrap nests x-inner (depth 2) and has
  // no outlet in its own text, so the non-transitive check wrongly treats it as cacheable.
  const inner = await staticDef("x-inner", `<div><router-outlet></router-outlet></div>`);
  const wrap = await staticDef("x-wrap", `<section><x-inner></x-inner></section>`);
  const registry = {
    get: (s: string) => (s === "x-inner" ? inner : s === "x-wrap" ? wrap : undefined),
  };

  // Request 1: outlet = PAGE-A. (Do NOT clear the cache — the bug is cross-render reuse.)
  const root1 = await parseTemplate(`<x-wrap></x-wrap>`);
  const html1 = renderNodes(named(root1), { scope: {}, registry, source: root1.text, outlet: "PAGE-A" });
  assert(html1.includes("PAGE-A"), "request 1 should render its own outlet PAGE-A");

  // Request 2 (after navigation): outlet = PAGE-B. The wrapper's inputs are identical, so
  // the buggy cache replays request 1's HTML (PAGE-A) instead of rendering PAGE-B.
  const root2 = await parseTemplate(`<x-wrap></x-wrap>`);
  const html2 = renderNodes(named(root2), { scope: {}, registry, source: root2.text, outlet: "PAGE-B" });
  assert(html2.includes("PAGE-B"), "request 2 must render the NEW outlet PAGE-B, not a cached PAGE-A");
  assert(!html2.includes("PAGE-A"), "request 2 must not replay request 1's outlet content");
});

Deno.test("BUG D: a static wrapper containing an ISLAND must NOT freeze the island's per-request data", async () => {
  clearStaticCache();
  // request-varying island data, mutated between renders to model two distinct requests.
  let reqData = "DATA-1";
  const isl: ComponentDef = {
    selector: "a-isl",
    template: await parseTemplate(`<span>{{ msg }}</span>`),
    scope: "sc-a-isl",
    island: {
      scope: (_inputs) => ({ msg: reqData }),
      trigger: "load",
    },
  } as ComponentDef;
  // u-card is a STATIC wrapper whose template transitively contains the island.
  const card = await staticDef("u-card", `<div><a-isl></a-isl></div>`);
  const registry = {
    get: (s: string) => (s === "a-isl" ? isl : s === "u-card" ? card : undefined),
  };

  // Request 1: island data = DATA-1.
  const root1 = await parseTemplate(`<u-card></u-card>`);
  const html1 = renderNodes(named(root1), { scope: {}, registry, source: root1.text });
  assert(html1.includes("DATA-1"), "request 1 should show the island's request-1 data");

  // Request 2: island data changed to DATA-2 (same wrapper inputs). The buggy cache freezes
  // request 1's island output and replays DATA-1 → a cross-request data leak.
  reqData = "DATA-2";
  const root2 = await parseTemplate(`<u-card></u-card>`);
  const html2 = renderNodes(named(root2), { scope: {}, registry, source: root2.text });
  assert(html2.includes("DATA-2"), "request 2 must show the NEW island data DATA-2");
  assert(!html2.includes("DATA-1"), "request 2 must not leak request 1's island data");
});
