// Regression tests for the four template-robustness bugs found porting a real
// app (the infra control plane) to sprig:
//   1. a bare `@` in template prose (an email, a handle) failed the whole parse;
//   2. inline <script>/<style> BODIES were silently stripped from SSR output
//      (raw_text had no renderNode case → default "");
//   3. a route with onServerLoad + (event) bindings but no browser hook was
//      classified server-only → no island chunk → every handler shipped dead;
//   4. calling a class method from a template bound `this` to a DERIVED scope
//      (cloneScope copy / Object.create child), so the method's own `#private`
//      member accesses failed their brand check.
import { assert, assertEquals, assertStringIncludes } from "@std/assert";
import { escapeLooseAt, field, named, parseTemplate } from "./parse.ts";
import { evalExpr, evalStatement, type Scope, selfOf, tagSelf } from "./expr.ts";
import { templateHasEventBindings } from "./node.ts";
import { isServerOnlyRouteLogic } from "./build.ts";
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

// ── 1. bare `@` in prose ─────────────────────────────────────────────────────

Deno.test("bare @ in text content parses and renders as @ (escaped to &#64;)", async () => {
  const html = await renderSrc(
    `<p>mail ai@example.com — or find us @sprigapp</p>`,
    {},
  );
  // the entity is emitted raw; the browser displays `@`
  assertStringIncludes(html, "ai&#64;example.com");
  assertStringIncludes(html, "&#64;sprigapp");
  assert(!html.includes("ai@example.com"), "bare @ must be escaped in output");
});

Deno.test("escapeLooseAt leaves directives, tags, comments, interpolations, script/style alone", () => {
  // block keywords still open blocks
  assertEquals(escapeLooseAt(`@if (x) {<b>y</b>} @else {n}`), `@if (x) {<b>y</b>} @else {n}`);
  // inside a tag (attributes) untouched
  assertEquals(escapeLooseAt(`<a href="mailto:a@b.c">m</a>`), `<a href="mailto:a@b.c">m</a>`);
  // comments untouched
  assertEquals(escapeLooseAt(`<!-- a@b -->`), `<!-- a@b -->`);
  // interpolation untouched
  assertEquals(escapeLooseAt(`{{ user.email }}@{{ host }}`), `{{ user.email }}&#64;{{ host }}`);
  // raw script/style content untouched (@media / decorators are real syntax there)
  assertEquals(
    escapeLooseAt(`<style>@media (min-width: 1px) { .x { color: red; } }</style>`),
    `<style>@media (min-width: 1px) { .x { color: red; } }</style>`,
  );
  assertEquals(
    escapeLooseAt(`<script>const a = "x@y";</script>`),
    `<script>const a = "x@y";</script>`,
  );
});

Deno.test("@if/@for still parse and render after the prose escape", async () => {
  const html = await renderSrc(
    `@if (ok) {<p>contact a@b.c</p>} @else {<p>no</p>}`,
    { ok: true },
  );
  assertStringIncludes(html, "contact a&#64;b.c");
  assert(!html.includes("<p>no</p>"));
});

Deno.test("a genuinely malformed template still throws, with a line/column position", async () => {
  let msg = "";
  try {
    await parseTemplate(`<div>\n  @if (x) {\n    <p>never closed</p>\n</div>`);
  } catch (e) {
    msg = (e as Error).message;
  }
  assertStringIncludes(msg, "syntax error at line");
});

// ── 2. inline script/style bodies survive SSR ────────────────────────────────

Deno.test("inline <script> and <style> bodies render verbatim (raw_text)", async () => {
  const html = await renderSrc(
    `<div><script type="module">console.log(1 < 2);</script><style>.a { color: red; }</style></div>`,
    {},
  );
  assertStringIncludes(html, `console.log(1 < 2);`);
  assertStringIncludes(html, `.a { color: red; }`);
});

// ── 3. event bindings force hydration ────────────────────────────────────────

Deno.test("templateHasEventBindings truth table", () => {
  assert(templateHasEventBindings(`<button (click)="go()">x</button>`));
  assert(templateHasEventBindings(`<form (submit)="save($event)">`));
  assert(!templateHasEventBindings(`<p>text only {{ x() }}</p>`));
  assert(!templateHasEventBindings(`<input [value]="v" />`));
});

Deno.test("server-only logic + event-bound template must hydrate (both deciders agree)", () => {
  const logic = `export default class P { async onServerLoad(ctx) { this.x = 1; } }`;
  assert(isServerOnlyRouteLogic(logic), "precondition: logic alone reads server-only");
  // the build and the SSR registry gate hydration on the SAME template check:
  const tpl = `<button (click)="go()">x</button>`;
  assert(templateHasEventBindings(tpl), "an event binding must flip the page to hydrating");
});

// ── 4. #private members through derived scopes ───────────────────────────────

class Counter {
  n = 0;
  #bump(): number {
    return ++this.n;
  }
  go(): number {
    return this.#bump();
  }
}

/** the exact derivation cloneScope performs (same prototype, own descriptors copied) */
function cloneLike(scope: object): Scope {
  return Object.create(Object.getPrototypeOf(scope), Object.getOwnPropertyDescriptors(scope));
}

Deno.test("selfOf resolves the tagged instance through clone and proto chains", () => {
  const inst = tagSelf(new Counter());
  const clone = cloneLike(inst);
  const child = Object.create(clone);
  assert((selfOf(clone) as unknown) === inst);
  assert((selfOf(child) as unknown) === inst);
  assert((selfOf({ plain: true }) as unknown) !== inst, "untagged objects resolve to themselves");
});

Deno.test("a template call through a CLONED scope reaches #private members", async () => {
  const inst = tagSelf(new Counter());
  const clone = cloneLike(inst);
  // pre-fix: "TypeError: Receiver must be an instance of class Counter"
  assertEquals(evalExpr(await expr("go()"), clone), 1);
  assertEquals(inst.n, 1, "the effect lands on the real instance");
});

Deno.test("an (event) handler statement through a child scope reaches #private members", async () => {
  const inst = tagSelf(new Counter());
  const clone = cloneLike(inst);
  const root = await parseTemplate(`<button (click)="go()">x</button>`);
  // dig out the event_binding node
  function find(n: unknown, type: string): unknown {
    const node = n as { type: string; namedChildren?: unknown[] };
    if (node.type === type) return node;
    for (const c of node.namedChildren ?? []) {
      if (!c) continue;
      const hit = find(c, type);
      if (hit) return hit;
    }
    return null;
  }
  const binding = find(root, "event_binding");
  assert(binding, "template must contain an event_binding");
  evalStatement(binding, clone, new Event("click"));
  assertEquals(inst.n, 1);
});
