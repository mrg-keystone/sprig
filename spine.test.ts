// Integration spine + SSR: proves the whole composition through the real serve.ts
// — serveSprig dispatch, the in-process Backend reaching resolve.ts, AND the wasm
// template compiler rendering folder-components into real HTML.
import { assert, assertEquals, assertStringIncludes } from "@std/assert";
import handler from "./serve.ts";

const INFO = {
  remoteAddr: { transport: "tcp", hostname: "127.0.0.1", port: 12345 },
  completed: Promise.resolve(),
} as unknown as Deno.ServeHandlerInfo;

const get = (path: string) => handler.fetch(new Request(`http://localhost${path}`), INFO);
const post = (path: string) =>
  handler.fetch(new Request(`http://localhost${path}`, { method: "POST" }), INFO);

Deno.test("SSR /ui/board → board rendered from template.html with keep data", async () => {
  const res = await get("/ui/board");
  assertEquals(res.status, 200);
  assertEquals(res.headers.get("content-type"), "text/html; charset=utf-8");
  const html = await res.text();
  assertStringIncludes(html, "sprig board"); // {{ b.project.name }} board
  assertStringIncludes(html, "In progress"); // a column label (@for over groups)
  assertStringIncludes(html, "SPR-101"); // an issue-card (nested component) rendered
  assertStringIncludes(html, "Compile template.html to a Preact render fn"); // issue title
  assertStringIncludes(html, 'data-tone="violet"'); // [attr.data-tone] binding on a tag chip
  assertStringIncludes(html, 'href="/ui/issues/SPR-101"'); // [href]="'/ui/issues/' + issue.id"
  assertStringIncludes(html, "<nav"); // the shell wraps the page via <router-outlet>
});

Deno.test("SSR / (dashboard) → stats rendered + pipes applied", async () => {
  const html = await (await get("/ui")).text();
  assertStringIncludes(html, "sprig dashboard");
  assertStringIncludes(html, "17%"); // completion 1/6 via | percent:'1.0-0'
  assertStringIncludes(html, "$48,250"); // budget via | currency:'USD'
});

Deno.test("SSR /ui/issues/SPR-101 → :id flows to keep, detail rendered, [innerHTML] trusted", async () => {
  const html = await (await get("/ui/issues/SPR-101")).text();
  assertStringIncludes(html, "SPR-101 — Compile template.html to a Preact render fn");
  assertStringIncludes(html, "<p>Hoisted the binding compiler"); // comment bodyHtml via [innerHTML], NOT escaped
  assert(!html.includes("&lt;p&gt;Hoisted"), "[innerHTML] must not be HTML-escaped");
});

Deno.test("SSR /ui/users/ada → profile rendered", async () => {
  const html = await (await get("/ui/users/ada")).text();
  assertStringIncludes(html, "Ada Lovelace");
  assertStringIncludes(html, "owner");
});

Deno.test("network /api/* → keep handler (NOT the UI, NOT backend.fetch)", async () => {
  const res = await post("/api/http/board");
  assert(res.status === 200 || res.status === 401, `expected keep response, got ${res.status}`);
  if (res.status === 200) {
    assertEquals((await res.json()).project.name, "sprig");
  } else {
    await res.body?.cancel();
  }
});

Deno.test("unknown UI route → 404", async () => {
  const res = await get("/ui/does-not-exist");
  assertEquals(res.status, 404);
  await res.body?.cancel();
});
