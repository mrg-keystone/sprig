// BUG Q (security): MAX_BODY_BYTES is documented as a BYTE cap but is enforced
// with `body.length` (UTF-16 code units). A multibyte JSON body (emoji = 2 UTF-16
// units but 4 UTF-8 bytes) can be ~2x the 4 MiB byte cap yet pass the guard.
//
// This test POSTs a JSON body whose UTF-16 .length is <= MAX_BODY_BYTES (4 MiB)
// but whose UTF-8 byteLength is > MAX_BODY_BYTES, through the serveSprig handler.
// CORRECT behavior: the gateway rejects it with 400. The buggy code forwards it
// to the stub keep (which answers 200).
import { assert, assertEquals } from "jsr:@std/assert";
import { serveSprig } from "./mod.ts";
import type { SprigApp } from "@mrg-keystone/sprig";

const MAX_BODY_BYTES = 4 * 1024 * 1024; // mirrors the (unexported) source constant

// a stub keep: backend is an in-process fetch; handler answers 200 for anything
// it actually receives — so a forwarded oversized body shows up as a 200.
function stubKeep() {
  return {
    backend: { fetch: () => Promise.resolve(new Response("{}", { status: 200 })) },
    handler: () => new Response("FORWARDED", { status: 200 }),
  };
}

const fakeApp: SprigApp = {
  fetch: () => Promise.resolve(new Response("SSR", { status: 200 })),
} as unknown as SprigApp;

Deno.test("BUG Q: a body over the BYTE cap (but under the UTF-16 length cap) is rejected 400", async () => {
  // 😀 (U+1F600): 2 UTF-16 code units, 4 UTF-8 bytes. Build a JSON string of N
  // emoji where UTF-16 length <= cap but UTF-8 bytes > cap.
  // Need: 2N + 2 (quotes) <= MAX_BODY_BYTES  AND  4N + 2 > MAX_BODY_BYTES.
  const emoji = "\u{1F600}";
  // N chosen near the midpoint: 1.5M emoji → UTF-16 len = 3,000,002 (<= 4,194,304),
  // UTF-8 bytes = 6,000,002 (> 4,194,304).
  const n = 1_500_000;
  const body = '"' + emoji.repeat(n) + '"';

  // sanity: this body is exactly the discrepancy the bug is about.
  assert(body.length <= MAX_BODY_BYTES, `UTF-16 length ${body.length} must be <= cap`);
  assert(
    new TextEncoder().encode(body).byteLength > MAX_BODY_BYTES,
    "UTF-8 byteLength must exceed cap",
  );

  const handler = serveSprig({ keep: stubKeep(), app: fakeApp });
  const req = new Request("http://host/api/echo", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body,
  });
  const res = await handler.fetch(req, {} as Deno.ServeHandlerInfo);
  assertEquals(res.status, 400, "oversized-by-bytes body must be rejected at the gateway");
});
