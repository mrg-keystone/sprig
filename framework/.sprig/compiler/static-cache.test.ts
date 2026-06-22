// Phase 7: leaf static components are memoized by (selector + inputs) on the server —
// proven correct (hits reuse identical output; distinct inputs miss; projected content
// and the client path are never cached).
import { assert, assertEquals } from "jsr:@std/assert";
import { named, parseTemplate } from "./parse.ts";
import { clearStaticCache, renderNodes, staticCacheStats } from "./render.ts";

// deno-lint-ignore no-explicit-any
async function staticDef(selector: string, src: string): Promise<any> {
  return { selector, template: await parseTemplate(src), scope: "sc" };
}

Deno.test("two identical leaf static components → one render + one cache hit", async () => {
  clearStaticCache();
  const card = await staticDef("x-card", `<div class="card">{{ title }}</div>`);
  const registry = { get: (s: string) => (s === "x-card" ? card : undefined) };
  const root = await parseTemplate(`<section><x-card [title]="a"></x-card><x-card [title]="a"></x-card></section>`);
  const html = renderNodes(named(root), { scope: { a: "Hello" }, registry, source: root.text });
  assertEquals(staticCacheStats().hits, 1, "the second identical card was a cache hit");
  assertEquals(html.split("Hello").length - 1, 2, "both cards present (cached HTML reused)");
});

Deno.test("distinct inputs miss the cache (no stale output)", async () => {
  clearStaticCache();
  const card = await staticDef("x-card", `<div>{{ title }}</div>`);
  const registry = { get: (s: string) => (s === "x-card" ? card : undefined) };
  const root = await parseTemplate(`<section><x-card [title]="a"></x-card><x-card [title]="b"></x-card></section>`);
  const html = renderNodes(named(root), { scope: { a: "A", b: "B" }, registry, source: root.text });
  assertEquals(staticCacheStats().hits, 0, "distinct inputs → no hit");
  assertEquals(staticCacheStats().size, 2, "two distinct entries cached");
  assert(html.includes(">A<") && html.includes(">B<"), "each renders its OWN value, not a stale one");
});

Deno.test("components with projected children are NOT cached", async () => {
  clearStaticCache();
  const box = await staticDef("x-box", `<div class="box"><ng-content></ng-content></div>`);
  const registry = { get: (s: string) => (s === "x-box" ? box : undefined) };
  const root = await parseTemplate(`<div><x-box>one</x-box><x-box>two</x-box></div>`);
  const html = renderNodes(named(root), { scope: {}, registry, source: root.text });
  assertEquals(staticCacheStats().hits, 0, "projected content varies → never cached");
  assert(html.includes("one") && html.includes("two"), "each box keeps its own projected content");
});

Deno.test("the CLIENT path (handlers present) is never cached", async () => {
  clearStaticCache();
  const card = await staticDef("x-card", `<div>{{ title }}</div>`);
  const registry = { get: (s: string) => (s === "x-card" ? card : undefined) };
  const root = await parseTemplate(`<x-card [title]="a"></x-card><x-card [title]="a"></x-card>`);
  renderNodes(named(root), { scope: { a: "X" }, registry, source: root.text, handlers: [] });
  assertEquals(staticCacheStats().size, 0, "client re-render must not populate the SSR cache");
});
