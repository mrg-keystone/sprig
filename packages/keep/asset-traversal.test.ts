import { assertEquals } from "@std/assert";
import { sprigUi } from "./mod.ts";

// Minimal UI middleware; the asset branch runs before app.fetch, so a stub app is fine.
const ui = sprigUi({
  app: { fetch: () => new Response("app") } as unknown as Parameters<typeof sprigUi>[0]["app"],
  assetsDir: "static",
});

// BUG (cross-model lens Q3 / workflow security-2) — the path-traversal guard split
// only on "/", so a percent-encoded BACKSLASH (%5c) produced "..\\.." which has no
// "/"-delimited ".." segment → the guard passed. On Windows "\\" is a real path
// separator, so this escaped the assets dir (arbitrary file read). The guard must
// reject a ".." segment on EITHER separator.
Deno.test("serveAsset blocks an encoded backslash (%5c) traversal with 403", async () => {
  const res = await ui(new Request("http://h/ui/_assets/..%5c..%5csecret.txt"));
  assertEquals(res?.status, 403);
});

// control: the forward-slash encoded traversal was already blocked — must stay 403.
Deno.test("serveAsset blocks an encoded slash (%2f) traversal with 403", async () => {
  const res = await ui(new Request("http://h/ui/_assets/..%2f..%2fsecret.txt"));
  assertEquals(res?.status, 403);
});
