// Regression locks for the CSS view-encapsulation leak bugs in scope.ts.
//
// The module's central contract (scope.ts:5-6): a component's styles can only
// land on its own elements — they must NEVER leak to another component. These
// tests prove two ways the old scopeCss broke that contract for valid Angular
// CSS, and that the host/host-context/global behaviour the compiler relies on
// is otherwise unchanged.

import { assert, assertEquals } from "@std/assert";
import { DOMParser } from "jsr:@b-fuze/deno-dom";
import { scopeCss } from "./scope.ts";

const s = (css: string) => scopeCss(css, "sX").replace(/\s+/g, " ").trim();

// Pull the prelude (everything before the first `{`) out of a scoped rule.
function prelude(css: string): string {
  return css.slice(0, css.indexOf("{")).trim();
}

// Every top-level (comma-separated) selector member must carry the scope marker
// "sX" on a real compound — otherwise it is an UNSCOPED global selector that
// leaks document-wide. (:global() members are intentionally unscoped, but none
// of these cases use :global.)
function assertEveryMemberScoped(sel: string) {
  for (const member of splitTopComma(sel)) {
    assert(
      member.includes("sX"),
      `top-level selector member "${member.trim()}" has no scope marker (leaks globally) — full selector: ${sel}`,
    );
  }
}

function splitTopComma(s: string): string[] {
  const out: string[] = [];
  let dp = 0, last = 0;
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (c === "(") dp++;
    else if (c === ")") dp--;
    else if (c === "," && dp === 0) { out.push(s.slice(last, i)); last = i + 1; }
  }
  out.push(s.slice(last));
  return out;
}

// BUG T (HIGH) — a comma-list inside :host() must NOT leak a bare global member.
Deno.test("scope: :host(.a, .b) scopes BOTH members (no bare global leak)", () => {
  const out = s(":host(.a, .b) { color:red }");
  assertEveryMemberScoped(prelude(out));
  // each member is a fully scoped host compound
  assertEquals(out, "[sX].a, [sX].b { color:red }");
});

Deno.test("scope: :host(.a, .b) .desc scopes every member's key compound", () => {
  const out = s(":host(.a, .b) .desc { color:red }");
  assertEveryMemberScoped(prelude(out));
});

Deno.test("scope: :host-context(.a, .b) .x distributes the ancestor list, no bare member", () => {
  const out = s(":host-context(.a, .b) .x { color:red }");
  assertEveryMemberScoped(prelude(out));
});

// BUG T — PROVE the leak is gone with a real CSS selector engine. The old
// output ".b" (bare) matched a foreign element that carries no scope marker.
Deno.test("scope: :host(.a, .b) rule does NOT match a foreign .b element", () => {
  const out = s(":host(.a, .b) { color:red }");
  const sel = prelude(out);
  const doc = new DOMParser().parseFromString(
    `<html><body>` +
      `<div class="a b" sX id="own"></div>` +
      `<div class="b" id="foreign"></div>` +
      `</body></html>`,
    "text/html",
  )!;
  const matchedIds = Array.from(doc.querySelectorAll(sel)).map((el) => el.getAttribute("id"));
  // the scoped rule must NOT select the foreign (unmarked) .b element
  assert(
    !matchedIds.includes("foreign"),
    `scoped selector "${sel}" leaked onto #foreign (a .b element from another component); matched=${JSON.stringify(matchedIds)}`,
  );
  // sanity: it still selects our own marked element
  assert(
    matchedIds.includes("own"),
    `scoped selector "${sel}" failed to match its own [sX] .a.b element; matched=${JSON.stringify(matchedIds)}`,
  );
});

// BUG U (MED) — chained :host-context must collect both as an ancestor chain,
// not interleave garbled tokens.
Deno.test("scope: chained :host-context collects an ancestor chain that actually matches", () => {
  const out = s(":host-context(.a):host-context(.b) .x { color:red }");
  assertEveryMemberScoped(prelude(out));
  const sel = prelude(out);
  const doc = new DOMParser().parseFromString(
    `<html><body>` +
      // host (sX) has BOTH an .a and a .b ancestor, and contains a .x descendant.
      // The .x is part of the host's own template, so it carries the marker too.
      `<div class="a"><div class="b"><div sX id="host">` +
      `<span class="x" sX id="target"></span>` +
      `</div></div></div>` +
      `</body></html>`,
    "text/html",
  )!;
  const matchedIds = Array.from(doc.querySelectorAll(sel)).map((el) => el.getAttribute("id"));
  assert(
    matchedIds.includes("target"),
    `chained :host-context selector "${sel}" did not match the .x inside an [sX] host with .a and .b ancestors (collapsed to a non-matching selector); matched=${JSON.stringify(matchedIds)}`,
  );
});

// Re-lock the EXISTING :host / :host-context / :global behaviour the compiler
// relies on — these outputs MUST stay byte-for-byte unchanged.
Deno.test("scope: existing :host / :global / single-member behaviour unchanged", () => {
  assertEquals(s(":host { x: 1 }"), "[sX] { x: 1 }");
  assertEquals(s(":host(.on) { x: 1 }"), "[sX].on { x: 1 }");
  assertEquals(s(":host(.on) .x { x: 1 }"), "[sX].on .x[sX] { x: 1 }");
  assertEquals(s(":host .x { x: 1 }"), "[sX] .x[sX] { x: 1 }");
  assertEquals(s(":host-context(.a) .x { x: 1 }"), ".a [sX] .x[sX] { x: 1 }");
  assertEquals(s(":host-context(.a) { x: 1 }"), ".a [sX] { x: 1 }");
  assertEquals(s(":global(.x) .b { c: 1 }"), ".x .b[sX] { c: 1 }");
  assertEquals(s(".a, .b { x: 1 }"), ".a[sX], .b[sX] { x: 1 }");
  assertEquals(s(".a .b { x: 1 }"), ".a .b[sX] { x: 1 }");
});
