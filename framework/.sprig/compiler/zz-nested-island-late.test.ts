// ISOLATE BUG 1 — a DATA-DRIVEN nested island (one that first appears in a parent island's
// CLIENT re-render, never in the SSR HTML) stayed permanently inert.
//
// Two composing causes, each fixed + tested here:
//  (1) RENDER-SIDE: componentsForPage only consulted the LOADED-island registry, so a child
//      island whose chunk never loaded (it wasn't in the SSR HTML → never armed → never
//      imported) resolved to undefined → fell through to NATIVE rendering → a bare, empty
//      custom element (measured in the field: 54 bare <chip-editor>, 0 island hosts).
//      FIX: the eager loader registers EVERY island selector (registerIslandSelectors), and
//      componentsForPage resolves a known-but-unloaded island to a shell-emitting island def.
//      The shell now also CARRIES the parent-computed inputs as its props bridge — a child
//      with a live host has the shell discarded by the morph (live host wins, state kept),
//      but a genuinely-new child hydrates from these props.
//  (2) HYDRATE-SIDE: islands were scanned exactly once, at bootstrap. A shell appended by a
//      later morph was never armed, so its chunk never loaded. FIX: rescanIslands() after
//      each island effect render arms not-yet-armed hosts (idempotent — armed/hydrated
//      hosts are skipped by scheduleLoad).
import { assert, assertEquals, assertStringIncludes } from "jsr:@std/assert";
import { DOMParser } from "jsr:@b-fuze/deno-dom";
import { named, parseTemplate } from "./parse.ts";
import { renderNodes, type Handler } from "./render.ts";
import { bootstrapIslands, componentsForPage, loading, patchInnerHtml, registerIslandSelectors, rescanIslands } from "./hydrate.ts";
import type { Scope } from "./expr.ts";

/** Wait for a selector's in-flight chunk import to settle (it rejects in tests — no server —
 *  and loadIsland's catch clears `loading`), so the async op never leaks past the test. */
async function settleLoad(sel: string): Promise<void> {
  for (let i = 0; i < 100 && loading.has(sel); i++) {
    await new Promise((r) => setTimeout(r, 10));
  }
}

Deno.test("ISOLATE BUG 1 (render): an UNLOADED child island resolves to a <sprig-island> shell CARRYING the parent-computed props", async () => {
  const doc = new DOMParser().parseFromString(`<html><body></body></html>`, "text/html")!;
  // deno-lint-ignore no-explicit-any
  Object.defineProperty(globalThis, "document", { configurable: true, value: doc });
  try {
    // The eager loader registers every island selector the build produced — including ones
    // whose chunk hasn't loaded (this one never will in this test).
    registerIslandSelectors({ "late-chip-a": "chipscope" });

    const parentTpl = await parseTemplate(`<div><late-chip-a [n]="count"></late-chip-a></div>`);
    const handlers: Handler[] = []; // CLIENT mode
    const html = renderNodes(named(parentTpl), {
      scope: { count: 7 } as Scope,
      registry: componentsForPage(null),
      source: parentTpl.text,
      handlers,
      scopeAttr: "aisl",
    });

    console.log("CLIENT re-render output:\n" + html);

    assertStringIncludes(html, `<sprig-island`, "unloaded child island must emit a hydration boundary");
    assertStringIncludes(html, `data-sel="late-chip-a"`, "boundary carries the child selector");
    assertStringIncludes(html, `chipscope`, "boundary carries the island's registered scope marker");
    assertStringIncludes(html, `"n":7`, "shell props bridge carries the parent-computed inputs");
    assert(!/<late-chip-a[\s>]/.test(html), "must NOT fall through to a bare custom element");
  } finally {
    // deno-lint-ignore no-explicit-any
    delete (globalThis as any).document;
  }
});

Deno.test("ISOLATE BUG 1 (hydrate): rescanIslands arms island hosts that appear AFTER the bootstrap scan", async () => {
  const doc = new DOMParser().parseFromString(
    `<html><body><div id="stage"></div></body></html>`,
    "text/html",
  )!;
  // deno-lint-ignore no-explicit-any
  Object.defineProperty(globalThis, "document", { configurable: true, value: doc });
  try {
    // bootstrap with NO islands present — the one-shot scan sees nothing.
    bootstrapIslands({ base: "", v: "t" }, doc.body as unknown as ParentNode);

    // a later re-render lands a new island shell (what the morph appendChild's).
    const stage = doc.getElementById("stage")! as unknown as HTMLElement;
    stage.innerHTML = `<sprig-island data-sel="late-chip-b" data-trigger="load"></sprig-island>`;
    const host = stage.querySelector("sprig-island")! as unknown as HTMLElement;
    assertEquals(host.getAttribute("data-sprig-armed"), null, "not armed by the (already-run) bootstrap scan");

    rescanIslands(stage as unknown as ParentNode);

    assertEquals(host.getAttribute("data-sprig-armed"), "1", "the late host is armed by the re-scan");
    await settleLoad("late-chip-b"); // chunk import rejects (no server) — must be caught + cleared
    assert(!loading.has("late-chip-b"), "failed chunk load is cleared (retryable)");
  } finally {
    // deno-lint-ignore no-explicit-any
    delete (globalThis as any).document;
  }
});

Deno.test("ISOLATE BUG 1 (morph + rescan): a data-grown child list keeps the live host AND arms only the NEW shell", async () => {
  // live DOM: the parent island with ONE hydrated child; the re-render (data grew 1 → 2)
  // emits TWO shells. The live host must survive untouched; the extra shell must be
  // appended and then armed by the re-scan — the full late-island pipeline.
  const html = `<html><body>` +
    `<sprig-island data-sel="parent-a" data-trigger="load">` +
    `<div aisl>` +
    `<sprig-island chipscope data-sel="late-chip-c" data-trigger="load" data-sprig-hydrated="1" id="liveChild">` +
    `<script class="sprig-props" type="application/json">{"n":1}</script><span chipscope>1</span>` +
    `</sprig-island>` +
    `</div>` +
    `</sprig-island>` +
    `</body></html>`;
  const doc = new DOMParser().parseFromString(html, "text/html")!;
  // deno-lint-ignore no-explicit-any
  Object.defineProperty(globalThis, "document", { configurable: true, value: doc });
  try {
    bootstrapIslands({ base: "", v: "t" }, doc.body as unknown as ParentNode);
    await settleLoad("late-chip-c"); // the hydrated marker skips it, but parent-a's arm fires a load attempt
    await settleLoad("parent-a");
    const parentHost = doc.querySelector(`sprig-island[data-sel="parent-a"]`)! as unknown as HTMLElement;
    const liveBefore = doc.getElementById("liveChild");
    // deno-lint-ignore no-explicit-any
    (liveBefore as any).__sprigScope = { hydrated: true };

    // what the parent's effect renders after its data grew: two shells, each with props.
    const reRender = `<div aisl>` +
      `<sprig-island chipscope data-sel="late-chip-c" data-trigger="load"><script type="application/json" class="sprig-props">{"n":1}</script></sprig-island>` +
      `<sprig-island chipscope data-sel="late-chip-c" data-trigger="load"><script type="application/json" class="sprig-props">{"n":2}</script></sprig-island>` +
      `</div>`;
    patchInnerHtml(parentHost, reRender);
    rescanIslands(parentHost as unknown as ParentNode); // what hydrateIsland's effect now does post-render

    const hosts = doc.querySelectorAll(`sprig-island[data-sel="late-chip-c"]`);
    assertEquals(hosts.length, 2, "the NEW shell is appended alongside the live host");
    const liveAfter = doc.getElementById("liveChild")! as unknown as HTMLElement;
    // deno-lint-ignore no-explicit-any
    assertEquals((liveAfter as any).__sprigScope?.hydrated, true, "live host survives with identity intact");
    assertEquals(liveAfter.getAttribute("data-sprig-armed"), null, "hydrated host is NOT re-armed");
    const fresh = [...hosts].find((h) => (h as unknown as HTMLElement).id !== "liveChild")! as unknown as HTMLElement;
    assertEquals(fresh.getAttribute("data-sprig-hydrated"), null, "the new shell is not yet hydrated");
    assertEquals(fresh.getAttribute("data-sprig-armed"), "1", "the new shell IS armed by the re-scan");
    assertStringIncludes(
      (fresh as unknown as { innerHTML: string }).innerHTML,
      `"n":2`,
      "the new shell kept its props bridge (what it will hydrate from)",
    );
    await settleLoad("late-chip-c");
  } finally {
    // deno-lint-ignore no-explicit-any
    delete (globalThis as any).document;
  }
});
