// BUG Z + BUG AD: the static-component memo cache key in renderComponent is UNSOUND.
// (Z) JSON.stringify maps NaN, Infinity, -Infinity, and null ALL to the literal `null`,
//     so two instances whose same-named input differs only among these values COLLIDE on
//     one key and the 2nd replays the 1st HTML (cross-instance / cross-request, since
//     staticCache is module-global).
// (AD) JSON.stringify SILENTLY OMITS function-valued and undefined inputs (no throw), so
//      two different closures produce identical keys → cross-request stale/leak; the
//      existing try/catch ("non-serializable → don't cache") never fires.
import { assert, assertEquals } from "jsr:@std/assert";
import { named, parseTemplate } from "./parse.ts";
import { clearStaticCache, renderNodes, staticCacheStats } from "./render.ts";

// deno-lint-ignore no-explicit-any
async function staticDef(selector: string, src: string): Promise<any> {
  return { selector, template: await parseTemplate(src), scope: "sc" };
}

Deno.test("BUG Z: non-finite inputs (Infinity vs NaN) must NOT collide on one cache key", async () => {
  clearStaticCache();
  const leaf = await staticDef("x-leaf", `<div>{{ r }}</div>`);
  const registry = { get: (s: string) => (s === "x-leaf" ? leaf : undefined) };
  const root = await parseTemplate(`<section><x-leaf [r]="p"></x-leaf><x-leaf [r]="q"></x-leaf></section>`);
  const html = renderNodes(named(root), { scope: { p: Infinity, q: NaN }, registry, source: root.text });

  assert(html.includes(">Infinity<"), "first instance renders Infinity");
  assert(html.includes(">NaN<"), "second instance must render its OWN value (NaN), not replay 'Infinity'");
  assertEquals(staticCacheStats().hits, 0, "distinct non-finite inputs → no cache hit");
  assertEquals(staticCacheStats().size, 2, "two distinct cache entries (Infinity, NaN)");
});

Deno.test("BUG Z: a null-valued vs NaN-valued input must NOT collide", async () => {
  clearStaticCache();
  const leaf = await staticDef("x-leaf", `<div>[{{ r }}]</div>`);
  const registry = { get: (s: string) => (s === "x-leaf" ? leaf : undefined) };
  const root = await parseTemplate(`<section><x-leaf [r]="p"></x-leaf><x-leaf [r]="q"></x-leaf></section>`);
  const html = renderNodes(named(root), { scope: { p: null, q: NaN }, registry, source: root.text });

  assert(html.includes("[]"), "first (null) renders empty");
  assert(html.includes("[NaN]"), "second (NaN) must render NaN, not replay the null instance");
  assertEquals(staticCacheStats().hits, 0, "null vs NaN → no collision, no hit");
  assertEquals(staticCacheStats().size, 2, "two distinct entries (null, NaN)");
});

Deno.test("BUG AD: distinct function inputs must NOT collide (silent JSON omit)", async () => {
  clearStaticCache();
  const leaf = await staticDef("x-fmt", `<div>{{ fmt(0) }}</div>`);
  const registry = { get: (s: string) => (s === "x-fmt" ? leaf : undefined) };
  const root = await parseTemplate(`<section><x-fmt [fmt]="f1"></x-fmt><x-fmt [fmt]="f2"></x-fmt></section>`);
  const html = renderNodes(named(root), {
    scope: { f1: () => "A", f2: () => "B" },
    registry,
    source: root.text,
  });

  assert(html.includes(">A<"), "first instance renders A");
  assert(html.includes(">B<"), "second instance must render B (no cache replay of 'A')");
  assertEquals(staticCacheStats().hits, 0, "function inputs are unkeyable → refuse to cache, no hit");
});
