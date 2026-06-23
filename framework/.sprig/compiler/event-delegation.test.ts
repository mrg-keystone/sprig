// BUG A — event-delegation dispatch must reach EVERY same-base (event) binding.
// render.ts stamps multiple bindings that share one DOM base as a SPACE-JOINED index
// list, e.g. `data-sprig-keyup="0 1"` (see render.ts eventAttrs/elementAttrs + the
// contract comment "Multiple same-base bindings ... must ALL be reachable"). The old
// dispatch did `handlers[Number(marker)]`, and Number("0 1") === NaN → handlers[NaN]
// === undefined → the event was swallowed and NEITHER handler fired. resolveHandlers()
// must split the marker and return every listed handler whose modifiers match the
// event, mirroring addEventListener semantics. These tests drive the REAL render.ts
// client path to build the marker, then resolve it.
import { assertEquals } from "@std/assert";
import { named, parseTemplate } from "./parse.ts";
import { type Handler, renderNodes } from "./render.ts";
import { resolveHandlers } from "./hydrate.ts";

/** Render a template in CLIENT mode and return the collected handlers + the
 *  `data-sprig-<base>` marker the renderer stamped on the (single) element. */
async function clientRender(src: string, base: string): Promise<{ handlers: Handler[]; marker: string }> {
  const root = await parseTemplate(src);
  const handlers: Handler[] = [];
  const html = renderNodes(named(root), { scope: {}, registry: { get: () => undefined }, source: root.text, handlers });
  const m = html.match(new RegExp(`data-sprig-${base}="([^"]*)"`));
  return { handlers, marker: m ? m[1] : "" };
}

// a minimal stand-in for a KeyboardEvent — keyMatches only reads .key + modifier flags.
function keyEvent(key: string): Event {
  return { key } as unknown as Event;
}

Deno.test("BUG A: two same-base bindings — the matching modifier handler is reachable", async () => {
  // <input (keyup.enter)="submit()" (keyup.escape)="cancel()"> → marker "0 1"
  const { handlers, marker } = await clientRender(
    `<input (keyup.enter)="submit()" (keyup.escape)="cancel()">`,
    "keyup",
  );
  assertEquals(marker, "0 1", "render.ts space-joins the two same-base indices");
  assertEquals(handlers.length, 2);

  // pressing Enter must reach handler 0 (the .enter binding). Before the fix,
  // Number("0 1") === NaN → handlers[NaN] === undefined → [] (the enter handler was lost).
  const onEnter = resolveHandlers(marker, handlers, keyEvent("Enter"));
  assertEquals(onEnter.length, 1, "Enter resolves exactly the .enter handler");
  assertEquals(onEnter[0], handlers[0]);

  // pressing Escape must reach handler 1 (the .escape binding) — also lost before the fix.
  const onEsc = resolveHandlers(marker, handlers, keyEvent("Escape"));
  assertEquals(onEsc.length, 1, "Escape resolves exactly the .escape handler");
  assertEquals(onEsc[0], handlers[1]);
});

Deno.test("BUG A: two same-base unmodified bindings BOTH fire (addEventListener semantics)", async () => {
  // two plain (click) bindings on one element → marker "0 1"; both must dispatch.
  const { handlers, marker } = await clientRender(
    `<button (click)="a()" (click)="b()">go</button>`,
    "click",
  );
  assertEquals(marker, "0 1");
  assertEquals(handlers.length, 2);

  // Before the fix: Number("0 1") === NaN → handlers[NaN] === undefined → [] (NEITHER fired).
  const fired = resolveHandlers(marker, handlers, {} as Event);
  assertEquals(fired.length, 2, "both same-base handlers fire");
  assertEquals(fired[0], handlers[0]);
  assertEquals(fired[1], handlers[1]);
});

Deno.test("BUG A: single-handler marker path is unchanged", async () => {
  const { handlers, marker } = await clientRender(`<button (click)="a()">go</button>`, "click");
  assertEquals(marker, "0");
  const fired = resolveHandlers(marker, handlers, {} as Event);
  assertEquals(fired.length, 1);
  assertEquals(fired[0], handlers[0]);
});
