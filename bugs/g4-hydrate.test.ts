/// <reference lib="dom" />
// g4-hydrate — regression tests for the client hydration runtime
// (ui/.sprig/compiler/hydrate.ts). Most bugs are exercised at the smallest real seam:
// pure helpers (keyMatches, fetchAst, softNav* decision fns, runSoftNav with injected
// deps) and the live hydrate path over a real (linkedom) DOM for the focus-preservation,
// delegation, prop-bridge, effect-disposal, observer-cleanup and live-pruning bugs.
import { assert, assertEquals, assertRejects } from "@std/assert";
import { parseHTML } from "npm:linkedom@0.18";
import { parseTemplate } from "../ui/.sprig/compiler/parse.ts";
import { serialize, type SerializedTemplate } from "../ui/.sprig/compiler/serialize.ts";
import {
  fetchAst,
  hotTemplate,
  keyMatches,
  liveCount,
  loading,
  registerIsland,
  runSoftNav,
  type SoftNavDeps,
  softNavResponseOk,
  softNavScroll,
  softNavShouldSkip,
  type SprigConfig,
  teardownInside,
} from "../ui/.sprig/compiler/hydrate.ts";

// ───────────────────────────── test scaffolding ─────────────────────────────
const CFG: SprigConfig = { base: "/ui", v: "1" };

async function tpl(html: string): Promise<SerializedTemplate> {
  return serialize(await parseTemplate(html));
}

// Install a fresh linkedom DOM + the globals hydrate.ts reaches for. Returns the
// document and a restore fn.
function installDom(bodyHtml = "") {
  const { document, window } = parseHTML(`<!DOCTYPE html><html><body>${bodyHtml}</body></html>`);
  const saved: Record<string, unknown> = {};
  const g = globalThis as Record<string, unknown>;
  const set = (k: string, v: unknown) => {
    saved[k] = g[k];
    g[k] = v;
  };
  set("document", document);
  set("window", window);
  set("location", { origin: "http://localhost", href: "http://localhost/ui" });
  set("CSS", { escape: (s: string) => s.replace(/[^a-zA-Z0-9_-]/g, (c) => "\\" + c) });
  // a no-op IntersectionObserver we can spy on
  return {
    document,
    window,
    restore() {
      for (const k of Object.keys(saved)) g[k] = saved[k];
    },
  };
}

// ════════════════════════════════ bug 7 ════════════════════════════════════
// keyMatches: chord modifier tokens (control/shift/alt/meta) were compared to the
// single event.key, so (keyup.control.enter) could never fire.
Deno.test("bug 7: keyMatches handles modifier-key chords", () => {
  // the documented (keyup.control.enter) on a real Ctrl+Enter keyup
  assert(keyMatches({ key: "Enter", ctrlKey: true } as unknown as Event, ["control", "enter"]));
  // single-key still works
  assert(keyMatches({ key: "Enter" } as unknown as Event, ["enter"]));
  // modifier required but not held → no match
  assert(!keyMatches({ key: "Enter", ctrlKey: false } as unknown as Event, ["control", "enter"]));
  // wrong main key with the modifier held → no match
  assert(!keyMatches({ key: "a", ctrlKey: true } as unknown as Event, ["control", "enter"]));
  // shift-only chord (e.g. (click.shift)) — no key token, just the modifier
  assert(keyMatches({ shiftKey: true } as unknown as Event, ["shift"]));
  assert(!keyMatches({ shiftKey: false } as unknown as Event, ["shift"]));
  // meta alias
  assert(keyMatches({ key: "k", metaKey: true } as unknown as Event, ["meta", "k"]));
});

// ════════════════════════════════ bug 27 ═══════════════════════════════════
// fetchAst: a non-OK AST response must fail loudly, not let r.json() throw an opaque
// SyntaxError on the error body.
Deno.test("bug 27: fetchAst rejects with a clear error on a non-OK response", async () => {
  const g = globalThis as Record<string, unknown>;
  const savedFetch = g.fetch;
  g.fetch = () => Promise.resolve(new Response("not found", { status: 404 }));
  try {
    const err = await assertRejects(() => fetchAst("/ui", "counter"));
    // the fix surfaces a clean, attributable error (status + selector), NOT a
    // bare "Unexpected token ... is not valid JSON" SyntaxError from r.json().
    assertEquals((err as Error).message.includes("counter"), true);
    assertEquals((err as Error).message.includes("404"), true);
    assertEquals(err instanceof SyntaxError, false);
  } finally {
    g.fetch = savedFetch;
  }
});

// ════════════════════════════════ bug 87 ═══════════════════════════════════
// fetchAst: the selector must be URL-encoded so it round-trips through the server's
// decodeURIComponent.
Deno.test("bug 87: fetchAst URL-encodes the selector", async () => {
  const g = globalThis as Record<string, unknown>;
  const savedFetch = g.fetch;
  let seen = "";
  g.fetch = (url: string) => {
    seen = url;
    return Promise.resolve(new Response("{}", { status: 200, headers: { "content-type": "application/json" } }));
  };
  try {
    await fetchAst("/ui", "a/b%c");
    assertEquals(seen, "/ui/_sprig/ast/a%2Fb%25c");
  } finally {
    g.fetch = savedFetch;
  }
});

// ════════════════════════════════ bug 90 ═══════════════════════════════════
// loading set: a successful load must drain the selector from `loading`, symmetric with
// the .catch path.
Deno.test("bug 90: registerIsland clears the selector from the loading set", async () => {
  const dom = installDom();
  try {
    loading.add("widget");
    assert(loading.has("widget"));
    registerIsland("widget", { setup: () => ({}), template: await tpl(`<span>hi</span>`) });
    assert(!loading.has("widget"), "loading should be drained on successful register");
  } finally {
    dom.restore();
  }
});

// ════════════════════════════════ bug 8 ════════════════════════════════════
// soft-nav must NOT intercept a reload (it has to re-run the full document lifecycle).
Deno.test("bug 8: softNavShouldSkip lets a reload through to the browser", () => {
  const dom = installDom();
  try {
    const reload = {
      canIntercept: true,
      hashChange: false,
      downloadRequest: false,
      formData: false,
      navigationType: "reload",
      destination: { url: "http://localhost/ui/board" },
    };
    assertEquals(softNavShouldSkip(reload, CFG, "http://localhost/ui/board"), true);
    // a normal push to a different path is still intercepted
    const push = { ...reload, navigationType: "push", destination: { url: "http://localhost/ui/board" } };
    assertEquals(softNavShouldSkip(push, CFG, "http://localhost/ui/other"), false);
  } finally {
    dom.restore();
  }
});

// ════════════════════════════════ bug 70 ═══════════════════════════════════
// soft-nav must NOT tear down the outlet for a same-path (query-only / identical-URL)
// navigation.
Deno.test("bug 70: softNavShouldSkip skips same-path / query-only navigations", () => {
  const dom = installDom();
  try {
    const base = {
      canIntercept: true,
      hashChange: false,
      downloadRequest: false,
      formData: false,
      navigationType: "replace",
    };
    // identical URL (re-clicking the active link)
    assertEquals(
      softNavShouldSkip({ ...base, destination: { url: "http://localhost/ui/issues/SPR-101" } }, CFG, "http://localhost/ui/issues/SPR-101"),
      true,
    );
    // query-only change on the same path
    assertEquals(
      softNavShouldSkip({ ...base, destination: { url: "http://localhost/ui/issues/SPR-101?tab=y" } }, CFG, "http://localhost/ui/issues/SPR-101?tab=x"),
      true,
    );
    // a genuine path change is still intercepted
    assertEquals(
      softNavShouldSkip({ ...base, destination: { url: "http://localhost/ui/board" } }, CFG, "http://localhost/ui/issues/SPR-101"),
      false,
    );
  } finally {
    dom.restore();
  }
});

// ════════════════════════════════ bug 30/31 ════════════════════════════════
// soft-nav scroll: traverse (back/forward) must NOT be forced to top; a #fragment must
// scroll its target into view; push/replace with no hash jumps to top.
Deno.test("bug 30/31: softNavScroll preserves scroll on traverse (back/forward)", () => {
  const calls: Array<[number, number]> = [];
  const deps = {
    scrollTo: (x: number, y: number) => calls.push([x, y]),
    scrollToTarget: () => false,
  };
  // traverse must not scroll-to-top
  softNavScroll("traverse", "", deps, {} as ParentNode);
  assertEquals(calls.length, 0, "traverse must not force scrollTo(0,0)");
  // push with no hash jumps to top
  softNavScroll("push", "", deps, {} as ParentNode);
  assertEquals(calls, [[0, 0]]);
});

// ════════════════════════════════ bug 71 ═══════════════════════════════════
Deno.test("bug 71: softNavScroll scrolls a #fragment target into view instead of top", () => {
  const calls: Array<[number, number]> = [];
  let scrolledHash = "";
  const deps = {
    scrollTo: (x: number, y: number) => calls.push([x, y]),
    scrollToTarget: (_root: ParentNode, hash: string) => {
      scrolledHash = hash;
      return true; // target found + scrolled
    },
  };
  softNavScroll("push", "#comments", deps, {} as ParentNode);
  assertEquals(scrolledHash, "#comments");
  assertEquals(calls.length, 0, "found-fragment path must NOT also scroll to top");
});

// ════════════════════════════════ bug 69 ═══════════════════════════════════
// soft-nav must only commit a 2xx, non-redirected, text/html response.
Deno.test("bug 69: softNavResponseOk rejects non-OK / non-HTML / redirected responses", () => {
  const html = { "content-type": "text/html; charset=utf-8" };
  assertEquals(softNavResponseOk(new Response("<x>", { status: 200, headers: html })), true);
  assertEquals(softNavResponseOk(new Response("<x>", { status: 404, headers: html })), false);
  assertEquals(softNavResponseOk(new Response("{}", { status: 200, headers: { "content-type": "application/json" } })), false);
});

// ════════════════════════════════ bug 29 ═══════════════════════════════════
// soft-nav must fall back to a full browser navigation when the fetch rejects.
Deno.test("bug 29: runSoftNav falls back to full navigation on fetch rejection", async () => {
  const dom = installDom(`<sprig-outlet><p>old</p></sprig-outlet>`);
  try {
    let assigned = "";
    const deps: SoftNavDeps = {
      fetch: () => Promise.reject(new TypeError("network error")),
      parse: () => dom.document as unknown as Document,
      outletOf: (d) => (d as ParentNode).querySelector("sprig-outlet"),
      assign: (url) => (assigned = url),
      scrollTo: () => {},
      scrollToTarget: () => false,
      bootstrap: () => {},
      teardown: () => {},
    };
    const e = { destination: { url: "http://localhost/ui/board" }, signal: { aborted: false }, navigationType: "push" };
    await runSoftNav(e, CFG, deps);
    assertEquals(assigned, "http://localhost/ui/board", "rejected fetch must fall back to location.assign");
  } finally {
    dom.restore();
  }
});

// also: a non-OK response is full-nav'd (bug 69 end-to-end through runSoftNav)
Deno.test("bug 69: runSoftNav full-navigates on a non-OK response", async () => {
  const dom = installDom(`<sprig-outlet><p>old</p></sprig-outlet>`);
  try {
    let assigned = "";
    let swapped = false;
    const deps: SoftNavDeps = {
      fetch: () => Promise.resolve(new Response("err", { status: 500, headers: { "content-type": "text/html" } })),
      parse: () => dom.document as unknown as Document,
      outletOf: (d) => (d as ParentNode).querySelector("sprig-outlet"),
      assign: (url) => (assigned = url),
      scrollTo: () => {},
      scrollToTarget: () => false,
      bootstrap: () => (swapped = true),
      teardown: () => {},
    };
    const e = { destination: { url: "http://localhost/ui/board" }, signal: { aborted: false }, navigationType: "push" };
    await runSoftNav(e, CFG, deps);
    assertEquals(assigned, "http://localhost/ui/board");
    assertEquals(swapped, false, "a 500 must not be committed as a soft-nav");
  } finally {
    dom.restore();
  }
});

// ════════════════════════════════ bug 5 ════════════════════════════════════
// reactive re-render must PATCH (reuse nodes) not replace innerHTML wholesale, so an
// element the user is interacting with survives a signal-driven re-paint.
Deno.test("bug 5: reactive re-render reuses DOM nodes (no wholesale innerHTML replace)", async () => {
  const dom = installDom(
    `<sprig-island data-sel="search" data-trigger="load"><input></sprig-island>`,
  );
  try {
    // q drives a label; typing into the bound input writes q. The input itself is
    // constant across renders → its node must survive.
    const template = await tpl(`<input (input)="q.set('x')"> <span>{{ q() }}</span>`);
    let q: { set: (v: string) => void } | undefined;
    registerIsland("search", {
      setup: (ctx) => {
        const sig = ctx.model<string>("q", "");
        q = sig;
        return { q: sig };
      },
      template,
    });
    const island = dom.document.querySelector('sprig-island[data-sel="search"]')! as unknown as HTMLElement;
    assertEquals(island.dataset.sprigHydrated, "1");
    const inputBefore = island.querySelector("input");
    assert(inputBefore, "input rendered");
    // a reactive write that the render reads
    q!.set("hello");
    const inputAfter = island.querySelector("input");
    // node identity preserved → the morph reused the node rather than discarding it
    assert(inputBefore === inputAfter, "the <input> node must be REUSED across the re-render, not replaced");
    // and the reactive text actually updated
    assertEquals(island.querySelector("span")?.textContent?.includes("hello"), true);
  } finally {
    dom.restore();
  }
});

// ════════════════════════════════ bug 6 ════════════════════════════════════
// an event base introduced only by a LATER render must still get its delegated listener.
Deno.test("bug 6: a later-rendered event base gets delegated (wire() runs every render)", async () => {
  const dom = installDom(
    `<sprig-island data-sel="toggle" data-trigger="load"></sprig-island>`,
  );
  try {
    // initial render: only (click). After open=true a (input) element appears.
    const template = await tpl(
      `<button (click)="open.set(true)">t</button>\n@if (open()) {\n  <label (input)="hit.set(true)">f</label>\n}`,
    );
    let open: { set: (v: boolean) => void } | undefined;
    let hit: { (): boolean } | undefined;
    const wiredBases: string[] = [];
    registerIsland("toggle", {
      setup: (ctx) => {
        const o = ctx.model<boolean>("open", false);
        const h = ctx.model<boolean>("hit", false);
        open = o;
        hit = h as unknown as { (): boolean };
        return { open: o, hit: h };
      },
      template,
    });
    const island = dom.document.querySelector('sprig-island[data-sel="toggle"]')! as unknown as HTMLElement;
    // spy: record every addEventListener base on the island root
    const realAdd = island.addEventListener.bind(island);
    // deno-lint-ignore no-explicit-any
    (island as any).addEventListener = (type: string, ...rest: unknown[]) => {
      wiredBases.push(type);
      // deno-lint-ignore no-explicit-any
      return (realAdd as any)(type, ...rest);
    };
    // first render already happened during register; re-render after opening
    open!.set(true);
    assert(island.querySelector("label"), "field revealed after open=true");
    assert(wiredBases.includes("input"), "a delegated 'input' listener must be added after the later render");
  } finally {
    dom.restore();
  }
});

// ════════════════════════════════ bug 47 ═══════════════════════════════════
// a malformed props bridge on one instance must not (a) permanently flag it hydrated,
// nor (b) abort hydration of sibling instances of the same selector.
Deno.test("bug 47: a bad props bridge does not abort sibling hydration", async () => {
  const dom = installDom(
    `<sprig-island data-sel="card"><script class="sprig-props" type="application/json">{"a":</script></sprig-island>` +
      `<sprig-island data-sel="card"><script class="sprig-props" type="application/json">{"a":1}</script></sprig-island>`,
  );
  try {
    const template = await tpl(`<span>card</span>`);
    registerIsland("card", { setup: () => ({}), template });
    const islands = dom.document.querySelectorAll('sprig-island[data-sel="card"]');
    const first = islands[0] as unknown as HTMLElement;
    const second = islands[1] as unknown as HTMLElement;
    // the bad instance is NOT marked hydrated (so it can be retried), and crucially
    assert(first.dataset.sprigHydrated !== "1", "the failed instance must not be flagged hydrated");
    // the sibling DID hydrate (the throw was isolated, iteration continued)
    assertEquals(second.dataset.sprigHydrated, "1", "the sibling instance must still hydrate");
    assert(second.querySelector("span"), "sibling rendered");
  } finally {
    dom.restore();
  }
});

// ════════════════════════════════ bug 48 ═══════════════════════════════════
// the per-island effect must be disposed when its element is torn down (soft-nav swap),
// so it no longer re-renders against a detached node.
Deno.test("bug 48: teardownInside disposes the island effect (no writes after detach)", async () => {
  const dom = installDom(
    `<sprig-outlet><sprig-island data-sel="live-x" data-trigger="load"></sprig-island></sprig-outlet>`,
  );
  try {
    const template = await tpl(`<span>{{ n() }}</span>`);
    let n: { set: (v: number) => void } | undefined;
    let renders = 0;
    registerIsland("live-x", {
      setup: (ctx) => {
        const sig = ctx.model<number>("n", 0);
        n = sig;
        // count renders by reading n inside a wrapper that the template reads
        return {
          n: () => {
            renders++;
            return sig();
          },
        };
      },
      template,
    });
    const outlet = dom.document.querySelector("sprig-outlet")! as unknown as HTMLElement;
    const island = outlet.querySelector('sprig-island[data-sel="live-x"]')!;
    assertEquals((island as unknown as HTMLElement).dataset.sprigHydrated, "1");
    const rendersAtMount = renders;
    n!.set(1); // still mounted → effect runs
    const rendersWhileMounted = renders;
    assert(rendersWhileMounted > rendersAtMount, "effect re-renders while mounted");
    // simulate the soft-nav swap: tear down islands in the outlet, then detach them
    teardownInside(outlet);
    outlet.innerHTML = "";
    n!.set(2); // after dispose → effect must NOT run again
    assertEquals(renders, rendersWhileMounted, "disposed effect must not re-render after detach");
  } finally {
    dom.restore();
  }
});

// ════════════════════════════════ bug 68 ═══════════════════════════════════
// an armed-but-un-triggered IntersectionObserver inside a swapped-out outlet must be
// disconnected (not leaked).
Deno.test("bug 68: outlet teardown disconnects an un-triggered visible-island observer", async () => {
  const dom = installDom(
    `<sprig-outlet><sprig-island data-sel="rating" data-trigger="visible"></sprig-island></sprig-outlet>`,
  );
  const g = globalThis as Record<string, unknown>;
  let disconnects = 0;
  let observes = 0;
  class FakeIO {
    observe() {
      observes++;
    }
    disconnect() {
      disconnects++;
    }
  }
  g.IntersectionObserver = FakeIO as unknown;
  try {
    const { bootstrapIslands } = await import("../ui/.sprig/compiler/hydrate.ts");
    const outlet = dom.document.querySelector("sprig-outlet")! as unknown as HTMLElement;
    bootstrapIslands(CFG, outlet as unknown as ParentNode);
    assertEquals(observes, 1, "the visible island armed an observer");
    assertEquals(disconnects, 0, "not yet intersected → not yet disconnected");
    // soft-nav swaps the outlet → teardown must disconnect the armed observer
    teardownInside(outlet);
    assertEquals(disconnects, 1, "the leaked observer must be disconnected on outlet teardown");
  } finally {
    delete g.IntersectionObserver;
    dom.restore();
  }
});

// ════════════════════════════════ bug 66/86 ════════════════════════════════
// the dev-only `live` registry must be pruned of detached instances (hotTemplate skips
// AND removes them) so it stays bounded across soft-navigations.
Deno.test("bug 66/86: hotTemplate prunes detached instances so the live registry stays bounded", async () => {
  const dom = installDom();
  const { enableHmr } = await import("../ui/.sprig/compiler/hydrate.ts");
  try {
    enableHmr();
    const template = await tpl(`<span>{{ n() }}</span>`);
    const base = liveCount();
    // mount #1, then detach it (simulating a soft-nav outlet wipe), mount #2, detach,
    // mount #3 — three round trips. The registry must NOT grow by 3; pruning on each
    // hot-swap keeps it bounded to the currently-mounted instance(s).
    for (let i = 0; i < 3; i++) {
      dom.document.body.innerHTML = `<sprig-island data-sel="hmr-x" data-trigger="load"></sprig-island>`;
      registerIsland("hmr-x", { setup: (ctx) => ({ n: ctx.model<number>("n", 0) }), template });
      // a hot-swap is what prunes dead entries (and the dev server sends one per edit)
      hotTemplate("hmr-x", template);
    }
    // exactly ONE currently-mounted instance remains tracked, not base+3
    assertEquals(liveCount() - base, 1, "detached instances must be pruned (bounded live registry)");
    // and the live instance still hot-swaps correctly
    const newTpl = await tpl(`<span>v2 {{ n() }}</span>`);
    hotTemplate("hmr-x", newTpl);
    const liveIsland = dom.document.querySelector('sprig-island[data-sel="hmr-x"]')! as unknown as HTMLElement;
    assertEquals(liveIsland.querySelector("span")?.textContent?.includes("v2"), true, "the live instance hot-swapped");
  } finally {
    dom.restore();
  }
});
