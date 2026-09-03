// (event) bindings on content PROJECTED through a STATIC wrapper must survive a client
// re-render. renderComponent's island branch threads `opts.handlers` into the child's
// renderNodes, but the static-child branch did not — so when a parent island re-rendered
// `<x-box><button (click)="inc()">…</button></x-box>` (x-box static, with <ng-content>),
// the projected <button> was rendered WITHOUT handlers, its `data-sprig-click` marker was
// never stamped, and the click was dropped client-side. These tests drive the real
// render.ts client path and assert the marker + the collected handler.
import { assert, assertEquals, assertMatch } from "@std/assert";
import { named, parseTemplate } from "./parse.ts";
import { type ComponentDef, type Handler, renderNodes } from "./render.ts";

async function staticDef(selector: string, src: string): Promise<ComponentDef> {
  return { selector, template: await parseTemplate(src), scope: `s-${selector}` };
}

async function clientRender(src: string, defs: ComponentDef[]): Promise<{ html: string; handlers: Handler[] }> {
  const root = await parseTemplate(src);
  const handlers: Handler[] = [];
  const registry = { get: (s: string) => defs.find((d) => d.selector === s) };
  const html = renderNodes(named(root), {
    scope: { inc: () => {} },
    registry,
    source: root.text,
    handlers,
    scopeAttr: "s-parent",
  });
  return { html, handlers };
}

Deno.test("(event) on content projected through a static wrapper is stamped + collected", async () => {
  const box = await staticDef("x-box", `<div class="box"><ng-content></ng-content></div>`);
  const { html, handlers } = await clientRender(
    `<x-box><button (click)="inc()">go</button></x-box>`,
    [box],
  );
  assertMatch(html, /<button[^>]*data-sprig-click="s-parent:0"/, "projected button carries the marker");
  assertEquals(handlers.length, 1);
  assertEquals(handlers[0].base, "click");
  assertEquals(handlers[0].owner, "s-parent", "the handler is owned by the projecting (parent) template");
});

Deno.test("(event) survives two nested static wrappers", async () => {
  // two static wrappers nested at the CALL SITE (a wrapper's own <ng-content> forwarded
  // into another wrapper's <ng-content> is a separate, pre-existing limitation).
  const outer = await staticDef("x-outer", `<section><ng-content></ng-content></section>`);
  const inner = await staticDef("x-inner", `<div><ng-content></ng-content></div>`);
  const { html, handlers } = await clientRender(
    `<x-outer><x-inner><a (click)="inc()">go</a></x-inner></x-outer>`,
    [outer, inner],
  );
  assert(/<a[^>]*data-sprig-click=/.test(html), "marker present through two static layers");
  assertEquals(handlers.length, 1);
});

Deno.test("SSR mode (no handlers) still stamps nothing", async () => {
  const box = await staticDef("x-box", `<div><ng-content></ng-content></div>`);
  const root = await parseTemplate(`<x-box><button (click)="inc()">go</button></x-box>`);
  const html = renderNodes(named(root), {
    scope: {},
    registry: { get: (s: string) => (s === "x-box" ? box : undefined) },
    source: root.text,
  });
  assert(!html.includes("data-sprig-click"), "server render never emits delegation markers");
});
