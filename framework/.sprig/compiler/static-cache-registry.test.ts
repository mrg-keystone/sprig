// BUG AA: the static-component memo cache key is (selector + childScope + inputs) and
// OMITS which registry resolved the component's NESTED child tags. A SHARED (global)
// static component that nests a child tag, which page A and page B each page-local-shadow
// with a DIFFERENT (but still pure) static component, renders differently per page yet
// caches under one key → page B is served page A's subtree (wrong child markup + scope).
//
// FIX: a component whose template references ANY non-native child COMPONENT tag is
// registry-dependent (its subtree depends on WHICH registry resolves that tag), so it is
// NOT a pure function of its inputs → it must not be cached. Only TRUE leaves (native
// elements + interpolation/bindings) stay cached.
import { assert, assertEquals } from "jsr:@std/assert";
import { named, parseTemplate } from "./parse.ts";
import { clearStaticCache, type ComponentDef, renderNodes, staticCacheStats } from "./render.ts";

async function staticDef(selector: string, src: string, scope: string): Promise<ComponentDef> {
  return { selector, template: await parseTemplate(src), scope } as ComponentDef;
}

Deno.test("BUG AA: a shared static wrapper nesting a child tag is registry-dependent → not cached across registries", async () => {
  clearStaticCache();
  // SHARED (global) static wrapper — ONE ComponentDef, rendered under two pages. It nests a
  // bare <card> tag whose resolution differs per page's registry.
  const widget = await staticDef("widget", `<div class="widget"><card></card></div>`, "sc-widget");

  // Page B shadows <card> with cardB (its own scope + text).
  const cardB = await staticDef("card", `<span class="card">B-CARD</span>`, "scB");
  const registryB = {
    get: (s: string) => (s === "widget" ? widget : s === "card" ? cardB : undefined),
  };
  const rootB = await parseTemplate(`<widget></widget>`);
  const htmlB = renderNodes(named(rootB), { scope: {}, registry: registryB, source: rootB.text });
  assert(htmlB.includes("B-CARD"), "page B renders its own card text");
  assert(htmlB.includes("scB"), "page B renders its own card scope marker");

  // Page C shadows <card> with cardC (different scope + text), SAME widget inputs (none).
  const cardC = await staticDef("card", `<span class="card">C-CARD</span>`, "scC");
  const registryC = {
    get: (s: string) => (s === "widget" ? widget : s === "card" ? cardC : undefined),
  };
  const rootC = await parseTemplate(`<widget></widget>`);
  const htmlC = renderNodes(named(rootC), { scope: {}, registry: registryC, source: rootC.text });

  // The buggy cache keys widget on (selector + childScope + inputs) only — identical across
  // pages — so page C is served page B's frozen subtree (B-CARD / scB).
  assert(htmlC.includes("C-CARD"), "page C MUST render its OWN card text C-CARD");
  assert(htmlC.includes("scC"), "page C MUST render its OWN card scope marker scC");
  assert(!htmlC.includes("B-CARD"), "page C must NOT replay page B's card text");
  assert(!htmlC.includes("scB"), "page C must NOT replay page B's card scope marker");
});

Deno.test("BUG AA regression: a TRUE leaf static (native elements only) STILL caches", async () => {
  clearStaticCache();
  // Leaf: only native elements + interpolation — a pure function of inputs → cacheable.
  const leaf = await staticDef("leaf", `<div>{{x}}</div>`, "sc-leaf");
  const registry = { get: (s: string) => (s === "leaf" ? leaf : undefined) };
  const root = await parseTemplate(`<section><leaf [x]="v"></leaf><leaf [x]="v"></leaf></section>`);
  const html = renderNodes(named(root), { scope: { v: "Hi" }, registry, source: root.text });
  assertEquals(staticCacheStats().hits, 1, "the second identical leaf was a cache hit — leaves still cache");
  assertEquals(html.split("Hi").length - 1, 2, "both leaves present (cached HTML reused)");
});
