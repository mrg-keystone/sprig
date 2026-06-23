// BUG AJ (HIGH) — a nested island (composed inside ANOTHER island's template) is
// DESTROYED on the client when the parent island re-renders.
//
// SSR is correct: renderComponent emits each child island as a <sprig-island data-sel>
// hydration boundary. But the parent island's CLIENT re-render (hydrateIsland's effect →
// renderNodes with registry = componentsForPage(page)) used a STATICS-ONLY registry
// (islands self-register into a SEPARATE `registry` Map render.ts never queried). So a
// child-island tag resolved to undefined → fell through to NATIVE rendering → emitted a
// bare <child-island> instead of a <sprig-island> boundary. Then patchInnerHtml/morph
// compared the OLD hydrated <sprig-island> host (tagName SPRIG-ISLAND) against the NEW bare
// <child-island> (different tagName) → sameNode false → replaceChild DESTROYED the hydrated
// child host (its listeners, mounted entry, effect) and replaced it with a fresh, un-
// hydrated custom element → orphaned effect leak / lost state.
//
// FIX (two complementary parts, both tested here):
//  (1) RENDER-SIDE: make the parent re-render registry island-aware (consult the island
//      `registry`), and in CLIENT mode emit a <sprig-island data-sel=child …> SHELL for a
//      child island (the child owns + manages its own subtree), NOT the child's inlined body.
//  (2) MORPH-SIDE: morph treats a re-rendered child-island element as MATCHING the live
//      <sprig-island data-sel> host and leaves the hydrated child subtree UNTOUCHED.
import { assertStringIncludes, assertEquals, assert } from "jsr:@std/assert";
import { DOMParser } from "jsr:@b-fuze/deno-dom";
import { named, parseTemplate } from "./parse.ts";
import { renderNodes, type ComponentDef, type Handler } from "./render.ts";
import { patchInnerHtml, componentsForPage, registerIsland, type IslandEntry } from "./hydrate.ts";
import { serialize } from "./serialize.ts";
import type { Scope } from "./expr.ts";

Deno.test("FIX AJ (1): parent island CLIENT re-render emits a child island as a <sprig-island> boundary (NOT a bare custom element)", async () => {
  // an (empty) document so registerIsland's hydratePending DOM scan is a harmless no-op.
  const doc = new DOMParser().parseFromString(`<html><body></body></html>`, "text/html")!;
  // deno-lint-ignore no-explicit-any
  Object.defineProperty(globalThis, "document", { configurable: true, value: doc });
  try {
    // Register the child island into the island registry exactly as its chunk would.
    const childTpl = serialize(await parseTemplate(`<span>{{ n }}</span>`));
    const childEntry: IslandEntry = { setup: () => ({}), template: childTpl, scope: "badge" };
    registerIsland("counter-badge", childEntry);

    // Parent island A's template contains the child island <counter-badge>.
    const parentTpl = await parseTemplate(`<div><counter-badge [n]="count"></counter-badge></div>`);

    // The client re-render registry is componentsForPage(page) — which after the fix is
    // island-aware (it also consults the island `registry`).
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

    // The child island must be emitted as a <sprig-island data-sel="counter-badge"> SHELL so
    // morph matches it to the live hydrated host (and bootstrapIslands can lazy-load it if not
    // yet loaded). It must NOT be a bare <counter-badge> custom element.
    assertStringIncludes(html, `<sprig-island`, "child island must be emitted as a hydration boundary");
    assertStringIncludes(html, `data-sel="counter-badge"`, "boundary carries the child selector");
    assert(!/<counter-badge[\s>]/.test(html), "child island must NOT fall through to a bare custom element");
  } finally {
    // deno-lint-ignore no-explicit-any
    delete (globalThis as any).document;
  }
});

Deno.test("FIX AJ (2): morph PRESERVES the hydrated nested-island host across the parent's re-render", () => {
  // The parent island host, as it exists in the live DOM AFTER SSR + child hydration. The
  // child <sprig-island data-sel="counter-badge"> has been hydrated (data-sprig-hydrated +
  // an inner body). We stash an identity object on the node to prove the SAME node survives.
  const html =
    `<html><body>` +
    `<sprig-island data-sel="parent-a" data-trigger="load">` +
      `<div aisl>` +
        `<sprig-island badge data-sel="counter-badge" data-trigger="load" data-sprig-hydrated="1" id="theChild">` +
          `<script class="sprig-props" type="application/json">{"n":3}</script>` +
          `<span badge>3</span>` +
        `</sprig-island>` +
      `</div>` +
    `</sprig-island>` +
    `</body></html>`;
  const doc = new DOMParser().parseFromString(html, "text/html")!;
  // deno-lint-ignore no-explicit-any
  Object.defineProperty(globalThis, "document", { configurable: true, value: doc });

  try {
    const parentHost = doc.querySelector(`sprig-island[data-sel="parent-a"]`)! as unknown as HTMLElement;
    const childBefore = doc.getElementById("theChild");
    // deno-lint-ignore no-explicit-any
    (childBefore as any).__sprigScope = { iAmTheHydratedChild: true };

    // What the parent's effect renders on a re-run AFTER the fix: the child island is emitted
    // as a <sprig-island data-sel="counter-badge"> SHELL (no inner body — the child owns it).
    const reRenderHtml =
      `<div aisl><sprig-island aisl data-sel="counter-badge" data-trigger="load"></sprig-island></div>`;

    patchInnerHtml(parentHost, reRenderHtml);

    const childAfter = doc.getElementById("theChild");
    const stillSprigIsland = !!doc.querySelector(
      `sprig-island[data-sel="parent-a"] sprig-island[data-sel="counter-badge"]`,
    );
    const nowBareBadge = !!doc.querySelector(
      `sprig-island[data-sel="parent-a"] counter-badge`,
    );

    console.log("child node survived (by id):", !!childAfter);
    console.log("still a hydrated <sprig-island data-sel=counter-badge>:", stillSprigIsland);
    console.log("parent innerHTML after morph:\n" + (parentHost as unknown as { innerHTML: string }).innerHTML);

    // The SAME hydrated host node must survive, keep its hydration marker, its inner body,
    // AND the identity object we stashed (its effect/listeners/scope live on it).
    assert(childAfter, "the hydrated <sprig-island> child host must survive the morph");
    assertEquals(stillSprigIsland, true, "the <sprig-island data-sel=counter-badge> host is preserved");
    assertEquals(nowBareBadge, false, "it was NOT replaced by a fresh, un-hydrated <counter-badge>");
    // deno-lint-ignore no-explicit-any
    assertEquals((childAfter as any).__sprigScope?.iAmTheHydratedChild, true, "same node identity (scope intact)");
    assertEquals(childAfter!.getAttribute("data-sprig-hydrated"), "1", "hydration marker intact");
    assert((childAfter as unknown as { innerHTML: string }).innerHTML.includes("3"), "child's hydrated body intact");
  } finally {
    // deno-lint-ignore no-explicit-any
    delete (globalThis as any).document;
  }
});

Deno.test("FIX AJ (2b): morph ALSO preserves the live host when the re-render emits a BARE child tag (defense-in-depth)", () => {
  // Belt-and-suspenders: even if a re-render ever produced a bare <counter-badge> (e.g. a
  // chunk that hasn't loaded an island-aware registry), the morph must still match it to the
  // live <sprig-island data-sel="counter-badge"> host and NOT destroy it.
  const html =
    `<html><body>` +
    `<sprig-island data-sel="parent-a" data-trigger="load">` +
      `<div aisl>` +
        `<sprig-island badge data-sel="counter-badge" data-trigger="load" data-sprig-hydrated="1" id="theChild">` +
          `<span badge>3</span>` +
        `</sprig-island>` +
      `</div>` +
    `</sprig-island>` +
    `</body></html>`;
  const doc = new DOMParser().parseFromString(html, "text/html")!;
  // deno-lint-ignore no-explicit-any
  Object.defineProperty(globalThis, "document", { configurable: true, value: doc });
  try {
    const parentHost = doc.querySelector(`sprig-island[data-sel="parent-a"]`)! as unknown as HTMLElement;
    const childBefore = doc.getElementById("theChild");
    // deno-lint-ignore no-explicit-any
    (childBefore as any).__sprigScope = { iAmTheHydratedChild: true };

    const reRenderHtml = `<div aisl><counter-badge aisl n="3"></counter-badge></div>`;
    patchInnerHtml(parentHost, reRenderHtml);

    const childAfter = doc.getElementById("theChild");
    assert(childAfter, "the hydrated host survives even against a bare child tag");
    // deno-lint-ignore no-explicit-any
    assertEquals((childAfter as any).__sprigScope?.iAmTheHydratedChild, true, "same node identity preserved");
  } finally {
    // deno-lint-ignore no-explicit-any
    delete (globalThis as any).document;
  }
});
