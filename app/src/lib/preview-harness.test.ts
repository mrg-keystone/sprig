// Targeted-control DOM read/write: must prefer the LIVE property over the attribute so
// non-boolean controls (an input's value, a checkbox's checked) reflect immediately —
// not just boolean `disabled`. (Regression lock for the per-instance-controls gap.)
import { assertEquals } from "jsr:@std/assert";
import { readDomControl, writeDomControl } from "./preview-harness.ts";

// a minimal Element stand-in: own props are "live properties" (`key in el` is true),
// everything else routes through the attribute map.
function fakeEl(props: Record<string, unknown> = {}): Element {
  const attrs = new Map<string, string>();
  // deno-lint-ignore no-explicit-any
  const el: any = {
    ...props,
    hasAttribute: (k: string) => attrs.has(k),
    getAttribute: (k: string) => (attrs.has(k) ? attrs.get(k)! : null),
    setAttribute: (k: string, v: string) => attrs.set(k, v),
    removeAttribute: (k: string) => attrs.delete(k),
  };
  return el as Element;
}

Deno.test("boolean control writes/reads the live .disabled property", () => {
  const btn = fakeEl({ disabled: false });
  assertEquals(readDomControl(btn, "disabled", { type: "boolean" }), false);
  writeDomControl(btn, "disabled", true);
  assertEquals((btn as unknown as { disabled: boolean }).disabled, true);
  assertEquals(readDomControl(btn, "disabled", { type: "boolean" }), true);
  writeDomControl(btn, "disabled", false);
  assertEquals(readDomControl(btn, "disabled", { type: "boolean" }), false);
});

Deno.test("text control writes the live .value (the old bug: attribute didn't reflect)", () => {
  const input = fakeEl({ value: "" });
  writeDomControl(input, "value", "hello@example.com");
  assertEquals((input as unknown as { value: string }).value, "hello@example.com");
  assertEquals(readDomControl(input, "value", { type: "text" }), "hello@example.com");
});

Deno.test("checkbox control writes the live .checked property", () => {
  const box = fakeEl({ checked: false });
  writeDomControl(box, "checked", true);
  assertEquals((box as unknown as { checked: boolean }).checked, true);
  assertEquals(readDomControl(box, "checked", { type: "boolean" }), true);
});

Deno.test("number control coerces to a number", () => {
  const input = fakeEl({ value: "5" });
  assertEquals(readDomControl(input, "value", { type: "number" }), 5);
  writeDomControl(input, "value", 9);
  assertEquals(readDomControl(input, "value", { type: "number" }), 9);
});

Deno.test("a read-only property key falls back to setAttribute instead of throwing", () => {
  // a fixture typo could target a getter-only DOM property (tagName, parentElement);
  // writeDomControl must NOT crash applySet (which would skip publish) — best-effort.
  const el = fakeEl({});
  Object.defineProperty(el, "tagName", { get: () => "DIV", configurable: true });
  writeDomControl(el, "tagName", "SPAN"); // must not throw
  assertEquals((el as unknown as { tagName: string }).tagName, "DIV", "read-only prop unchanged");
  assertEquals(el.getAttribute("tagName"), "SPAN", "fell back to the attribute, no crash");
});

Deno.test("custom key with no matching property uses attributes", () => {
  const el = fakeEl({});
  writeDomControl(el, "aria-label", "Close");
  assertEquals(el.getAttribute("aria-label"), "Close");
  assertEquals(readDomControl(el, "aria-label", { type: "text" }), "Close");
  writeDomControl(el, "data-on", true);
  assertEquals(el.hasAttribute("data-on"), true);
  writeDomControl(el, "data-on", false);
  assertEquals(el.hasAttribute("data-on"), false);
});
