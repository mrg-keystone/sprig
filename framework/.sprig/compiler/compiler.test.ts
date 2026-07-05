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
import { appName, isServerOnlyRouteLogic } from "./build.ts";

Deno.test("isServerOnlyRouteLogic: a COMMENT naming a browser hook doesn't count — only real code", () => {
  // the exact shape that shipped a phantom isl.health.js: onServerLoad + prose naming onBrowserLoad
  assert(isServerOnlyRouteLogic(`// onServerLoad + no onBrowserLoad → zero client JS\nexport default class { async onServerLoad() {} }`));
  assert(isServerOnlyRouteLogic(`/* uses no onBrowserInit at all */\nexport default class { async onServerLoad() {} }`));
  // a REAL browser hook → hydrates → NOT server-only
  assert(!isServerOnlyRouteLogic(`export default class { onServerLoad() {} onBrowserLoad() {} }`));
  // an island (Init hooks) is not a server-only route
  assert(!isServerOnlyRouteLogic(`export default class { onServerInit() {} onBrowserInit() {} }`));
  // no onServerLoad at all → not a server-only route
  assert(!isServerOnlyRouteLogic(`export default class { setup() {} }`));
});

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

Deno.test("a route names its server hook onServerLoad — sync + async both drive the render", async () => {
  const tmp = await Deno.makeTempDir({ prefix: "sprig-page-load-" });
  try {
    const write = async (rel: string, body: string) => {
      const dir = joinPath(tmp, ...rel.split("/"));
      await Deno.mkdir(dirname(dir), { recursive: true });
      await Deno.writeTextFile(dir, body);
    };
    await write("shell/template.html", `<div><router-outlet></router-outlet></div>`);
    await write("pages/sync/template.html", `<h1>{{ name }}</h1>`);
    await write("pages/sync/logic.ts", `export default class { name = "(loading)"; onServerLoad() { this.name = "sync-load"; } }`);
    await write("pages/async/template.html", `<h1>{{ name }}</h1>`);
    await write("pages/async/logic.ts", `export default class { name = "(loading)"; async onServerLoad() { await Promise.resolve(); this.name = "async-load"; } }`);
    const r = await createRenderer(tmp, "/ui", { dev: true });
    const sync = await r.renderDocument("pages/sync", {});
    assert(sync.includes("sync-load") && !sync.includes("(loading)"), "sync onServerLoad did not drive the render");
    const asyncHtml = await r.renderDocument("pages/async", {});
    assert(asyncHtml.includes("async-load") && !asyncHtml.includes("(loading)"), "async onServerLoad did not drive the render");
  } finally {
    await Deno.remove(tmp, { recursive: true });
  }
});

Deno.test("onServerLoad-only = server-only (no hydration boundary); adding onBrowserLoad hydrates", async () => {
  const tmp = await Deno.makeTempDir({ prefix: "sprig-serveronly-" });
  try {
    const write = async (rel: string, body: string) => {
      const dir = joinPath(tmp, ...rel.split("/"));
      await Deno.mkdir(dirname(dir), { recursive: true });
      await Deno.writeTextFile(dir, body);
    };
    await write("shell/template.html", `<div><router-outlet></router-outlet></div>`);
    // server-only route logic: onServerLoad, NO browser hook
    await write("pages/srv/template.html", `<h1>{{ name }}</h1>`);
    await write("pages/srv/logic.ts", `export default class { name = "(x)"; async onServerLoad() { this.name = "server-data"; } }`);
    // hybrid route logic: onServerLoad + onBrowserLoad
    await write("pages/hyb/template.html", `<h1>{{ name }}</h1>`);
    await write("pages/hyb/logic.ts", `export default class { name = "(x)"; async onServerLoad() { this.name = "hybrid-data"; } onBrowserLoad() {} }`);
    const r = await createRenderer(tmp, "/ui", { dev: true });
    const srv = await r.renderDocument("pages/srv", {});
    assert(srv.includes("server-data"), "onServerLoad data did not render");
    assert(!srv.includes("<sprig-island"), "server-only route logic must NOT emit a hydration boundary");
    assert(!srv.includes("sprig-props"), "server-only route logic must NOT serialize a state snapshot");
    const hyb = await r.renderDocument("pages/hyb", {});
    assert(hyb.includes("hybrid-data"), "hybrid onServerLoad data did not render");
    assert(hyb.includes("<sprig-island"), "onBrowserLoad route logic MUST hydrate (emit a boundary)");
  } finally {
    await Deno.remove(tmp, { recursive: true });
  }
});

Deno.test("route logic.ts onServerLoad receives the request ctx (url query + params + session)", async () => {
  const tmp = await Deno.makeTempDir({ prefix: "sprig-reqctx-" });
  try {
    const write = async (rel: string, body: string) => {
      const dir = joinPath(tmp, ...rel.split("/"));
      await Deno.mkdir(dirname(dir), { recursive: true });
      await Deno.writeTextFile(dir, body);
    };
    await write("shell/template.html", `<div><router-outlet></router-outlet></div>`);
    // a page whose server-only logic reads the query string, the route param, and the session —
    // exactly what calls/queue/embed need. onServerLoad(ctx) is the logic.ts twin of resolve({ url }).
    await write("pages/q/template.html", `<h1>{{ q }}</h1><p>{{ id }}</p><span>{{ who }}</span>`);
    await write(
      "pages/q/logic.ts",
      `export default class {
        q = ""; id = ""; who = "anon";
        onServerLoad(ctx) {
          this.q = ctx.url.searchParams.get("q") ?? "";
          this.id = ctx.params.id ?? "";
          this.who = ctx.session?.email ?? "anon";
        }
      }`,
    );
    const r = await createRenderer(tmp, "/ui", { dev: true });
    const html = await r.renderDocument("pages/q", {}, {
      reqCtx: { url: new URL("http://h/ui/q?q=hello"), params: { id: "42" }, session: { email: "a@b.com" } },
    });
    assert(html.includes(">hello</h1>"), "onServerLoad did not read ctx.url.searchParams");
    assert(html.includes(">42</p>"), "onServerLoad did not read ctx.params");
    assert(html.includes(">a@b.com</span>"), "onServerLoad did not read ctx.session");
    // null session → the page's own ?? fallback, not a crash
    const anon = await r.renderDocument("pages/q", {}, {
      reqCtx: { url: new URL("http://h/ui/q"), params: {}, session: null },
    });
    assert(anon.includes(">anon</span>"), "null session not handled by route logic");
  } finally {
    await Deno.remove(tmp, { recursive: true });
  }
});

Deno.test("documentHead: a route's meta.title becomes the <title> (leaf wins); default 'sprig'; escaped", async () => {
  const tmp = await Deno.makeTempDir({ prefix: "sprig-title-" });
  try {
    const write = async (rel: string, body: string) => {
      const dir = joinPath(tmp, ...rel.split("/"));
      await Deno.mkdir(dirname(dir), { recursive: true });
      await Deno.writeTextFile(dir, body);
    };
    await write("shell/template.html", `<div><router-outlet></router-outlet></div>`);
    await write("routers/app/template.html", `<div><router-outlet></router-outlet></div>`);
    await write("pages/home/template.html", `<h1>home</h1>`);
    const r = await createRenderer(tmp, "/ui", { dev: true });
    // no meta anywhere → the framework default
    assert((await r.renderDocument("pages/home", {})).includes("<title>sprig</title>"), "default title missing");
    // a route's meta.title overrides the default
    const titled = await r.renderDocument([{ load: "pages/home", meta: { title: "Alfred · Overview" } }], {});
    assert(titled.includes("<title>Alfred · Overview</title>"), "meta.title did not become <title>");
    assert(!titled.includes("<title>sprig</title>"), "default title leaked when meta.title set");
    // the LEAF's title wins over a parent layout's
    const nested = await r.renderDocument(
      [{ load: "routers/app", meta: { title: "Parent" } }, { load: "pages/home", meta: { title: "Leaf" } }],
      {},
    );
    assert(nested.includes("<title>Leaf</title>") && !nested.includes("Parent</title>"), "leaf title did not win");
    // escaped for <title> text content
    const esc = await r.renderDocument([{ load: "pages/home", meta: { title: "A & <b" } }], {});
    assert(esc.includes("<title>A &amp; &lt;b</title>"), "title not HTML-escaped");
  } finally {
    await Deno.remove(tmp, { recursive: true });
  }
});

Deno.test("documentHead: createRenderer({ favicon }) emits <link rel=icon>; absent → none", async () => {
  const tmp = await Deno.makeTempDir({ prefix: "sprig-favicon-" });
  try {
    const write = async (rel: string, body: string) => {
      const dir = joinPath(tmp, ...rel.split("/"));
      await Deno.mkdir(dirname(dir), { recursive: true });
      await Deno.writeTextFile(dir, body);
    };
    await write("shell/template.html", `<div><router-outlet></router-outlet></div>`);
    await write("pages/home/template.html", `<h1>home</h1>`);
    // configured → a <link rel="icon"> lands in the head
    const withIcon = await (await createRenderer(tmp, "/ui", { dev: true, favicon: "/favicon.svg" })).renderDocument("pages/home", {});
    assert(withIcon.includes(`<link rel="icon" href="/favicon.svg" />`), "favicon link missing when configured");
    // not configured → no icon link (back-compat: byte-identical head to before)
    const noIcon = await (await createRenderer(tmp, "/ui", { dev: true })).renderDocument("pages/home", {});
    assert(!noIcon.includes(`rel="icon"`), "favicon link leaked when not configured");
  } finally {
    await Deno.remove(tmp, { recursive: true });
  }
});

Deno.test("appName: workspace-root deno.json name, org-stripped (root wins over a member)", async () => {
  const tmp = await Deno.makeTempDir({ prefix: "sprig-appname-" });
  try {
    await Deno.writeTextFile(joinPath(tmp, "deno.json"), JSON.stringify({ name: "@app/alfred", workspace: ["./ui"] }));
    await Deno.mkdir(joinPath(tmp, "ui", "src"), { recursive: true });
    await Deno.writeTextFile(joinPath(tmp, "ui", "deno.json"), JSON.stringify({ name: "@app/ui" }));
    // the workspace root ("@app/alfred") wins over the nearer member ("@app/ui")
    assertEquals(await appName(joinPath(tmp, "ui", "src")), "alfred");
    // no named deno.json → undefined
    const bare = await Deno.makeTempDir();
    try {
      assertEquals(await appName(bare), undefined);
    } finally {
      await Deno.remove(bare, { recursive: true });
    }
  } finally {
    await Deno.remove(tmp, { recursive: true });
  }
});

Deno.test("bootstrap/head.html: app-owned head content is injected into the generated <head>", async () => {
  const tmp = await Deno.makeTempDir({ prefix: "sprig-apphead-" });
  try {
    const write = async (rel: string, body: string) => {
      const dir = joinPath(tmp, ...rel.split("/"));
      await Deno.mkdir(dirname(dir), { recursive: true });
      await Deno.writeTextFile(dir, body);
    };
    // a body-only shell (parseable) + a RAW head.html the app owns (fonts / meta / preconnects)
    await write("ui/bootstrap/template.html", `<div class="app-root"><router-outlet></router-outlet></div>`);
    await write("ui/bootstrap/head.html", `<link rel="preconnect" href="https://fonts.example" />\n  <meta name="theme-color" content="#0b0f14" />`);
    await write("ui/src/pages/home/template.html", `<h1>home</h1>`);
    const html = await (await createRenderer(joinPath(tmp, "ui", "src"), "/ui", { dev: true })).renderDocument("pages/home", {});
    // the app's head content landed inside the generated <head>
    assert(html.includes(`<link rel="preconnect" href="https://fonts.example" />`), "head.html preconnect not injected");
    assert(html.includes(`<meta name="theme-color" content="#0b0f14" />`), "head.html meta not injected");
    // still exactly one framework frame, with the asset links + the page
    assertEquals(html.match(/<head>/gi)?.length, 1, "double <head>");
    assert(html.includes("/ui/_assets/app.css"), "framework asset link missing");
    assert(html.includes(">home</h1>"), "page not rendered"); // scoped tag → match the text, not the bare tag
    // absent head.html → no injection, framework default (a body-only shell with no head.html)
    const bare = await Deno.makeTempDir({ prefix: "sprig-apphead-bare-" });
    try {
      await Deno.mkdir(joinPath(bare, "ui", "bootstrap"), { recursive: true });
      await Deno.writeTextFile(joinPath(bare, "ui", "bootstrap", "template.html"), `<div><router-outlet></router-outlet></div>`);
      await Deno.mkdir(joinPath(bare, "ui", "src", "pages", "home"), { recursive: true });
      await Deno.writeTextFile(joinPath(bare, "ui", "src", "pages", "home", "template.html"), `<h1>x</h1>`);
      const plain = await (await createRenderer(joinPath(bare, "ui", "src"), "/ui", { dev: true })).renderDocument("pages/home", {});
      assert(plain.includes("<title>sprig</title>"), "framework default head missing when no head.html");
      assert(!plain.includes("theme-color"), "phantom head content with no head.html");
    } finally {
      await Deno.remove(bare, { recursive: true });
    }
  } finally {
    await Deno.remove(tmp, { recursive: true });
  }
});

Deno.test("bootstrap/template.html owns the <head> inline — framework splits <head> from <body>", async () => {
  const tmp = await Deno.makeTempDir({ prefix: "sprig-shell-split-" });
  try {
    const write = async (rel: string, body: string) => {
      const dir = joinPath(tmp, ...rel.split("/"));
      await Deno.mkdir(dirname(dir), { recursive: true });
      await Deno.writeTextFile(dir, body);
    };
    // ONE combined file: a full document — <head> (favicon + meta) and <body> (app-root + outlet)
    await write(
      "ui/bootstrap/template.html",
      `<!DOCTYPE html>\n<html lang="en">\n<head>\n  <title>My Control Room</title>\n  <link rel="icon" href="/favicon.svg" />\n  <meta name="theme-color" content="#0b0f14" />\n</head>\n<body>\n  <div class="app-root"><router-outlet></router-outlet></div>\n</body>\n</html>`,
    );
    await write("ui/src/pages/home/template.html", `<h1>home</h1>`);
    // renders without a parse error even though the source is a full document (parser only sees <body>)
    const html = await (await createRenderer(joinPath(tmp, "ui", "src"), "/ui", { dev: true })).renderDocument("pages/home", {});
    // the app's <head> is AUTHORITATIVE — its title/favicon/meta are used verbatim
    assert(html.includes("<title>My Control Room</title>"), "template.html <title> not used");
    assert(!html.includes("<title>sprig</title>"), "framework default title leaked — the app owns the head");
    assert(html.includes(`<link rel="icon" href="/favicon.svg" />`), "favicon from template.html <head> not injected");
    assert(html.includes(`<meta name="theme-color" content="#0b0f14" />`), "meta from template.html <head> not injected");
    // the framework still injects its RUNTIME bits (built stylesheet, island loader) into that head
    assert(html.includes(`/_assets/app.css`), "framework runtime bits (app.css) not injected into the app head");
    // the <body> rendered — page into the outlet — with exactly one frame (no double <head>)
    assert(html.includes(">home</h1>"), "shell body / page did not render");
    assertEquals(html.match(/<head>/gi)?.length, 1, "double <head>");
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
