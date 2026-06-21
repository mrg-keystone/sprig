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

import { assertRejects } from "@std/assert";
import { join as joinPath } from "@std/path";
import { assertStaticPage } from "./mod.ts";

Deno.test("gate: a page (folder directly under pages/) cannot be an island", async () => {
  const tmp = await Deno.makeTempDir({ prefix: "sprig-gate-" });
  try {
    const mk = async (rel: string, logic = false) => {
      const dir = joinPath(tmp, ...rel.split("/"));
      await Deno.mkdir(dir, { recursive: true });
      if (logic) await Deno.writeTextFile(joinPath(dir, "logic.ts"), "export default {};");
      return dir;
    };
    // a page WITH logic.ts → rejected
    const pageIsland = await mk("pages/settings", true);
    await assertRejects(() => assertStaticPage(pageIsland), Error, "cannot be an island");
    // a static page → allowed
    await assertStaticPage(await mk("pages/about"));
    // a PAGE-LOCAL component (under pages/<page>/components/) → island allowed
    await assertStaticPage(await mk("pages/settings/components/toggle", true));
    // a shared-component island → allowed
    await assertStaticPage(await mk("shared-components/counter", true));
  } finally {
    await Deno.remove(tmp, { recursive: true });
  }
});
