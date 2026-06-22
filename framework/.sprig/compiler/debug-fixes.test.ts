// Regression locks for bugs found by the adversarial debug sweep (each fails without
// its fix; the skeptic reproduced the failing state).
import { assert, assertEquals } from "jsr:@std/assert";
import { named, parseTemplate } from "./parse.ts";
import { clearStaticCache, renderNodes } from "./render.ts";
import { snapshotOf } from "./lifecycle.ts";

const snapOf = (html: string) => {
  const m = html.match(/class="sprig-props">([^<]*)</);
  return JSON.parse(m![1]).__snapshot;
};

Deno.test("bug: @let template-locals must NOT leak into the island snapshot", async () => {
  // deno-lint-ignore no-explicit-any
  const island: any = {
    selector: "iz",
    scope: "s",
    template: await parseTemplate(`<p>@let doubled = count * 2;\n{{ doubled }}</p>`),
    island: { scope: () => ({ count: 3 }), trigger: "load", snapshot: true },
  };
  const root = await parseTemplate(`<div><iz></iz></div>`);
  const html = renderNodes(named(root), { scope: {}, registry: { get: (s: string) => (s === "iz" ? island : undefined) }, source: root.text });
  assert(/>\s*6\s*</.test(html), "body still renders the @let value (6)");
  assertEquals(snapOf(html), { count: 3 }, "snapshot has the instance field, NOT the @let local `doubled`");
});

Deno.test("bug: static cache key includes the scope marker (no page-local collision)", async () => {
  clearStaticCache();
  // deno-lint-ignore no-explicit-any
  const cardA: any = { selector: "card", scope: "sA", template: await parseTemplate(`<div class="card">{{ t }}</div>`) };
  // deno-lint-ignore no-explicit-any
  const cardB: any = { selector: "card", scope: "sB", template: await parseTemplate(`<div class="card">{{ t }}</div>`) };
  const rootA = await parseTemplate(`<card [t]="x"></card>`);
  const rootB = await parseTemplate(`<card [t]="x"></card>`);
  const htmlA = renderNodes(named(rootA), { scope: { x: "foo" }, registry: { get: () => cardA }, source: rootA.text });
  const htmlB = renderNodes(named(rootB), { scope: { x: "foo" }, registry: { get: () => cardB }, source: rootB.text });
  assert(htmlA.includes("sA"), "page-A card carries marker sA");
  assert(htmlB.includes("sB"), "page-B card carries ITS OWN marker sB");
  assert(!htmlB.includes("sA"), "page-B must NOT receive page-A's cached HTML (sA)");
});

Deno.test("bug: non-finite numbers are dropped from the snapshot, not null-ified", () => {
  assertEquals(
    snapshotOf({ a: NaN, b: Infinity, c: -Infinity, ok: 42, s: "x", z: 0 }),
    { ok: 42, s: "x", z: 0 },
    "NaN/±Infinity excluded (they'd become null over JSON); finite values incl. 0 kept",
  );
});

Deno.test("bug: a static component embedding <router-outlet> is NOT cached", async () => {
  clearStaticCache();
  // deno-lint-ignore no-explicit-any
  const frame: any = { selector: "x-frame", scope: "sf", template: await parseTemplate(`<div class="frame"><router-outlet></router-outlet></div>`) };
  const registry = { get: (s: string) => (s === "x-frame" ? frame : undefined) };
  const root = await parseTemplate(`<x-frame></x-frame>`);
  const a = renderNodes(named(root), { scope: {}, registry, source: root.text, outlet: "PAGE_A" });
  const b = renderNodes(named(root), { scope: {}, registry, source: root.text, outlet: "PAGE_B" });
  assert(a.includes("PAGE_A"), "first render shows its outlet");
  assert(b.includes("PAGE_B") && !b.includes("PAGE_A"), "second render must NOT serve the first's cached outlet");
});
