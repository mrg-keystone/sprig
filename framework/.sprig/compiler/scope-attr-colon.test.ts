// Regression lock for BUG AI in scope.ts.
//
// firstPseudo() placed the scope marker at the first ":" it found — but unlike
// its siblings (scopeKeyCompound/splitTop/matchParen) it did NOT track
// attribute-selector bracket depth. A namespaced attribute like [xlink:href] or
// [xml:lang] (valid CSS for SVG) contains a ":" INSIDE the brackets, so the
// marker was spliced INTO the attribute selector: [xlink:href] -> [xlink[sX]:href],
// which is invalid CSS. The whole rule is then dropped by the browser and the
// scoped style silently never applies — an encapsulation/correctness failure.
//
// The marker must land AFTER the full attribute selector: [xlink:href][sX].

import { assert, assertEquals } from "@std/assert";
import { DOMParser } from "jsr:@b-fuze/deno-dom";
import { scopeCss } from "./scope.ts";

const s = (css: string) => scopeCss(css, "sX").replace(/\s+/g, " ").trim();

// Pull the prelude (everything before the first `{`) out of a scoped rule.
function prelude(css: string): string {
  return css.slice(0, css.indexOf("{")).trim();
}

// A real CSS engine must accept the produced selector without throwing.
function assertValidSelector(sel: string) {
  const doc = new DOMParser().parseFromString(
    `<html><body></body></html>`,
    "text/html",
  )!;
  // deno-dom throws on an invalid selector; a valid one just yields no matches.
  doc.querySelectorAll(sel);
}

// BUG AI (LOW) — a namespaced attribute selector's inner ":" must NOT be treated
// as a pseudo introducer; the marker goes AFTER the whole [...] selector.
Deno.test("scope: namespaced attr [xlink:href] gets the marker AFTER the brackets", () => {
  const out = s("[xlink:href] { fill: red }");
  const sel = prelude(out);
  // the attribute selector survives intact, NOT split as [xlink[sX]:href]
  assert(
    sel.includes("[xlink:href]"),
    `attribute selector mangled — expected "[xlink:href]" intact, got "${sel}"`,
  );
  assert(
    !sel.includes("[xlink[sX]"),
    `marker was spliced INSIDE the brackets (invalid CSS): "${sel}"`,
  );
  assertEquals(sel, "[xlink:href][sX]");
  assertValidSelector(sel); // a real CSS engine must parse it
});

Deno.test("scope: namespaced attr [xml:lang] is scoped after the brackets", () => {
  const out = s("[xml:lang] { fill: red }");
  const sel = prelude(out);
  assertEquals(sel, "[xml:lang][sX]");
  assertValidSelector(sel);
});

// Common cases must stay green (real pseudos outside brackets still scope first).
Deno.test("scope: common pseudo/attr cases stay correct", () => {
  assertEquals(prelude(s(".a:hover { x: 1 }")), ".a[sX]:hover");
  assertEquals(prelude(s("[data-x]:hover { x: 1 }")), "[data-x][sX]:hover");
  assertEquals(prelude(s('input[type="text"]:focus { x: 1 }')), 'input[type="text"][sX]:focus');
});
