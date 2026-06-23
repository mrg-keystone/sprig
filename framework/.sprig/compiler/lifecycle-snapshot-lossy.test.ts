import { assert, assertEquals } from "@std/assert";
import { snapshotOf } from "./lifecycle.ts";

// BUG (workflow lifecycle.ts) — isSerializable green-lit Set/Map because JSON.stringify
// doesn't THROW on them, but it produces a lossy "{}" — so a class-island field holding
// a Set/Map was snapshotted and restored as an empty object on the client (silent state
// corruption). Such fields must be DROPPED (kept at the constructor default) like NaN.
Deno.test("snapshotOf drops a lossy Set/Map field instead of snapshotting it as {}", () => {
  const snap = snapshotOf({ count: 3, tags: new Set(["a", "b"]), seen: new Map([["k", 1]]) });
  assertEquals(snap.count, 3, "plain fields still captured");
  assert(!("tags" in snap), "Set field dropped (JSON-lossy to {})");
  assert(!("seen" in snap), "Map field dropped (JSON-lossy to {})");
  // plain object / array data still round-trips unchanged
  const ok = snapshotOf({ o: { a: 1 }, a: [1, 2], s: "x" });
  assertEquals(ok.o, { a: 1 });
  assertEquals(ok.a, [1, 2]);
  assertEquals(ok.s, "x");
});
