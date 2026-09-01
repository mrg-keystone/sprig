// TEMPLATE WIRING (template-wiring-spec.md §3, test plan §8 items 1–8 + the runtime
// write guard). The three directional verbs — `sets:` / `reads:` / `edits:` — are
// exercised end-to-end through the REAL pipeline:
//   • parse.ts quotes the longhand `={channel}` literal through the grammar;
//   • render.ts collects the tethers at compile time (never emitting them as literal
//     DOM attributes), carries an island's wiring in its props bridge (`__wiring`),
//     and stamps a forwarding <router-outlet>'s tethers on the emitted
//     <sprig-outlet> (`data-wire` / `data-wire-owner`);
//   • hydrate.ts tethers each island BEFORE its first effect render (wiring.ts):
//     channels are per-declaring-template (owner stamp) per region (outlet content /
//     document root), seeded by the first `sets:` to hydrate unless an explicit
//     write already landed, adopted by everyone else, write-guarded for `reads:`,
//     retained across participant unmounts, and torn down with their region.
// SSR never tethers: no channels exist server-side (§8.6).
import { assert, assertEquals, assertStringIncludes, assertThrows } from "@std/assert";
import { DOMParser, type HTMLDocument } from "jsr:@b-fuze/deno-dom";
import { named, parseTemplate, quoteWiringLonghand } from "./parse.ts";
import { type ComponentDef, islandHost, renderNodes } from "./render.ts";
import { serialize } from "./serialize.ts";
import { bootstrapIslands, type IslandEntry, registerIsland, setDevDiagnostics, teardownInside } from "./hydrate.ts";
import { resetWiring } from "./wiring.ts";
import { isSignal, signal, type WritableAccessor } from "@mrg-keystone/sprig";
import type { Scope } from "./expr.ts";

// ────────────────────────────────── harness ─────────────────────────────────
/** SSR a frame template (the DECLARING template) with the given scope stamp. */
async function ssr(src: string, defs: ComponentDef[], scopeAttr: string, outlet?: string, outletKey?: string): Promise<string> {
  const root = await parseTemplate(src);
  const map = new Map(defs.map((d) => [d.selector, d]));
  return renderNodes(named(root), {
    scope: {},
    registry: { get: (s: string) => map.get(s) },
    source: root.text,
    scopeAttr,
    outlet,
    outletKey,
  });
}

/** A server-side island ComponentDef whose scope() builds a fresh signal record. */
async function serverIsland(selector: string, tpl: string, scope: string, mk: () => Scope): Promise<ComponentDef> {
  return { selector, template: await parseTemplate(tpl), scope, island: { scope: () => mk(), trigger: "load" } };
}

/** Register the island's CLIENT entry (what its chunk does); hydration is synchronous
 *  for any matching host already in the mocked document. */
async function clientIsland(selector: string, tpl: string, scope: string, mk: () => Record<string, unknown>): Promise<void> {
  const entry: IslandEntry = { setup: () => mk(), template: serialize(await parseTemplate(tpl)), scope };
  registerIsland(selector, entry);
}

function mockDoc(body: string): HTMLDocument {
  const doc = new DOMParser().parseFromString(`<html><body>${body}</body></html>`, "text/html")!;
  Object.defineProperty(globalThis, "document", { configurable: true, value: doc });
  return doc;
}
// deno-lint-ignore no-explicit-any
const unmockDoc = () => delete (globalThis as any).document;

/** The hydrated scope of the FIRST not-yet-consumed host for `sel` (or the nth). */
function scopeOf(doc: HTMLDocument, sel: string, nth = 0): Record<string, WritableAccessor<unknown>> {
  const hosts = doc.querySelectorAll(`sprig-island[data-sel="${sel}"]`);
  // deno-lint-ignore no-explicit-any
  const scope = (hosts[nth] as any)?.__sprigScope;
  assert(scope, `island "${sel}" #${nth} must be hydrated`);
  return scope;
}

const CFG = { base: "", v: "t" };

// ─── §8.1 + §8.2: sibling islands under a static parent share a channel, all three verbs ───
Deno.test("spec §8.1/§8.2: sets:/reads:/edits: siblings under a static parent share one channel, both directions", async () => {
  resetWiring();
  const frame = `<div class="frame"><nav-a1 sets:org></nav-a1><view-a1 reads:org></view-a1><edit-a1 edits:draft={org}></edit-a1></div>`;
  const html = await ssr(frame, [
    await serverIsland("nav-a1", `<span>{{ org() }}</span>`, "sNavA1", () => ({ org: signal("acme") })),
    await serverIsland("view-a1", `<span>{{ org() }}</span>`, "sViewA1", () => ({ org: signal(null) })),
    await serverIsland("edit-a1", `<span>{{ draft() }}</span>`, "sEditA1", () => ({ draft: signal("mine") })),
  ], "sFrameA1");
  // the static parent stays static: no host wraps the frame div, only the islands.
  assertStringIncludes(html, `<div sFrameA1 class="frame">`);

  const doc = mockDoc(html);
  try {
    await clientIsland("nav-a1", `<span>{{ org() }}</span>`, "sNavA1", () => ({ org: signal("acme") }));
    await clientIsland("view-a1", `<span>{{ org() }}</span>`, "sViewA1", () => ({ org: signal(null) }));
    await clientIsland("edit-a1", `<span>{{ draft() }}</span>`, "sEditA1", () => ({ draft: signal("mine") }));

    const nav = scopeOf(doc, "nav-a1"), view = scopeOf(doc, "view-a1"), edit = scopeOf(doc, "edit-a1");
    // seeding (§8.5): the sets: origin seeded; reads:/edits: adopted — their own
    // initial values (null / "mine") are DISCARDED on tether.
    assertEquals(view.org(), "acme", "reads: adopts the seeded value; its own default is discarded");
    assertEquals(edit.draft(), "acme", "edits: adopts too — its own initial value is discarded (§8.2)");

    // origin writes → every tether sees it, and the reader's DOM re-paints.
    nav.org.set("globex");
    assertEquals(view.org(), "globex");
    assertEquals(edit.draft(), "globex");
    assertStringIncludes(doc.querySelector(`sprig-island[data-sel="view-a1"]`)!.textContent ?? "", "globex", "the reader island re-rendered from the channel write");

    // the OTHER direction (§8.2): the edits: tether writes and the origin + reader see it.
    edit.draft.set("initech");
    assertEquals(nav.org(), "initech", "an edits: write reaches the sets: origin");
    assertEquals(view.org(), "initech", "…and every reader");
  } finally {
    unmockDoc();
  }
});

// ─── §8.3 + write guard: reads: .set() throws — dev names component/channel/line, prod still throws ───
Deno.test("spec §8.3: a reads: tether's .set()/.update()/.value= throw — dev message names component, channel, template line", async () => {
  resetWiring();
  const frame = `<div>
  <set-b1 sets:org></set-b1>
  <read-b1 reads:org></read-b1>
</div>`;
  const html = await ssr(frame, [
    await serverIsland("set-b1", `<i></i>`, "sSetB1", () => ({ org: signal("x") })),
    await serverIsland("read-b1", `<i></i>`, "sReadB1", () => ({ org: signal(null) })),
  ], "sFrameB1");
  const doc = mockDoc(html);
  try {
    await clientIsland("set-b1", `<i></i>`, "sSetB1", () => ({ org: signal("x") }));
    await clientIsland("read-b1", `<i></i>`, "sReadB1", () => ({ org: signal(null) }));
    const reader = scopeOf(doc, "read-b1");

    // reading (and introspection) still work through the guard.
    assertEquals(reader.org(), "x");
    assertEquals(reader.org.value, "x");
    assert(isSignal(reader.org), "the guarded field still quacks like a signal accessor");

    // dev: the rich message names the component, the channel and the template line.
    setDevDiagnostics(true);
    const err = assertThrows(() => reader.org.set("nope"), Error, "read-only");
    assertStringIncludes(err.message, "read-b1", "names the component");
    assertStringIncludes(err.message, `"org"`, "names the channel");
    assertStringIncludes(err.message, "template line 3", "names the declaring template line");
    assertThrows(() => reader.org.update(() => "nope"), Error, "read-only");
    assertThrows(() => ((reader.org as { value: unknown }).value = "nope"), Error, "read-only");

    // production: the throw itself always ships — only the detail is dev-mode.
    setDevDiagnostics(false);
    const prodErr = assertThrows(() => reader.org.set("nope"), Error, "read-only");
    assert(!prodErr.message.includes("read-b1"), "prod message carries no component detail");

    assertEquals(reader.org(), "x", "no write landed through the guard");
  } finally {
    setDevDiagnostics(false);
    unmockDoc();
  }
});

// ─── §8.4: late hydration — the reader tethers AFTER the setter wrote, and still sees the value ───
Deno.test("spec §8.4: a late-hydrating reader adopts the buffered value (a channel is a signal, not an event)", async () => {
  resetWiring();
  const frame = `<div><set-c1 sets:org></set-c1><read-c1 reads:org></read-c1></div>`;
  const html = await ssr(frame, [
    await serverIsland("set-c1", `<i></i>`, "sSetC1", () => ({ org: signal("seeded") })),
    await serverIsland("read-c1", `<span>{{ org() }}</span>`, "sReadC1", () => ({ org: signal(null) })),
  ], "sFrameC1");
  const doc = mockDoc(html);
  try {
    await clientIsland("set-c1", `<i></i>`, "sSetC1", () => ({ org: signal("seeded") }));
    // the setter hydrates first and WRITES before the reader's chunk ever arrives.
    scopeOf(doc, "set-c1").org.set("written-early");

    await clientIsland("read-c1", `<span>{{ org() }}</span>`, "sReadC1", () => ({ org: signal(null) }));
    const reader = scopeOf(doc, "read-c1");
    assertEquals(reader.org(), "written-early", "the late reader never misses the earlier write");
    assertStringIncludes(doc.querySelector(`sprig-island[data-sel="read-c1"]`)!.textContent ?? "", "written-early");
  } finally {
    unmockDoc();
  }
});

// ─── §8.5: seeding — first sets: seeds; pre-seed reads observe undefined; explicit write beats a late seed; non-first sets: adopts ───
Deno.test("spec §8.5: a reader tethered before any sets: observes undefined, and the first sets: still seeds cleanly", async () => {
  resetWiring();
  const frame = `<div><read-d1 reads:org></read-d1><set-d1 sets:org></set-d1></div>`;
  const html = await ssr(frame, [
    await serverIsland("read-d1", `<i></i>`, "sReadD1", () => ({ org: signal("reader-default") })),
    await serverIsland("set-d1", `<i></i>`, "sSetD1", () => ({ org: signal("origin-default") })),
  ], "sFrameD1");
  const doc = mockDoc(html);
  try {
    // the reader hydrates FIRST: the channel is unseeded → it observes undefined
    // (not its own discarded default, not a component-supplied null).
    await clientIsland("read-d1", `<i></i>`, "sReadD1", () => ({ org: signal("reader-default") }));
    const reader = scopeOf(doc, "read-d1");
    assertEquals(reader.org(), undefined, "pre-seed observation is undefined (accepted [DECIDE])");

    // mere tethering doesn't count as "holding a value": the sets: origin seeds.
    await clientIsland("set-d1", `<i></i>`, "sSetD1", () => ({ org: signal("origin-default") }));
    assertEquals(reader.org(), "origin-default", "the genuinely-first sets: seeded despite the earlier tether");
  } finally {
    unmockDoc();
  }
});

Deno.test("spec §8.5: an explicit write before the sets: origin hydrates is never clobbered by its seed", async () => {
  resetWiring();
  const frame = `<div><set-d2 sets:org></set-d2><edit-d2 edits:org></edit-d2></div>`;
  const html = await ssr(frame, [
    await serverIsland("set-d2", `<i></i>`, "sSetD2", () => ({ org: signal("origin-default") })),
    await serverIsland("edit-d2", `<i></i>`, "sEditD2", () => ({ org: signal("editor-default") })),
  ], "sFrameD2");
  const doc = mockDoc(html);
  try {
    // the EDITOR hydrates first (chunk order is not guaranteed) and the user types.
    await clientIsland("edit-d2", `<i></i>`, "sEditD2", () => ({ org: signal("editor-default") }));
    const edit = scopeOf(doc, "edit-d2");
    assertEquals(edit.org(), undefined, "the editor adopted the unseeded channel");
    edit.org.set("typed-by-user");

    // the sets: origin hydrates late: the channel already HOLDS a written value → seeding skipped.
    await clientIsland("set-d2", `<i></i>`, "sSetD2", () => ({ org: signal("origin-default") }));
    const origin = scopeOf(doc, "set-d2");
    assertEquals(edit.org(), "typed-by-user", "the user's write survives the late-arriving origin");
    assertEquals(origin.org(), "typed-by-user", "the origin adopted instead of reseeding");
  } finally {
    unmockDoc();
  }
});

Deno.test("spec §8.5: a NON-FIRST sets: on the same channel tethers like edits: — adopts, never reseeds", async () => {
  resetWiring();
  const frame = `<div><set-d3 sets:org></set-d3><setb-d3 sets:org></setb-d3><read-d3 reads:org></read-d3></div>`;
  const html = await ssr(frame, [
    await serverIsland("set-d3", `<i></i>`, "sSetD3", () => ({ org: signal("first") })),
    await serverIsland("setb-d3", `<i></i>`, "sSetbD3", () => ({ org: signal("second") })),
    await serverIsland("read-d3", `<i></i>`, "sReadD3", () => ({ org: signal(null) })),
  ], "sFrameD3");
  const doc = mockDoc(html);
  try {
    await clientIsland("set-d3", `<i></i>`, "sSetD3", () => ({ org: signal("first") }));
    await clientIsland("setb-d3", `<i></i>`, "sSetbD3", () => ({ org: signal("second") }));
    await clientIsland("read-d3", `<i></i>`, "sReadD3", () => ({ org: signal(null) }));
    assertEquals(scopeOf(doc, "read-d3").org(), "first", "only the first sets: seeded");
    assertEquals(scopeOf(doc, "setb-d3").org(), "first", "the second sets: adopted — its own value discarded");
    // …but it stays read-WRITE: its writes flow like an edits:.
    scopeOf(doc, "setb-d3").org.set("from-second");
    assertEquals(scopeOf(doc, "set-d3").org(), "from-second");
  } finally {
    unmockDoc();
  }
});

// ─── §8.6: SSR — components render from their own defaults; wiring never leaks into the DOM ───
Deno.test("spec §8.6: SSR renders every component from its OWN defaults — no channel server-side, no literal wiring attributes", async () => {
  const frame = `<section><set-e1 sets:org></set-e1><read-e1 reads:org></read-e1><edit-e1 edits:draft={org}></edit-e1><p sets:org>prose</p></section>`;
  const html = await ssr(frame, [
    await serverIsland("set-e1", `<b>{{ org() }}</b>`, "sSetE1", () => ({ org: signal("acme") })),
    await serverIsland("read-e1", `<b>{{ org() }}</b>`, "sReadE1", () => ({ org: signal("reader-own-default") })),
    await serverIsland("edit-e1", `<b>{{ draft() }}</b>`, "sEditE1", () => ({ draft: signal("my-draft") })),
  ], "sFrameE1");

  // each island SSR'd from its OWN default — the reader shows its empty-state, not "acme".
  assertStringIncludes(html, `<b sSetE1>acme</b>`);
  assertStringIncludes(html, `<b sReadE1>reader-own-default</b>`, "the reads: island renders its own default server-side");
  assertStringIncludes(html, `<b sEditE1>my-draft</b>`, "the edits: island renders its own default server-side");

  // no wiring verb survives as a literal DOM attribute — on component roots OR native elements.
  assert(!/<[a-zA-Z][^>]*\s(?:sets|reads|edits):/.test(html), "wiring attributes must not leak into the emitted DOM");
  // …and none leaks into the props bridge as an @input; the wiring rides ONLY in __wiring.
  assert(!html.includes(`"sets:`) && !html.includes(`"reads:`) && !html.includes(`"edits:`), "wiring is not an @input");
  assertStringIncludes(html, `"__wiring":{"o":"sFrameE1","t":[{"v":"sets","f":"org","c":"org","l":1}]}`);
  assertStringIncludes(html, `{"v":"edits","f":"draft","c":"org","l":1}`, "longhand renames only the channel side");
});

Deno.test("spec §3 longhand: the {channel} literal parses through the grammar; text content is untouched; interpolation is rejected", async () => {
  // the pre-pass rewrites ONLY inside tags — the same sequence anywhere else (prose,
  // comments, raw <script>/<style> bodies) stays byte-identical.
  assertEquals(quoteWiringLonghand(`<p>sets:x={y} is the longhand</p>`), `<p>sets:x={y} is the longhand</p>`);
  assertEquals(quoteWiringLonghand(`<!-- <a sets:x={y}> --><script>let sets = {y: 1};</script>`), `<!-- <a sets:x={y}> --><script>let sets = {y: 1};</script>`);
  assertEquals(quoteWiringLonghand(`<a-b edits:draft={org}>`), `<a-b edits:draft="&#123;org&#125;">`);

  // a non-literal channel value is a compile-time error, not a silent misparse.
  const bad = await parseTemplate(`<div><set-e2 sets:org="{{ expr }}"></set-e2></div>`);
  const def = await serverIsland("set-e2", `<i></i>`, "sSetE2", () => ({ org: signal("x") }));
  assertThrows(
    () => renderNodes(named(bad), { scope: {}, registry: { get: () => def }, source: bad.text, scopeAttr: "sF" }),
    Error,
    "compile-time literal",
  );
  const bad2 = await parseTemplate(`<div><set-e2 sets:org="plainText"></set-e2></div>`);
  assertThrows(
    () => renderNodes(named(bad2), { scope: {}, registry: { get: () => def }, source: bad2.text, scopeAttr: "sF" }),
    Error,
    "literal",
  );
});

// ─── §8.7: longhand — two instances of ONE component joined to DIFFERENT channels ───
Deno.test("spec §8.7: longhand joins two instances of one component to different channels", async () => {
  resetWiring();
  const frame = `<div><val-f1 sets:val={fA}></val-f1><val-f1 sets:val={fB}></val-f1><watcha-f1 reads:watch={fA}></watcha-f1><watchb-f1 reads:watch={fB}></watchb-f1></div>`;
  let ssrN = 0;
  const html = await ssr(frame, [
    await serverIsland("val-f1", `<i></i>`, "sValF1", () => ({ val: signal("v" + (++ssrN)) })),
    await serverIsland("watcha-f1", `<i></i>`, "sWatchaF1", () => ({ watch: signal(null) })),
    await serverIsland("watchb-f1", `<i></i>`, "sWatchbF1", () => ({ watch: signal(null) })),
  ], "sFrameF1");
  const doc = mockDoc(html);
  try {
    let n = 0;
    await clientIsland("val-f1", `<i></i>`, "sValF1", () => ({ val: signal("v" + (++n)) }));
    await clientIsland("watcha-f1", `<i></i>`, "sWatchaF1", () => ({ watch: signal(null) }));
    await clientIsland("watchb-f1", `<i></i>`, "sWatchbF1", () => ({ watch: signal(null) }));

    const one = scopeOf(doc, "val-f1", 0), two = scopeOf(doc, "val-f1", 1);
    const wa = scopeOf(doc, "watcha-f1"), wb = scopeOf(doc, "watchb-f1");
    assertEquals(wa.watch(), "v1", "channel fA seeded by instance 1");
    assertEquals(wb.watch(), "v2", "channel fB seeded by instance 2 — distinct channels");

    one.val.set("only-A");
    assertEquals(wa.watch(), "only-A");
    assertEquals(wb.watch(), "v2", "a write on fA never crosses into fB");
    two.val.set("only-B");
    assertEquals(wb.watch(), "only-B");
    assertEquals(wa.watch(), "only-A");
  } finally {
    unmockDoc();
  }
});

// ─── channel scope is PER-TEMPLATE: same channel name in two templates never collides ───
Deno.test("spec §3 channel scope: a channel name is scoped to its declaring template — two templates' `org` never collide", async () => {
  resetWiring();
  const defsMk = async (suffix: string, stampPrefix: string) => [
    await serverIsland(`set-${suffix}`, `<i></i>`, `${stampPrefix}Set`, () => ({ org: signal(`from-${suffix}`) })),
    await serverIsland(`read-${suffix}`, `<i></i>`, `${stampPrefix}Read`, () => ({ org: signal(null) })),
  ];
  const html1 = await ssr(`<div><set-i1 sets:org></set-i1><read-i1 reads:org></read-i1></div>`, await defsMk("i1", "sI1"), "sFrameI1");
  const html2 = await ssr(`<div><set-i2 sets:org></set-i2><read-i2 reads:org></read-i2></div>`, await defsMk("i2", "sI2"), "sFrameI2");
  const doc = mockDoc(html1 + html2);
  try {
    await clientIsland("set-i1", `<i></i>`, "sI1Set", () => ({ org: signal("from-i1") }));
    await clientIsland("read-i1", `<i></i>`, "sI1Read", () => ({ org: signal(null) }));
    await clientIsland("set-i2", `<i></i>`, "sI2Set", () => ({ org: signal("from-i2") }));
    await clientIsland("read-i2", `<i></i>`, "sI2Read", () => ({ org: signal(null) }));

    assertEquals(scopeOf(doc, "read-i1").org(), "from-i1");
    assertEquals(scopeOf(doc, "read-i2").org(), "from-i2");
    scopeOf(doc, "set-i1").org.set("changed-i1");
    assertEquals(scopeOf(doc, "read-i1").org(), "changed-i1");
    assertEquals(scopeOf(doc, "read-i2").org(), "from-i2", "the other template's same-named channel is a different channel");
  } finally {
    unmockDoc();
  }
});

// ─── §8.8: outlet forwarding — matching page tethers, non-matching untouched, nested islands excluded, nav re-tethers + retains ───
Deno.test("spec §8.8: <router-outlet reads:org> forwards a read-only tether to the mounted page's matching signal", async () => {
  resetWiring();
  const shell = `<div class="frame"><nav-g1 sets:org></nav-g1><router-outlet reads:org></router-outlet></div>`;
  // page 1: has an `org` signal (gets the tether) + its own `other` + a NESTED island.
  const nested = islandHost("sNestG1", "nested-g1", "load", {}, `<i sNestG1></i>`);
  const page1 = islandHost("sPageG1", "page-g1", "load", {}, `<span sPageG1>p1</span>` + nested);
  const html = await ssr(shell, [
    await serverIsland("nav-g1", `<i></i>`, "sNavG1", () => ({ org: signal("acme") })),
  ], "sShellG1", page1, "pages/page-g1");

  // the emitted outlet carries the forwarding tether + the declaring template's stamp.
  assertStringIncludes(html, `data-wire="reads:org=org"`);
  assertStringIncludes(html, `data-wire-owner="sShellG1"`);

  const doc = mockDoc(html);
  try {
    await clientIsland("nav-g1", `<i></i>`, "sNavG1", () => ({ org: signal("acme") }));
    await clientIsland("page-g1", `<span>{{ org() }}</span>`, "sPageG1", () => ({ org: signal(null), other: signal("own") }));
    await clientIsland("nested-g1", `<i></i>`, "sNestG1", () => ({ org: signal("nested-own") }));
    await clientIsland("page-g2", `<i></i>`, "sPageG2", () => ({ name: signal("p2-own") }));
    bootstrapIslands(CFG, doc.body as unknown as ParentNode);

    const page = scopeOf(doc, "page-g1");
    assertEquals(page.org(), "acme", "the page's matching `org` signal is tethered by name");
    setDevDiagnostics(true);
    const err = assertThrows(() => page.org.set("nope"), Error, "read-only");
    assertStringIncludes(err.message, "page-g1", "the forwarded reads: guard names the page");
    setDevDiagnostics(false);
    page.other.set("still-mine");
    assertEquals(page.other(), "still-mine", "non-matching fields are untouched");

    // an island NESTED INSIDE the page is never forwarded — only the page root is.
    const nestedScope = scopeOf(doc, "nested-g1");
    assertEquals(nestedScope.org(), "nested-own", "a nested island keeps its own signal");
    nestedScope.org.set("nested-write"); // …and it stays writable (no forwarded guard)
    assertEquals(scopeOf(doc, "nav-g1").org(), "acme", "the nested write never reached the channel");

    // live update flows shell → page.
    scopeOf(doc, "nav-g1").org.set("globex");
    assertEquals(page.org(), "globex");
    assertStringIncludes(doc.querySelector(`sprig-island[data-sel="page-g1"]`)!.textContent ?? "", "globex");

    // NAVIGATION: swap to a page WITHOUT a matching signal — it is untouched.
    const outletEl = doc.querySelector("sprig-outlet")! as unknown as HTMLElement;
    teardownInside(outletEl as unknown as ParentNode);
    outletEl.innerHTML = islandHost("sPageG2", "page-g2", "load", {}, `<span sPageG2>p2</span>`);
    bootstrapIslands(CFG, outletEl as unknown as ParentNode);
    const page2 = scopeOf(doc, "page-g2");
    assertEquals(page2.name(), "p2-own", "a page without the matching signal is a black box");
    page2.name.set("renamed");
    assertEquals(page2.name(), "renamed");

    // NAVIGATE BACK: a fresh page-g1 instance re-tethers and sees the RETAINED value.
    teardownInside(outletEl as unknown as ParentNode);
    outletEl.innerHTML = islandHost("sPageG1", "page-g1", "load", {}, `<span sPageG1>p1</span>`);
    bootstrapIslands(CFG, outletEl as unknown as ParentNode);
    const pageAgain = scopeOf(doc, "page-g1");
    assertEquals(pageAgain.org(), "globex", "the re-mounted page re-tethers to the retained channel value");
  } finally {
    setDevDiagnostics(false);
    unmockDoc();
  }
});

Deno.test("spec §8.8 + retention: <router-outlet sets:org> — the page seeds, the value RETAINS after it unmounts, a later page adopts", async () => {
  resetWiring();
  const shell = `<div><probe-h1 reads:org></probe-h1><router-outlet sets:org></router-outlet></div>`;
  const page1 = islandHost("sPageH1", "page-h1", "load", {}, `<i sPageH1></i>`);
  const html = await ssr(shell, [
    await serverIsland("probe-h1", `<span>{{ org() }}</span>`, "sProbeH1", () => ({ org: signal(null) })),
  ], "sShellH1", page1, "pages/page-h1");
  assertStringIncludes(html, `data-wire="sets:org=org"`);

  const doc = mockDoc(html);
  try {
    await clientIsland("probe-h1", `<span>{{ org() }}</span>`, "sProbeH1", () => ({ org: signal(null) }));
    await clientIsland("page-h1", `<i></i>`, "sPageH1", () => ({ org: signal("from-page-1") }));
    await clientIsland("page-h2", `<i></i>`, "sPageH2", () => ({ name: signal("p2") }));
    await clientIsland("page-h3", `<i></i>`, "sPageH3", () => ({ org: signal("from-page-3") }));
    bootstrapIslands(CFG, doc.body as unknown as ParentNode);

    // the shell probe tethered BEFORE the page (enclosing template precedes the
    // mounted page): it observed undefined, then the page's forwarded sets: seeded.
    const probe = scopeOf(doc, "probe-h1");
    assertEquals(probe.org(), "from-page-1", "the forwarded sets: page seeded the shell-declared channel");

    scopeOf(doc, "page-h1").org.set("hello");
    assertEquals(probe.org(), "hello");

    // navigate away: the ONLY sets: origin unmounts → the channel RETAINS "hello".
    const outletEl = doc.querySelector("sprig-outlet")! as unknown as HTMLElement;
    teardownInside(outletEl as unknown as ParentNode);
    outletEl.innerHTML = islandHost("sPageH2", "page-h2", "load", {}, `<i sPageH2></i>`);
    bootstrapIslands(CFG, outletEl as unknown as ParentNode);
    assertEquals(probe.org(), "hello", "the channel outlives its origin — last written value retained");

    // a later sets: page ADOPTS the retained value (the channel is already seeded).
    teardownInside(outletEl as unknown as ParentNode);
    outletEl.innerHTML = islandHost("sPageH3", "page-h3", "load", {}, `<i sPageH3></i>`);
    bootstrapIslands(CFG, outletEl as unknown as ParentNode);
    assertEquals(scopeOf(doc, "page-h3").org(), "hello", "a replacement sets: origin adopts — never reseeds");
    assertEquals(probe.org(), "hello");
    scopeOf(doc, "page-h3").org.set("from-3-live");
    assertEquals(probe.org(), "from-3-live", "…but it IS the new origin: its writes flow");
  } finally {
    unmockDoc();
  }
});

Deno.test("spec §3 channel scope: a channel declared INSIDE a page's own template dies on navigation", async () => {
  resetWiring();
  const shell = `<main><router-outlet></router-outlet></main>`;
  // the page's own (static) template wires two islands — a PAGE-SCOPED channel.
  const pageFrame = `<div><setter-h2 sets:local></setter-h2><reader-h2 reads:local></reader-h2></div>`;
  const pageHtml = await ssr(pageFrame, [
    await serverIsland("setter-h2", `<i></i>`, "sSetH2", () => ({ local: signal("p1") })),
    await serverIsland("reader-h2", `<span>{{ local() }}</span>`, "sReadH2", () => ({ local: signal(null) })),
  ], "sPageH2f");
  const html = await ssr(shell, [], "sShellH2", pageHtml, "pages/the-page");

  const doc = mockDoc(html);
  try {
    await clientIsland("setter-h2", `<i></i>`, "sSetH2", () => ({ local: signal("p1") }));
    await clientIsland("reader-h2", `<span>{{ local() }}</span>`, "sReadH2", () => ({ local: signal(null) }));
    bootstrapIslands(CFG, doc.body as unknown as ParentNode);

    assertEquals(scopeOf(doc, "reader-h2").local(), "p1");
    scopeOf(doc, "setter-h2").local.set("edited");
    assertEquals(scopeOf(doc, "reader-h2").local(), "edited");

    // navigate away and back (soft-nav: teardown, swap innerHTML, re-bootstrap).
    const outletEl = doc.querySelector("sprig-outlet")! as unknown as HTMLElement;
    teardownInside(outletEl as unknown as ParentNode);
    outletEl.innerHTML = pageHtml; // the same page mounts again, fresh
    bootstrapIslands(CFG, outletEl as unknown as ParentNode);

    assertEquals(scopeOf(doc, "reader-h2").local(), "p1", "the page-scoped channel died with the navigation — reseeded fresh, not \"edited\"");
  } finally {
    unmockDoc();
  }
});
