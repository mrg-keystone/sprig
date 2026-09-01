// SCOPED EVENT DISPATCH (template-wiring-spec.md §1; infra/buglist.md 2026-09-01).
//
// sprig 1.0.2 resolved (event) handlers by bare numeric index (data-sprig-click="2")
// with only a root.contains(el) check per island listener — so when live islands NEST,
// a child element's binding index N also fired the wrapping island's handler N (infra:
// clicking a page row opened the shell's modal). The fix, exercised end-to-end here
// through the REAL render.ts client path (marker emission) and the REAL hydrate.ts
// resolution (scopedHandlersFor):
//   • render.ts stamps every marker token with its COMPILE-TIME owner —
//     `data-sprig-<base>="<ownerStamp>:<index>"`, the stamp being the scopeAttr of the
//     template that AUTHORED the binding (never inferred from the hosting element's
//     own scope attributes, which can be several);
//   • each island INSTANCE owns its handler table, and dispatch resolves an event only
//     against the table of the NEAREST live island root containing the matched element
//     (inclusive walk), by (stamp, index) — stopping there whether or not it matches;
//   • static components register no tables; a table MISS runs no handler and emits a
//     dev-only console diagnostic naming the element and stamp.
//
// One scopedHandlersFor call below = one island instance's delegated listener being
// reached by the bubbling event (hydrate.ts wire() calls exactly this per listener).
import { assert, assertEquals, assertStringIncludes } from "@std/assert";
import { DOMParser, type HTMLDocument } from "jsr:@b-fuze/deno-dom";
import { named, parseTemplate } from "./parse.ts";
import { type ComponentDef, type Handler, renderNodes } from "./render.ts";
import { nearestIslandRoot, resolveHandlers, scopedHandlersFor, setDevDiagnostics } from "./hydrate.ts";

// deno-dom nodes stand in for lib.dom ones (the test convention across this suite).
// deno-lint-ignore no-explicit-any
const asEl = (n: unknown): Element => n as any;
const ev = {} as Event;

/** Render a template fragment in CLIENT mode (the hydrateIsland effect's render) with
 *  the given owning scope stamp, collecting the instance's handler table. */
async function clientRender(
  src: string,
  scopeAttr: string | undefined,
  defs: ComponentDef[] = [],
): Promise<{ html: string; handlers: Handler[] }> {
  const root = await parseTemplate(src);
  const handlers: Handler[] = [];
  const map = new Map(defs.map((d) => [d.selector, d]));
  const html = renderNodes(named(root), {
    scope: {},
    registry: { get: (s: string) => map.get(s) },
    source: root.text,
    handlers,
    scopeAttr,
  });
  return { html, handlers };
}

/** Wrap client-rendered island content as its LIVE (hydrated) host, the way the DOM
 *  looks after hydrateIsland ran: stamped, data-sel'd, data-sprig-hydrated. */
function host(stamp: string, sel: string, id: string, inner: string): string {
  return `<sprig-island ${stamp} data-sel="${sel}" data-trigger="load" data-sprig-hydrated="1" id="${id}">${inner}</sprig-island>`;
}

function parseDoc(body: string): HTMLDocument {
  return new DOMParser().parseFromString(`<html><body>${body}</body></html>`, "text/html")!;
}

/** One island instance's delegated listener for `base`, as wire() attaches it. */
function listener(rootEl: unknown, handlers: Handler[], base = "click") {
  return (target: unknown, onMiss?: (token: string, el: Element) => void): Handler[] =>
    scopedHandlersFor(asEl(rootEl), asEl(target), base, handlers, ev, onMiss);
}

// ─── 1. nested live islands (different components): child click runs ONLY the child's handler ───
Deno.test("spec §1 test 1: nested live islands — the infra collision (index N vs index N) is scoped away", async () => {
  // shell island: its handler is INDEX 0 in its table; page island: also INDEX 0 in its
  // own table — the exact same-numeric-index collision that double-fired in 1.0.2.
  const shell = await clientRender(
    `<button id="menu" (click)="openModal()">menu</button><div class="content" id="slot"></div>`,
    "sShell",
  );
  const page = await clientRender(`<button id="row" (click)="openRow()">row</button>`, "sPage");

  const pageHost = host("sPage", "org-page", "pageRoot", page.html);
  const doc = parseDoc(host("sShell", "app-shell", "shellRoot", shell.html.replace("</div>", pageHost + "</div>")));
  const row = doc.getElementById("row")!, menu = doc.getElementById("menu")!;

  // compile side: both markers carry their OWNER stamp, same numeric index.
  assertEquals(row.getAttribute("data-sprig-click"), "sPage:0");
  assertEquals(menu.getAttribute("data-sprig-click"), "sShell:0");

  const shellListen = listener(doc.getElementById("shellRoot"), shell.handlers);
  const pageListen = listener(doc.getElementById("pageRoot"), page.handlers);

  // a click on the page row bubbles to BOTH listeners; only the page's resolves.
  assertEquals(shellListen(row).length, 0, "the wrapping shell must NOT fire its handler 0 for the child's element");
  const fired = pageListen(row);
  assertEquals(fired.length, 1, "exactly the child island's handler fires");
  assertEquals(fired[0], page.handlers[0]);

  // the shell's own element still dispatches to the shell (and never to the page).
  assertEquals(shellListen(menu), [shell.handlers[0]]);
  assertEquals(pageListen(menu).length, 0, "outside the page island's root → not its event");
});

// ─── 2. live island under a static parent ───
Deno.test("spec §1 test 2: island under a static parent — a stamped static ancestor is never a dispatch root", async () => {
  const isle = await clientRender(`<button id="go" (click)="go()">go</button>`, "sIsle");
  // the static parent's elements carry ITS scope stamp (unconditional stamping) but a
  // static component registers NO handler table — it is never an island root.
  const doc = parseDoc(
    `<div sFrame class="frame" id="frame">${host("sIsle", "the-isle", "isleRoot", isle.html)}</div>`,
  );
  const go = doc.getElementById("go")!;

  assertEquals(asEl(nearestIslandRoot(asEl(go))), asEl(doc.getElementById("isleRoot")), "the walk finds the island, not the stamped static wrapper");
  assertEquals(listener(doc.getElementById("isleRoot"), isle.handlers)(go), [isle.handlers[0]]);
});

// ─── 3. static child content inside a live island: bubbling to the bound container works ───
Deno.test("spec §1 test 3: static child inside a live island — bubbles to the island's bound container", async () => {
  const infoCard: ComponentDef = {
    selector: "info-card",
    template: await parseTemplate(`<span class="hint" id="hint">hint</span>`),
    scope: "sChild",
  };
  const isle = await clientRender(
    `<div id="box" (click)="boxClick()"><info-card></info-card></div>`,
    "sIsland",
    [infoCard],
  );
  // the static child's span carries the CHILD's stamp; the bound container the island's.
  assertStringIncludes(isle.html, "<span sChild");
  assertStringIncludes(isle.html, `data-sprig-click="sIsland:0"`);
  // static components register no tables: the child contributed nothing of its own —
  // the ONE handler lives in the host island instance's table.
  assertEquals(isle.handlers.length, 1);

  const doc = parseDoc(host("sIsland", "an-island", "isleRoot", isle.html));
  const hint = doc.getElementById("hint")!;
  const fired = listener(doc.getElementById("isleRoot"), isle.handlers)(hint);
  assertEquals(fired, [isle.handlers[0]], "a click on unbound static content still reaches the island's bound container");
});

Deno.test("spec §1: a binding the PARENT template authors on a child's root tag is owned by the parent stamp", async () => {
  // <info-card (click)=…> — the marker lands on the child's root element (which carries
  // the CHILD's scope attribute), but the owner stamp is the AUTHORING template's. This
  // is the multi-scope-attribute case §1 calls out: the dispatch attribute identifies
  // its owner unambiguously regardless of what else sits on the element.
  const infoCard: ComponentDef = {
    selector: "info-card",
    template: await parseTemplate(`<span class="hint">hint</span>`),
    scope: "sChild",
  };
  const isle = await clientRender(`<info-card (click)="cardClick()"></info-card>`, "sIsland", [infoCard]);
  assertStringIncludes(isle.html, "sChild", "child root keeps its own scope stamp");
  assertStringIncludes(isle.html, `data-sprig-click="sIsland:0"`, "…but the marker's owner is the authoring (parent) template");
  assertEquals(isle.handlers[0].owner, "sIsland");
});

// ─── 4. two instances of the SAME component: siblings AND nested (identical stamps) ───
Deno.test("spec §1 test 4: two SIBLING instances of one component — each fires only its own handler", async () => {
  const widgetTpl = `<button class="w" id="ID" (click)="inc()">+</button>`;
  const a = await clientRender(widgetTpl.replace("ID", "btnA"), "sWidget");
  const b = await clientRender(widgetTpl.replace("ID", "btnB"), "sWidget");
  assertEquals(parseDoc(a.html).getElementById("btnA")!.getAttribute("data-sprig-click"), "sWidget:0", "identical stamp + index on both instances");

  const doc = parseDoc(
    `<div>${host("sWidget", "the-widget", "wA", a.html)}${host("sWidget", "the-widget", "wB", b.html)}</div>`,
  );
  const listenA = listener(doc.getElementById("wA"), a.handlers);
  const listenB = listener(doc.getElementById("wB"), b.handlers);
  const btnA = doc.getElementById("btnA")!, btnB = doc.getElementById("btnB")!;

  assertEquals(listenA(btnA), [a.handlers[0]]);
  assertEquals(listenB(btnA).length, 0, "the sibling's root doesn't contain this element");
  assertEquals(listenB(btnB), [b.handlers[0]]);
  assertEquals(listenA(btnB).length, 0);
});

Deno.test("spec §1 test 4 (recursive): two NESTED instances of one component — nearest root wins, not the stamp", async () => {
  const outer = await clientRender(`<button id="btnOuter" (click)="inc()">+</button><div id="slot"></div>`, "sWidget");
  const inner = await clientRender(`<button id="btnInner" (click)="inc()">+</button>`, "sWidget");

  const innerHost = host("sWidget", "tree-node", "nodeInner", inner.html);
  const doc = parseDoc(host("sWidget", "tree-node", "nodeOuter", outer.html.replace("</div>", innerHost + "</div>")));
  const btnInner = doc.getElementById("btnInner")!, btnOuter = doc.getElementById("btnOuter")!;
  const listenOuter = listener(doc.getElementById("nodeOuter"), outer.handlers);
  const listenInner = listener(doc.getElementById("nodeInner"), inner.handlers);

  // both instances share the identical (stamp, index): the OUTER table WOULD resolve the
  // inner button's marker if consulted — proof the stamp alone cannot disambiguate…
  assertEquals(btnInner.getAttribute("data-sprig-click"), "sWidget:0");
  assertEquals(resolveHandlers("sWidget:0", outer.handlers, ev), [outer.handlers[0]]);

  // …so the nearest-root walk is what must keep it out: the bubbled event resolves ONLY
  // in the inner instance's table, and to the INNER instance's handler object.
  assertEquals(listenOuter(btnInner).length, 0, "the outer instance's identical (stamp, index) entry is never reached");
  const fired = listenInner(btnInner);
  assertEquals(fired.length, 1);
  assert(fired[0] === inner.handlers[0] && fired[0] !== outer.handlers[0], "the INNER instance's own handler fires");

  // the outer instance's own button still dispatches in the outer table only.
  assertEquals(listenOuter(btnOuter), [outer.handlers[0]]);
  assertEquals(listenInner(btnOuter).length, 0);
});

// ─── 5. owner-stamp / nearest-root mismatch (teleported content): clean miss + dev diagnostic ───
Deno.test("spec §1 test 5: teleported content — the lookup misses cleanly, no ancestor fallback, dev diagnostic", async () => {
  const outer = await clientRender(`<button id="tele" (click)="outerClick()">tele</button>`, "sOuter");
  const inner = await clientRender(`<button id="in" (click)="innerClick()">in</button>`, "sInner");

  // simulate the teleport: the OUTER-owned button now lives INSIDE the inner island.
  const doc = parseDoc(host(
    "sOuter",
    "outer-isle",
    "outerRoot",
    host("sInner", "inner-isle", "innerRoot", inner.html + outer.html),
  ));
  const tele = doc.getElementById("tele")!;
  assertEquals(tele.getAttribute("data-sprig-click"), "sOuter:0");
  const listenOuter = listener(doc.getElementById("outerRoot"), outer.handlers);
  const listenInner = listener(doc.getElementById("innerRoot"), inner.handlers);

  // the nearest root (inner) resolves — and MISSES: its table has no sOuter entry.
  const misses: string[] = [];
  const fired = listenInner(tele, (token) => misses.push(token));
  assertEquals(fired.length, 0, "no handler runs on a miss");
  assertEquals(misses, ["sOuter:0"], "the miss reports the element's owner token");

  // the outer island's table HOLDS the matching entry — but the walk stopped at the
  // nearest root, so it is never consulted (that fallthrough must not exist).
  assertEquals(resolveHandlers("sOuter:0", outer.handlers, ev), [outer.handlers[0]]);
  assertEquals(listenOuter(tele).length, 0, "an ancestor's table is never a fallback");

  // the dev-mode default diagnostic names the element and stamp; production stays silent.
  const warns: string[] = [];
  const origWarn = console.warn;
  console.warn = (...a: unknown[]) => warns.push(a.join(" "));
  try {
    setDevDiagnostics(false);
    listenInner(tele);
    assertEquals(warns.length, 0, "silent outside dev mode");
    setDevDiagnostics(true);
    listenInner(tele);
    assertEquals(warns.length, 1, "one warning per missed token in dev");
    assertStringIncludes(warns[0], "sOuter:0", "names the stamp token");
    assertStringIncludes(warns[0], "<button>", "names the element");
  } finally {
    console.warn = origWarn;
    setDevDiagnostics(false);
  }
});

Deno.test("spec §1: an unfilled index is a miss too; a bare (unstamped) legacy token still resolves", async () => {
  const inner = await clientRender(`<button (click)="innerClick()">in</button>`, "sInner");
  // stamped token pointing at an index the table never filled → miss, no throw.
  const misses: string[] = [];
  assertEquals(resolveHandlers("sInner:9", inner.handlers, ev, (t) => misses.push(t)).length, 0);
  assertEquals(misses, ["sInner:9"]);
  // a bare-index token (rendered with no component context — the pre-stamp format)
  // resolves without an owner check, keeping unstamped fragment renders working.
  assertEquals(resolveHandlers("0", inner.handlers, ev), [inner.handlers[0]]);
  // a modifier non-match is chord filtering, NOT a miss (no diagnostic).
  const chord = await clientRender(`<input (keyup.enter)="submit()">`, "sInner");
  const missed: string[] = [];
  assertEquals(resolveHandlers("sInner:0", chord.handlers, { key: "a" } as unknown as Event, (t) => missed.push(t)).length, 0);
  assertEquals(missed.length, 0);
});
