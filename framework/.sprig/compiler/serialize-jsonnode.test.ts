// Re-serializing a JsonNode must round-trip identically (dev/isolate re-serializes
// the prebuilt JsonNode template back to JSON before shipping the island AST).
import { assertEquals } from "@std/assert";
import { parseTemplate } from "./parse.ts";
import { fromSerialized, serialize } from "./serialize.ts";

Deno.test("serialize: re-serializing a JsonNode round-trips (does not yield an empty tree)", async () => {
  const s1 = serialize(await parseTemplate('<div class="a">Hello {{ name }}</div>'));
  const s2 = serialize(fromSerialized(s1));
  assertEquals(s2.root.c.length, s1.root.c.length); // currently 0 vs 1 (empty re-walk)
  assertEquals(s2, s1); // full round-trip identity
});
