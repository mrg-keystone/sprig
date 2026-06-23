import { assert } from "@std/assert";
import { named, parseTemplate } from "./parse.ts";
import { clearStaticCache, type ComponentDef, renderNodes, type RenderOpts } from "./render.ts";

async function leaf(selector: string, scope: string, html: string): Promise<ComponentDef> {
  return { selector, scope, template: await parseTemplate(html) } as ComponentDef;
}
async function renderVia(def: ComponentDef): Promise<string> {
  const registry = { get: (s: string) => (s === def.selector ? def : undefined) };
  const root = await parseTemplate(`<${def.selector}></${def.selector}>`);
  return renderNodes(named(root), { scope: {}, registry, source: root.text } as unknown as RenderOpts);
}

// BUG (workflow state-1) — the static-leaf HTML cache is a MODULE-GLOBAL Map whose key
// (selector + scope id + inputs) had no per-renderer identity. Two renderers with a
// same-name leaf at the SAME relDir (→ same scope id) but DIFFERENT template content
// collided on one key, so the second renderer served the FIRST's markup. Namespacing
// the key by ComponentDef identity isolates renderers.
Deno.test("static-leaf cache is namespaced per ComponentDef (no cross-renderer leak)", async () => {
  clearStaticCache();
  const a = await leaf("badge", "sbadge", "<span>APP-A</span>");
  const b = await leaf("badge", "sbadge", "<span>APP-B</span>"); // same selector+scope, different content
  const outA = await renderVia(a);
  const outB = await renderVia(b);
  assert(outA.includes("APP-A"), `renderer A renders A, got ${outA}`);
  assert(outB.includes("APP-B"), `renderer B must render B, not a cross-def cache hit, got ${outB}`);
});
