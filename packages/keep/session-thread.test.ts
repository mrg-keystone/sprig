// Session mode: serveSprig resolves the httpOnly `sprig_session` cookie via keep.sessions.read and
// threads the profile into the SSR app as env.session — so the guard reads ctx.session instead of
// re-verifying a bearer. Legacy mode (no keep.sessions) leaves it null.
import { assertEquals } from "jsr:@std/assert";
import { serveSprig } from "./mod.ts";
import type { SprigApp } from "@mrg-keystone/sprig";

function fakeApp(): { app: SprigApp; lastEnv: () => unknown } {
  let env: unknown;
  const app = {
    fetch: (_req: Request, _info?: unknown, e?: unknown) => {
      env = e;
      return Promise.resolve(new Response("ssr"));
    },
  } as unknown as SprigApp;
  return { app, lastEnv: () => env };
}

const info = {} as unknown as Deno.ServeHandlerInfo;

Deno.test("serveSprig session mode: sprig_session cookie → env.session (valid / invalid / absent)", async () => {
  const { app, lastEnv } = fakeApp();
  const keep = {
    backend: { fetch: () => Promise.resolve(new Response("{}")) },
    handler: () => new Response("keep"),
    // only "sess-1" resolves to a profile; anything else → null
    sessions: { read: (id: string) => Promise.resolve(id === "sess-1" ? { email: "op@corp.com", grants: ["*"] } : null) },
  };
  // deno-lint-ignore no-explicit-any
  const srv = serveSprig({ keep: keep as any, app, base: "/ui" });
  const call = (cookie?: string) =>
    srv.fetch(new Request("http://host/ui/overview", cookie ? { headers: { cookie } } : undefined), info);

  await call("sprig_session=sess-1");
  assertEquals((lastEnv() as { session?: { email?: string } }).session?.email, "op@corp.com", "valid session not threaded into env.session");

  await call("sprig_session=nope");
  assertEquals((lastEnv() as { session?: unknown }).session, null, "unknown session id must resolve to null");

  await call();
  assertEquals((lastEnv() as { session?: unknown }).session, null, "no cookie → null");
});

Deno.test("serveSprig legacy mode (no keep.sessions): env.session stays null", async () => {
  const { app, lastEnv } = fakeApp();
  const keep = { backend: { fetch: () => Promise.resolve(new Response("{}")) }, handler: () => new Response("keep") };
  // deno-lint-ignore no-explicit-any
  const srv = serveSprig({ keep: keep as any, app, base: "/ui" });
  await srv.fetch(new Request("http://host/ui/overview", { headers: { cookie: "sprig_session=whatever" } }), info);
  assertEquals((lastEnv() as { session?: unknown }).session, null, "legacy keep must not resolve sessions");
});
