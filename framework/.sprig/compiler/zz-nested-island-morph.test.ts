// REGRESSION (bug AJ, was CANDIDATE #5): drive the ACTUAL patchInnerHtml/morph against a real
// DOM. The OLD DOM at the child's position is the SSR'd (already-hydrated)
// <sprig-island data-sel="counter-badge">. Before the fix, the parent re-render emitted a bare
// <counter-badge>; sameNode compared tagName (SPRIG-ISLAND vs COUNTER-BADGE) → false →
// morphChildren replaceChild'd the hydrated host away (destroying its listeners/effect/state).
// After the fix, morphChildren treats a re-rendered child-island element as the live host and
// leaves the hydrated subtree UNTOUCHED — even against a (fallback) bare custom element.
import { assertEquals } from "jsr:@std/assert";
import { DOMParser } from "jsr:@b-fuze/deno-dom";
import { patchInnerHtml } from "./hydrate.ts";

Deno.test("REGRESSION: morph PRESERVES the hydrated nested-island host even when the re-render emits a bare custom element", () => {
  // The parent island host, as it exists in the live DOM AFTER SSR + child hydration.
  // The child <sprig-island data-sel="counter-badge"> has been hydrated: it carries a
  // data-sprig-hydrated marker and we stash an identity tag + a fake "scope" on the node
  // so we can detect whether the SAME node survives the morph or is replaced.
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
    // tag the hydrated child host with a unique identity object so we can prove node identity.
    // deno-lint-ignore no-explicit-any
    (childBefore as any).__sprigScope = { iAmTheHydratedChild: true };

    // The worst-case (fallback) re-render shape: a bare <counter-badge> (e.g. a chunk that
    // didn't get the island-aware registry). Even this must NOT destroy the hydrated host.
    const reRenderHtml = `<div aisl><counter-badge aisl n="3"></counter-badge></div>`;

    patchInnerHtml(parentHost, reRenderHtml);

    // After the morph: the original hydrated <sprig-island> child must be PRESERVED (same
    // node identity, its hydration marker + body intact), NOT replaced by a fresh element.
    const childAfter = doc.getElementById("theChild");
    const stillSprigIsland = !!doc.querySelector(
      `sprig-island[data-sel="parent-a"] sprig-island[data-sel="counter-badge"]`,
    );
    const nowBareBadge = !!doc.querySelector(
      `sprig-island[data-sel="parent-a"] counter-badge`,
    );

    console.log("child node survived (by id):", !!childAfter);
    console.log("still a hydrated <sprig-island data-sel=counter-badge>:", stillSprigIsland);
    console.log("replaced by a bare <counter-badge>:", nowBareBadge);
    console.log("parent innerHTML after morph:\n" + (parentHost as unknown as { innerHTML: string }).innerHTML);

    // The fix: the hydrated host SURVIVES (same node, marker + scope intact).
    assertEquals(childAfter !== null, true, "the hydrated <sprig-island> child host survives the morph");
    assertEquals(stillSprigIsland, true, "the <sprig-island data-sel=counter-badge> host is preserved");
    assertEquals(nowBareBadge, false, "it was NOT replaced by a fresh, un-hydrated <counter-badge>");
    // deno-lint-ignore no-explicit-any
    assertEquals((childAfter as any).__sprigScope?.iAmTheHydratedChild, true, "same node identity preserved");
    assertEquals(childAfter!.getAttribute("data-sprig-hydrated"), "1", "hydration marker intact");
  } finally {
    // deno-lint-ignore no-explicit-any
    delete (globalThis as any).document;
  }
});
