// sprigUi() is the framework-agnostic /ui mount: a Response for anything under base,
// null to pass through. Tested with a fake SprigApp so it doesn't need the full renderer.
import { assert, assertEquals } from "jsr:@std/assert";
import { sprigUi } from "./mod.ts";
import type { SprigApp } from "@mrg-keystone/sprig";

// a fake app that echoes the path it was asked to render, and remembers the env.
function fakeApp(): { app: SprigApp; lastEnv: () => unknown } {
  let env: unknown;
  const app = {
    fetch: (req: Request, _info?: Deno.ServeHandlerInfo, e?: unknown) => {
      env = e;
      return Promise.resolve(new Response("SSR:" + new URL(req.url).pathname, { status: 200 }));
    },
  } as unknown as SprigApp;
  return { app, lastEnv: () => env };
}

const get = (p: string, init?: RequestInit) => new Request("http://host" + p, init);

Deno.test("a request under base is handled by the sprig app", async () => {
  const { app } = fakeApp();
  const ui = sprigUi({ app, base: "/ui" });
  const r = await ui(get("/ui/components/counter"));
  assert(r, "returned a Response, not pass-through");
  assertEquals(r!.status, 200);
  assertEquals(await r!.text(), "SSR:/ui/components/counter");
});

Deno.test("base itself (exact) is handled", async () => {
  const { app } = fakeApp();
  const ui = sprigUi({ app, base: "/ui" });
  assert(await ui(get("/ui")), "/ui exact is ours");
});

Deno.test("a request NOT under base passes through (null)", async () => {
  const { app } = fakeApp();
  const ui = sprigUi({ app, base: "/ui" });
  assertEquals(await ui(get("/api/data")), null);
  assertEquals(await ui(get("/")), null);
  assertEquals(await ui(get("/uixyz")), null, "must not match /ui as a prefix of another segment");
});

Deno.test("assets under base/_assets route to the static dir (404 for a missing file)", async () => {
  const { app } = fakeApp();
  const ui = sprigUi({ app, base: "/ui", assetsDir: "/tmp/does-not-exist" });
  const r = await ui(get("/ui/_assets/client.js"));
  assert(r, "asset path is ours");
  assertEquals(r!.status, 404, "missing asset → 404 (handled, not pass-through)");
});

Deno.test("the host backend is threaded into the app for SSR", async () => {
  const { app, lastEnv } = fakeApp();
  const ui = sprigUi({ app, base: "/ui", backend: { fetch: () => Promise.resolve(new Response("{}")) } });
  await ui(get("/ui/page"));
  const env = lastEnv() as { backend?: unknown };
  assert(env?.backend, "env.backend was passed to app.fetch");
});

Deno.test("composes as middleware: under base → sprig, else → host", async () => {
  const { app } = fakeApp();
  const ui = sprigUi({ app, base: "/ui" });
  const host = (req: Request) => new Response("HOST:" + new URL(req.url).pathname, { status: 200 });
  const handler = async (req: Request) => (await ui(req)) ?? host(req);

  assertEquals(await (await handler(get("/ui/x"))).text(), "SSR:/ui/x");
  assertEquals(await (await handler(get("/dashboard"))).text(), "HOST:/dashboard");
});
