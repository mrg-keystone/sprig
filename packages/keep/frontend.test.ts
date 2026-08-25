// The Frontend handler — the sprig half of the composition seam: a directly
// servable fetch handler whose OPTIONAL THIRD ARGUMENT is the provisioned
// in-process client (the entire seam), bound request-scoped into the app's
// backend context.

import { assertEquals } from "@std/assert";
import { join } from "@std/path";
import { Frontend } from "./mod.ts";
import type { SprigApp } from "@mrg-keystone/sprig";

async function withApp(
  fn: (
    handler: (
      req: Request,
      info?: Deno.ServeHandlerInfo,
      backend?: { fetch: typeof fetch },
    ) => Promise<Response>,
    calls: { path: string; hadBackend: boolean; backends: unknown[] },
  ) => Promise<void>,
) {
  const tmp = await Deno.makeTempDir();
  const assetsDir = join(tmp, "static");
  await Deno.mkdir(assetsDir, { recursive: true });
  await Deno.writeTextFile(join(assetsDir, "app.js"), "// bundle");
  const calls = { path: "", hadBackend: false, backends: [] as unknown[] };
  const app = {
    fetch: (req: Request, _info?: unknown, ctx?: { backend?: unknown }) => {
      calls.path = new URL(req.url).pathname;
      calls.hadBackend = Boolean(ctx?.backend);
      calls.backends.push(ctx?.backend);
      return Promise.resolve(new Response("<html>ssr</html>", {
        headers: { "content-type": "text/html" },
      }));
    },
  } as unknown as SprigApp;
  try {
    await fn(Frontend({ app, assetsDir }), calls);
  } finally {
    await Deno.remove(tmp, { recursive: true });
  }
}

Deno.test("Frontend: total coverage — root redirects to base, unknown paths 404", async () => {
  await withApp(async (handler) => {
    const root = await handler(new Request("http://app/"));
    assertEquals(root.status, 302);
    assertEquals(new URL(root.headers.get("location")!).pathname, "/ui");
    const other = await handler(new Request("http://app/definitely-not-ours"));
    assertEquals(other.status, 404);
    await other.body?.cancel();
  });
});

Deno.test("Frontend: serves the SSR app under base; no 3rd arg → no backend in ctx (UI-only)", async () => {
  await withApp(async (handler, calls) => {
    const res = await handler(new Request("http://app/ui/home"));
    assertEquals(await res.text(), "<html>ssr</html>");
    assertEquals(calls.path, "/ui/home");
    assertEquals(calls.hadBackend, false, "UI-only: the backend context stays unbound");
  });
});

Deno.test("Frontend: the 3rd-arg client is bound REQUEST-SCOPED — a fresh wrapper per call", async () => {
  await withApp(async (handler, calls) => {
    const provided = { fetch: ((_i: unknown) => Promise.resolve(new Response("x"))) as typeof fetch };
    await (await handler(new Request("http://app/ui/a"), undefined, provided)).body?.cancel();
    await (await handler(new Request("http://app/ui/b"), undefined, provided)).body?.cancel();
    assertEquals(calls.backends.length, 2);
    assertEquals(calls.hadBackend, true);
    // A fresh binding per request — never the same captured instance.
    assertEquals(calls.backends[0] === calls.backends[1], false);
  });
});
