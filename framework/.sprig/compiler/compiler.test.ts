import { assert, assertEquals, assertStringIncludes } from "@std/assert";
import { field, named, parseTemplate } from "./parse.ts";
import { evalExpr, type Scope } from "./expr.ts";
import { renderNodes } from "./render.ts";

// deno-lint-ignore no-explicit-any
async function renderSrc(src: string, scope: Scope, registry: any = { get: () => undefined }): Promise<string> {
  const root = await parseTemplate(src);
  return renderNodes(named(root), { scope, registry, source: root.text });
}

async function expr(src: string) {
  const root = await parseTemplate(`{{ ${src} }}`);
  const interp = named(root).find((n) => n.type === "interpolation")!;
  return field(interp, "expression");
}

Deno.test("expression evaluator", async () => {
  const scope: Scope = {
    name: "Ada",
    user: { first: "A", last: "B" },
    items: [1, 2, 3],
    price: 9.99,
    ratio: 0.1234,
    count: () => 5,
    today: "2026-06-20T14:30:00Z",
  };
  const e = async (s: string) => evalExpr(await expr(s), scope);

  assertEquals(await e("name"), "Ada");
  assertEquals(await e("user.first + ' ' + user.last"), "A B");
  assertEquals(await e("items.length"), 3);
  assertEquals(await e("count()"), 5);
  assertEquals(await e("count() * 2"), 10);
  assertEquals(await e("1 + 2 * 3"), 7);
  assertEquals(await e("name === 'Ada' ? 'yes' : 'no'"), "yes");
  assertEquals(await e("user?.first"), "A");
  assertEquals(await e("missing ?? 'fallback'"), "fallback");
  assertEquals(await e("items.reduce((s, i) => s + i, 0)"), 6);
  assertEquals(await e("items[1]"), 2);
  assertEquals(await e("!name"), false);
  assertEquals(await e("price | currency:'USD'"), "$9.99");
  assertEquals(await e("ratio | percent:'1.1-1'"), "12.3%");
  assertEquals(await e("name | uppercase"), "ADA");
  assertEquals(await e("$any(user).first"), "A");
});

Deno.test("renderer: interpolation + HTML-escaping", async () => {
  assertEquals(await renderSrc("<p>{{ a }}</p>", { a: "hi" }), "<p>hi</p>");
  assertEquals(await renderSrc("<p>{{ h }}</p>", { h: "<b>&" }), "<p>&lt;b&gt;&amp;</p>");
});

Deno.test("renderer: @if / @else", async () => {
  assertStringIncludes(await renderSrc("@if (ok) { <b>y</b> } @else { <i>n</i> }", { ok: true }), "<b>y</b>");
  assertStringIncludes(await renderSrc("@if (ok) { <b>y</b> } @else { <i>n</i> }", { ok: false }), "<i>n</i>");
});

Deno.test("renderer: @for with track + @empty + $index", async () => {
  const out = await renderSrc("<ul>@for (x of xs; track x; let i = $index) { <li>{{ i }}:{{ x }}</li> } @empty { <li>none</li> }</ul>", { xs: ["a", "b"] });
  assertStringIncludes(out, "<li>0:a</li>");
  assertStringIncludes(out, "<li>1:b</li>");
  assertStringIncludes(await renderSrc("@for (x of xs; track x) { <li>{{x}}</li> } @empty { <b>none</b> }", { xs: [] }), "<b>none</b>");
});

Deno.test("renderer: @switch", async () => {
  const t = (s: string) => renderSrc("@switch (s) { @case ('a') { <p>A</p> } @case ('b') { <p>B</p> } @default { <p>D</p> } }", { s });
  assertStringIncludes(await t("a"), "<p>A</p>");
  assertStringIncludes(await t("b"), "<p>B</p>");
  assertStringIncludes(await t("z"), "<p>D</p>");
});

Deno.test("renderer: bindings — [class.x], [class] map, [attr.x], [style.x], [innerHTML]", async () => {
  assertEquals(await renderSrc('<div [class.active]="on"></div>', { on: true }), '<div class="active"></div>');
  assertEquals(await renderSrc('<div [class.active]="on"></div>', { on: false }), "<div></div>");
  assertStringIncludes(await renderSrc('<div [class]="{ a: x, b: y }"></div>', { x: true, y: false }), 'class="a"');
  assertEquals(await renderSrc('<i [attr.data-id]="id"></i>', { id: "z9" }), '<i data-id="z9"></i>');
  assertEquals(await renderSrc('<i [style.color]="c"></i>', { c: "red" }), '<i style="color:red"></i>');
  assertEquals(await renderSrc('<i [style.width.px]="w"></i>', { w: 4 }), '<i style="width:4px"></i>');
  assertEquals(await renderSrc('<div [innerHTML]="h"></div>', { h: "<b>x</b>" }), "<div><b>x</b></div>");
  assertEquals(await renderSrc('<button [disabled]="d">x</button>', { d: true }), "<button disabled>x</button>");
});

Deno.test("renderer: events / two-way are ignored at SSR", async () => {
  assertEquals(await renderSrc('<button (click)="f()">x</button>', {}), "<button>x</button>");
});

import { fromSerialized, serialize } from "./serialize.ts";

Deno.test("serialize: JSON-AST roundtrip renders identically (no wasm on client)", async () => {
  const src = `<div class="x">@for (i of xs; track i) { <b [class.on]="i > 1">{{ i }}!</b> } @empty { <i>none</i> }</div>`;
  const wasmRoot = await parseTemplate(src);
  const reg = { get: () => undefined };
  const fromWasm = await renderNodes(named(wasmRoot), { scope: { xs: [1, 2, 3] }, registry: reg, source: wasmRoot.text });
  const json = JSON.parse(JSON.stringify(serialize(wasmRoot))); // prove JSON-safe
  const jsonRoot = fromSerialized(json);
  const fromJson = await renderNodes(named(jsonRoot), { scope: { xs: [1, 2, 3] }, registry: reg, source: jsonRoot.text });
  assertEquals(fromJson, fromWasm);
  assertStringIncludes(fromJson, '<b class="on">2!</b>');
});

Deno.test("renderer: content projection — <ng-content> select + default slot + <ng-container>", async () => {
  const cardTpl = await parseTemplate(
    `<div class="card"><header><ng-content select="[title]"></ng-content></header>` +
      `<main><ng-content></ng-content></main>` +
      `<footer><ng-content select="actions"></ng-content></footer></div>`,
  );
  const registry = {
    get: (s: string) => (s === "info-card" ? { selector: "info-card", template: cardTpl } : undefined),
  };
  const out = await renderSrc(
    `<info-card><h2 title>Heading</h2><p>body text</p><actions><button>OK</button></actions></info-card>`,
    {},
    registry,
  );
  // (the card's own elements carry its scope marker; projected nodes keep the parent's
  //  — undefined here — so the slot CONTENTS land in the right containers, marker-agnostic)
  assertStringIncludes(out, '<h2 title="">Heading</h2></header>'); // named slot [title] → in <header>
  assertStringIncludes(out, "<p>body text</p></main>"); // default slot = unmatched (the <p>) → in <main>
  assertStringIncludes(out, "<actions><button>OK</button></actions></footer>"); // named slot "actions" → in <footer>
  // <ng-container> renders children with no wrapper element
  assertEquals(await renderSrc("<ng-container><b>x</b></ng-container>", {}), "<b>x</b>");
});

Deno.test("renderer: <content> is the projection slot (preferred alias, self-closing <content/>)", async () => {
  // <content> behaves exactly like <ng-content> and may self-close.
  const boxTpl = await parseTemplate(
    `<div class="box"><header><content select="[title]"/></header><main><content/></main></div>`,
  );
  const registry = {
    get: (s: string) => (s === "x-box" ? { selector: "x-box", template: boxTpl } : undefined),
  };
  const out = await renderSrc(`<x-box><h2 title>Hi</h2><p>body</p></x-box>`, {}, registry);
  assertStringIncludes(out, '<h2 title="">Hi</h2></header>'); // [title] → named slot <content select> (self-closed)
  assertStringIncludes(out, "<p>body</p></main>"); // the unmatched <p> → default slot <content/>
});

Deno.test("renderer: <content>default</content> fallback shows when nothing is projected", async () => {
  const btnTpl = await parseTemplate(`<button class="b"><content>Click me</content></button>`);
  const registry = {
    get: (s: string) => (s === "x-btn" ? { selector: "x-btn", template: btnTpl } : undefined),
  };
  assertStringIncludes(await renderSrc(`<x-btn></x-btn>`, {}, registry), ">Click me</button>"); // empty → fallback
  assertStringIncludes(await renderSrc(`<x-btn>Save</x-btn>`, {}, registry), ">Save</button>"); // projected wins
});

import { scopeCss, scopeId } from "./scope.ts";

Deno.test("scope: scopeId is stable + deterministic", () => {
  assertEquals(scopeId("counter"), scopeId("counter"));
  assert(scopeId("counter") !== scopeId("star-rating"));
  assert(/^s[0-9a-f]{8}$/.test(scopeId("counter")));
});

Deno.test("scope: scopeCss scopes the key compound, leaves at-rules/keyframes/global alone", () => {
  const s = (css: string) => scopeCss(css, "sX").replace(/\s+/g, " ").trim();
  assertEquals(s(".btn { color: red }"), ".btn[sX] { color: red }");
  assertEquals(s(".a .b { x: 1 }"), ".a .b[sX] { x: 1 }"); // rightmost only
  assertEquals(s(".a > .b { x: 1 }"), ".a > .b[sX] { x: 1 }");
  assertEquals(s(".btn:hover { x: 1 }"), ".btn[sX]:hover { x: 1 }");
  assertEquals(s(".btn::before { x: 1 }"), ".btn[sX]::before { x: 1 }");
  assertEquals(s("div { x: 1 }"), "div[sX] { x: 1 }");
  assertEquals(s(".a, .b { x: 1 }"), ".a[sX], .b[sX] { x: 1 }");
  assertEquals(s(":host { x: 1 }"), "[sX] { x: 1 }");
  assertEquals(s(":host(.on) { x: 1 }"), "[sX].on { x: 1 }");
  assertStringIncludes(s("@media (min-width: 1px) { .a { x: 1 } }"), ".a[sX] { x: 1 }");
  // @keyframes percentage stops must NOT be scoped
  assertStringIncludes(s("@keyframes spin { 0% { x: 1 } 100% { x: 2 } }"), "0% { x: 1 }");
  assert(!s("@keyframes spin { 0% { x: 1 } }").includes("0%[sX]"));
  // :global escape hatch → unscoped
  assertEquals(s(":global(.x) .b { c: 1 }"), ".x .b[sX] { c: 1 }");
});

Deno.test("scope: encapsulation — component A's rule cannot match component B's same-named element", () => {
  const a = scopeId("comp-a"), b = scopeId("comp-b");
  const cssA = scopeCss(".label { color: red }", a); // → .label[sA]
  // a rule scoped to A targets only [sA]; B's element carries [sB] only
  assertStringIncludes(cssA, `.label[${a}]`);
  assert(!cssA.includes(`[${b}]`), "A's css never references B's scope");
});

Deno.test("scope: renderer emits the view-encapsulation marker on every native element", async () => {
  const root = await parseTemplate(`<div class="x"><span>hi</span></div>`);
  const out = renderNodes(named(root), { scope: {}, registry: { get: () => undefined }, source: root.text, scopeAttr: "s123" });
  assertStringIncludes(out, "<div s123"); // root carries the marker
  assertStringIncludes(out, "<span s123>hi</span>"); // and so does the child
  // without a scopeAttr, no marker is emitted (backwards-compatible)
  const bare = renderNodes(named(root), { scope: {}, registry: { get: () => undefined }, source: root.text });
  assert(!bare.includes("s123"));
});

import { dirname, join as joinPath } from "@std/path";
import { createRenderer } from "./mod.ts";

Deno.test("a page IS template + logic.ts: the class's onServerInit drives the render", async () => {
  const tmp = await Deno.makeTempDir({ prefix: "sprig-page-logic-" });
  try {
    const write = async (rel: string, body: string) => {
      const dir = joinPath(tmp, ...rel.split("/"));
      await Deno.mkdir(dirname(dir), { recursive: true });
      await Deno.writeTextFile(dir, body);
    };
    await write("shell/template.html", `<div><router-outlet></router-outlet></div>`);
    await write("pages/home/template.html", `<h1>Hello, {{ name }}</h1>`);
    await write(
      "pages/home/logic.ts",
      `export default class Home { name = "(loading)"; onServerInit() { this.name = "from-logic"; } }`,
    );
    const r = await createRenderer(tmp, "/ui", { dev: true });
    const html = await r.renderDocument("pages/home", {});
    assert(html.includes("from-logic"), "page logic.ts onServerInit data did not render");
    assert(!html.includes("(loading)"), "pre-onServerInit value leaked into the render");
  } finally {
    await Deno.remove(tmp, { recursive: true });
  }
});

import { computed as coreComputed, isSignal, signal as coreSignal } from "../core.ts";
import { onIslandMounted } from "./hydrate.ts";

Deno.test("isSignal: picks writable signals out of a scope (harness introspection)", () => {
  assertEquals(isSignal(coreSignal(0)), true); // writable signal → editable control
  assertEquals(isSignal(coreComputed(() => 1)), false); // computed is read-only
  assertEquals(isSignal(5), false);
  assertEquals(isSignal(() => 5), false); // a plain function is not a signal
  assertEquals(isSignal({ set: 1, signal: 2 }), false); // not callable
  // the preview harness can register a mount listener (no-op without a DOM here);
  // it returns an unsubscribe fn and replays past mounts (none here).
  assertEquals(typeof onIslandMounted, "function");
  const unsub = onIslandMounted(() => {});
  assertEquals(typeof unsub, "function");
  unsub();
});
