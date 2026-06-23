import { assertEquals } from "@std/assert";
import { field, named, parseTemplate } from "./parse.ts";
import { evalExpr } from "./expr.ts";

async function expr(src: string) {
  const root = await parseTemplate(`{{ ${src} }}`);
  const interp = named(root).find((n) => n.type === "interpolation")!;
  return field(interp, "expression");
}

// A lone high surrogate is a UTF-16 code unit in 0xD800..0xDBFF that is NOT
// immediately followed by a low surrogate (0xDC00..0xDFFF). truncate must never
// emit one — that means it split an astral-plane code point mid-pair (mojibake).
function hasLoneHighSurrogate(s: string): boolean {
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i);
    if (c >= 0xd800 && c <= 0xdbff) {
      const next = s.charCodeAt(i + 1);
      if (!(next >= 0xdc00 && next <= 0xdfff)) return true;
    }
  }
  return false;
}

// BUG Y — truncate must count by code POINT (like the titlecase pipe), never by
// UTF-16 code unit, so it can't slice an astral-plane surrogate pair in half.
Deno.test("BUG Y: truncate does not split astral surrogate pairs", async () => {
  const e = await expr("s | truncate:3");
  // 3 grinning-face emoji (each a surrogate pair) + "X"
  const s = "\u{1F600}\u{1F600}\u{1F600}X";
  const out = evalExpr(e, { s }) as string;
  // Must be the 3 emoji + ellipsis, with NO mojibake lone surrogate.
  assertEquals(hasLoneHighSurrogate(out), false, `lone high surrogate in: ${JSON.stringify(out)}`);
  assertEquals(out, "\u{1F600}\u{1F600}\u{1F600}…");
});

// The round-2 negative/zero clamp and basic ASCII behavior must STAY green.
Deno.test("BUG Y: truncate keeps clamp + ASCII behavior", async () => {
  const neg = evalExpr(await expr("s | truncate:-2"), { s: "hello" });
  assertEquals(neg, "hello"); // negative limit → full string
  const pos = evalExpr(await expr("s | truncate:3"), { s: "hello" });
  assertEquals(pos, "hel…");
});
