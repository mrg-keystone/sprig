// Spine test for the sprig UI composition: boots serveSprig (the isolate keep
// server + the sprig app) and drives the single-origin handler. Proves SSR of the
// workbench + gallery, the in-process discovery, and the /api/* network channel.
// Run: deno test -A app/spine.test.ts  (from the repo root).
import { assert, assertEquals, assertStringIncludes } from "@std/assert";
import handler from "../serve.ts";

const info = {
  remoteAddr: { transport: "tcp", hostname: "127.0.0.1", port: 1 },
  completed: Promise.resolve(),
} as unknown as Deno.ServeHandlerInfo;

const get = (path: string) => handler.fetch(new Request("http://localhost" + path), info);
const post = (path: string, body: unknown) =>
  handler.fetch(
    new Request("http://localhost" + path, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    }),
    info,
  );

Deno.test("SSR /ui → 200, workbench shell rendered with discovery data", async () => {
  const res = await get("/ui");
  assertEquals(res.status, 200);
  const html = await res.text();
  assertStringIncludes(html, 'id="app"'); // shell root
  assertStringIncludes(html, "isolate"); // brand
  assertStringIncludes(html, 'class="topbar"');
  assertStringIncludes(html, 'data-sel="workbench"'); // the island is mounted
  assertStringIncludes(html, "sb-case__label"); // discovery populated the navigator
});

Deno.test("SSR /ui/components → 200, gallery rendered with run-tests islands", async () => {
  const res = await get("/ui/components");
  assertEquals(res.status, 200);
  const html = await res.text();
  assertStringIncludes(html, "iso-gallery");
  assertStringIncludes(html, 'data-sel="run-tests"'); // per-case island embedded
});

Deno.test("network /api/* → keep handler reachable (post-test-run)", async () => {
  const res = await post("/api/http/post-test-run", { files: [] });
  assertEquals(res.status, 200);
  const j = await res.json();
  assertEquals(j.ok, true); // empty run: nothing to run, but the endpoint answered
  assert("testResults" in j);
});

Deno.test("unknown UI route → 404", async () => {
  const res = await get("/ui/does-not-exist");
  assertEquals(res.status, 404);
});
