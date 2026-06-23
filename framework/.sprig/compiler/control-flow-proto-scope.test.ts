import { assertEquals } from "@std/assert";
import { named, parseTemplate } from "./parse.ts";
import { renderNodes, type RenderOpts } from "./render.ts";

const registry = { get: () => undefined };

// A class-based scope: greet() lives on the PROTOTYPE, not as an own property —
// exactly like a class-component / class-island instance.
class Logic {
  name = "World";
  greet() { return "Hi-" + this.name; }
}

async function render(src: string, scope: unknown): Promise<string> {
  const root = await parseTemplate(src);
  return renderNodes(named(root), { scope, registry, source: root.text } as unknown as RenderOpts);
}

// BUG (cross-model lens Q1) — the SAME prototype-stripping bug as the already-fixed
// bug AK (resolveIslands) and evalStatement: the control-flow render helpers cloned
// the view scope with `{...opts.scope}` (own props only), so a class-instance scope
// lost its prototype methods INSIDE the block → a method call rendered EMPTY.
Deno.test("control-flow blocks preserve a class-instance scope's prototype methods", async () => {
  // control: a bare interpolation already renders correctly (uses opts.scope directly)
  assertEquals(await render("<div>{{ greet() }}</div>", new Logic()), "<div>Hi-World</div>");

  assertEquals(
    await render("<div>@if (ok) {{{ greet() }}}</div>", Object.assign(new Logic(), { ok: true })),
    "<div>Hi-World</div>",
  );
  assertEquals(
    await render("<div>@for (x of xs; track x) {{{ greet() }}}</div>", Object.assign(new Logic(), { xs: [1] })),
    "<div>Hi-World</div>",
  );
  assertEquals(
    await render("<div>@switch (k) { @case (1) {{{ greet() }}} }</div>", Object.assign(new Logic(), { k: 1 })),
    "<div>Hi-World</div>",
  );
  assertEquals(
    await render("<div>@defer {{{ greet() }}}</div>", new Logic()),
    "<div>Hi-World</div>",
  );
});
