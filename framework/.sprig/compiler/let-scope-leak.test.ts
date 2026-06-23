// Regression lock for BUG L: @let declared inside a @switch case/@default body, a
// @defer block, or a @for @empty block must stay scoped to that view and NOT leak
// into the parent scope (mirrors renderIf/renderFor cloning their per-view scope).
import { assert, assertStringIncludes } from "@std/assert";
import { named, parseTemplate } from "./parse.ts";
import { renderNodes } from "./render.ts";
import type { Scope } from "./expr.ts";

// deno-lint-ignore no-explicit-any
async function renderSrc(src: string, scope: Scope, registry: any = { get: () => undefined }): Promise<string> {
  const root = await parseTemplate(src);
  return renderNodes(named(root), { scope, registry, source: root.text });
}

Deno.test("bug L: @let inside a @switch @case must NOT leak into trailing siblings", async () => {
  const out = await renderSrc(
    `@switch (s) { @case ('a') { @let x = 99; <p>{{ x }}</p> } } <span>{{ x }}</span>`,
    { s: "a" },
  );
  // the body sees its own @let
  assertStringIncludes(out, "<p>99</p>");
  // the trailing sibling must NOT see the case-local @let
  assert(/<span><\/span>/.test(out), `trailing <span> must be empty, got: ${out}`);
});

Deno.test("bug L: @let inside a @switch @default must NOT leak into trailing siblings", async () => {
  const out = await renderSrc(
    `@switch (s) { @default { @let y = 7; <p>{{ y }}</p> } } <span>{{ y }}</span>`,
    { s: "zzz" },
  );
  assertStringIncludes(out, "<p>7</p>");
  assert(/<span><\/span>/.test(out), `trailing <span> must be empty, got: ${out}`);
});

Deno.test("bug L: @let inside a @defer block must NOT leak into trailing siblings", async () => {
  const out = await renderSrc(
    `@defer { @let z = 5; <p>{{ z }}</p> } <span>{{ z }}</span>`,
    {},
  );
  assertStringIncludes(out, "<p>5</p>");
  assert(/<span><\/span>/.test(out), `trailing <span> must be empty, got: ${out}`);
});

Deno.test("bug L: @let inside a @for @empty block must NOT leak into trailing siblings", async () => {
  const out = await renderSrc(
    `@for (item of xs; track item) { <li>{{ item }}</li> } @empty { @let w = 42; <b>{{ w }}</b> } <span>{{ w }}</span>`,
    { xs: [] },
  );
  assertStringIncludes(out, "<b>42</b>");
  assert(/<span><\/span>/.test(out), `trailing <span> must be empty, got: ${out}`);
});
