// REGRESSION (bug AJ, was CANDIDATE #5): nested island must NOT be destroyed on the parent's
// client re-render. The root cause was that hydrateIsland's effect (hydrate.ts) renders with
// `registry = componentsForPage(page)`, which was a STATICS-ONLY registry (islands self-register
// into a SEPARATE map render.ts never queried). So a nested-island tag inside the parent island
// body resolved to undefined → fell through to native rendering → a bare <counter-badge>.
// The fix makes componentsForPage ISLAND-AWARE: a child island resolves to an island ComponentDef
// and renderComponent's CLIENT branch emits a <sprig-island data-sel> SHELL (matching the live
// host) instead of a bare custom element.
import { assertStringIncludes, assert } from "jsr:@std/assert";
import { DOMParser } from "jsr:@b-fuze/deno-dom";
import { named, parseTemplate } from "./parse.ts";
import { renderNodes, type ComponentDef, type Handler } from "./render.ts";
import { componentsForPage, registerIsland, type IslandEntry } from "./hydrate.ts";
import { serialize } from "./serialize.ts";
import type { Scope } from "./expr.ts";

function staticsOnlyRegistry(...defs: ComponentDef[]) {
  const map: Record<string, ComponentDef> = {};
  for (const d of defs) map[d.selector] = d;
  return { get: (s: string) => map[s] };
}

Deno.test("REGRESSION: parent island re-render emits a nested island as a <sprig-island> boundary (via the island-aware componentsForPage)", async () => {
  // an (empty) document so registerIsland's hydratePending DOM scan is a harmless no-op.
  const doc = new DOMParser().parseFromString(`<html><body></body></html>`, "text/html")!;
  // deno-lint-ignore no-explicit-any
  Object.defineProperty(globalThis, "document", { configurable: true, value: doc });
  try {
    // The child island self-registers into the island registry, exactly as its chunk would.
    const childEntry: IslandEntry = {
      setup: () => ({}),
      template: serialize(await parseTemplate(`<span>{{ n }}</span>`)),
      scope: "badge",
    };
    registerIsland("counter-badge", childEntry);

    // Parent island A's template contains a child island <counter-badge>.
    const parentTpl = await parseTemplate(`<div><counter-badge [n]="count"></counter-badge></div>`);

    // The REAL client re-render registry — now island-aware: it consults the island registry,
    // so the child resolves to an island def instead of undefined.
    const registry = componentsForPage(null);

    // CLIENT mode: handlers present (the effect passes `handlers: hs`).
    const handlers: Handler[] = [];
    const html = renderNodes(named(parentTpl), {
      scope: { count: 3 } as Scope,
      registry,
      source: parentTpl.text,
      handlers,
      scopeAttr: "aisl",
    });

    console.log("CLIENT re-render output:\n" + html);

    // The child island is emitted as a <sprig-island data-sel="counter-badge"> SHELL the morph
    // matches to the live hydrated host — NOT a bare <counter-badge> that morph would destroy.
    assertStringIncludes(html, "<sprig-island", "child island emitted as a hydration boundary");
    assertStringIncludes(html, `data-sel="counter-badge"`, "boundary carries the child selector");
    assert(!/<counter-badge[\s>]/.test(html), "child island must NOT fall through to a bare custom element");
  } finally {
    // deno-lint-ignore no-explicit-any
    delete (globalThis as any).document;
  }
});

Deno.test("CONTROL: the SAME template on the SERVER (island IN registry) emits a sprig-island boundary", async () => {
  const parentTpl = await parseTemplate(`<div><counter-badge [n]="count"></counter-badge></div>`);
  const badge: ComponentDef = {
    selector: "counter-badge",
    template: await parseTemplate(`<span>{{ n }}</span>`),
    scope: "badge",
    island: { scope: (i: Scope) => ({ n: i.n }), trigger: "load" },
  };
  const registry = staticsOnlyRegistry(badge); // here the island IS resolvable
  // SERVER mode: NO handlers → renderComponent wraps the island as a hydration boundary.
  const html = renderNodes(named(parentTpl), {
    scope: { count: 3 } as Scope,
    registry,
    source: parentTpl.text,
  });
  console.log("SERVER output:\n" + html);
  assertStringIncludes(html, `<sprig-island`, "server emits the hydration boundary");
  assertStringIncludes(html, `data-sel="counter-badge"`, "boundary carries the child selector");
});
