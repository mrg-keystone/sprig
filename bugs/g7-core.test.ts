// g7-core — regression tests for the SSR routing + DI bugs in ui/.sprig/core.ts
// and the board/user services. One Deno.test per bug; each is a true
// fail-before / pass-after regression test.
import { assert, assertEquals, assertStringIncludes } from "@std/assert";
import {
  backendClient,
  Backend,
  bootstrap,
  currentInjector,
  inject,
  Injectable,
  Injector,
  runInInjector,
  token,
} from "@sprig/core";
import { BoardService } from "../ui/src/services/board/mod.ts";
import { UserService } from "../ui/src/services/user/mod.ts";

// ── shared test helpers ──────────────────────────────────────────────────────
const INFO = undefined;

/** A fake keep Backend: returns the issue/user only for the matching id. */
function fakeBackend(): typeof fetch {
  return ((path: string | URL | Request, init?: RequestInit) => {
    const p = typeof path === "string" ? path : (path as URL).toString();
    const body = init?.body ? JSON.parse(String(init.body)) : {};
    if (p.endsWith("/http/issue")) {
      if (body.issueId === "SPR-101") {
        return Promise.resolve(new Response(JSON.stringify({ id: "SPR-101", title: "ok" }), { status: 200 }));
      }
      return Promise.resolve(new Response("not found", { status: 404 }));
    }
    if (p.endsWith("/http/user")) {
      if (body.userId === "ada") {
        return Promise.resolve(new Response(JSON.stringify({ id: "ada", name: "Ada" }), { status: 200 }));
      }
      return Promise.resolve(new Response("not found", { status: 404 }));
    }
    // board/dashboard
    return Promise.resolve(new Response(JSON.stringify({ ok: true }), { status: 200 }));
  }) as unknown as typeof fetch;
}

/** Build a bootstrap app that mirrors the real wiring for issue/user routes. */
function makeApp() {
  const issueMod = {
    resolve: async (ctx: { params: Record<string, string> }) => {
      const board = inject(BoardService);
      return { detail: await board.issue(ctx.params.id), id: ctx.params.id };
    },
  };
  const userMod = {
    resolve: async (ctx: { params: Record<string, string> }) => {
      const user = inject(UserService);
      return { profile: await user.profile(ctx.params.id), id: ctx.params.id };
    },
  };
  return bootstrap({
    base: "/ui",
    routes: [
      { path: "", load: "home" },
      { path: "issues/:id", load: "issue" },
      { path: "users/:id", load: "user" },
    ],
    modules: { home: {}, issue: issueMod, user: userMod },
    render: (_load, inputs) => Promise.resolve(`<!doctype html><html><body>${JSON.stringify(inputs)}</body></html>`),
  });
}

const env = () => ({ backend: backendClient(fakeBackend()) });
const req = (path: string, method = "GET") => new Request(`http://localhost${path}`, { method });

// ── bug 23: non-existent resource → 404 (not 200) ───────────────────────────
Deno.test("bug 23: missing issue/user resource returns HTTP 404, not 200", async () => {
  const app = makeApp();
  // existing resource → 200
  const ok = await app.fetch(req("/ui/issues/SPR-101"), INFO, env());
  assertEquals(ok.status, 200);
  await ok.text();
  // non-existent → 404 (was 200 with a 'No issue' body before the fix)
  const miss = await app.fetch(req("/ui/issues/SPR-999"), INFO, env());
  assertEquals(miss.status, 404);
  await miss.text();
  const userMiss = await app.fetch(req("/ui/users/nobody"), INFO, env());
  assertEquals(userMiss.status, 404);
  await userMiss.text();
});

// ── bug 25: backendClient.get on non-JSON 200 + bootstrap error containment ──
Deno.test("bug 25: get() on non-JSON 200 returns ok:false (no throw, body drained); bootstrap maps throw → 500", async () => {
  const be = backendClient(((_p: unknown, _i: unknown) =>
    Promise.resolve(
      new Response("<html>not json</html>", { status: 200, headers: { "content-type": "text/html" } }),
    )) as unknown as typeof fetch);
  // Before fix: this throws "Unexpected token '<' ... is not valid JSON".
  const r = await be.get("/http/board", { method: "POST" });
  assertEquals(r.ok, false);
  assert(r.data === undefined, "non-JSON 200 must not yield data");

  // bootstrap.fetch wraps resolve()/render() errors into a 500 with no leaked text.
  const app = bootstrap({
    base: "",
    routes: [{ path: "boom", load: "boom" }],
    modules: { boom: { resolve: () => { throw new Error("secret stack detail"); } } },
    render: (_l, i) => Promise.resolve(`<html>${JSON.stringify(i)}</html>`),
  });
  const res = await app.fetch(req("/boom"));
  assertEquals(res.status, 500);
  const txt = await res.text();
  assert(!txt.includes("secret stack detail"), "internal error text must not leak to the client");
});

// ── bug 28: :id param is URL-decoded ────────────────────────────────────────
Deno.test("bug 28: percent-encoded :id is decoded before backend lookup + reflection", async () => {
  const app = makeApp();
  // SPR%2D101 is just the encoded form of valid SPR-101 → must resolve (200), not 404
  const res = await app.fetch(req("/ui/issues/SPR%2D101"), INFO, env());
  assertEquals(res.status, 200);
  const html = await res.text();
  // the reflected id must be decoded, not raw escapes
  assertStringIncludes(html, "SPR-101");
  assert(!html.includes("SPR%2D101"), "raw percent-encoding must not be reflected");
  // %61da decodes to 'ada' (valid user)
  const u = await app.fetch(req("/ui/users/%61da"), INFO, env());
  assertEquals(u.status, 200);
  await u.text();
});

// ── bug 51 / 55: HTTP method guard on SSR routes ────────────────────────────
// NOTE: TRACE/CONNECT cannot be constructed via the fetch Request ctor (forbidden
// methods), but the guard rejects every non-GET/HEAD/OPTIONS verb uniformly, so
// PUT/DELETE/PATCH/POST exercise the same code path TRACE would hit.
Deno.test("bug 51/55: PUT/DELETE/PATCH/POST → 405+Allow; OPTIONS → 204+Allow; no 200 body", async () => {
  const app = makeApp();
  for (const m of ["PUT", "DELETE", "PATCH", "POST"]) {
    const res = await app.fetch(req("/ui/issues/SPR-101", m), INFO, env());
    assertEquals(res.status, 405, `${m} should be 405`);
    assertEquals(res.headers.get("allow"), "GET, HEAD, OPTIONS");
    await res.body?.cancel();
  }
  const opt = await app.fetch(req("/ui/issues/SPR-101", "OPTIONS"), INFO, env());
  assertEquals(opt.status, 204);
  assertEquals(opt.headers.get("allow"), "GET, HEAD, OPTIONS");
  assertEquals(await opt.text(), "");
});

// ── bug 53: security headers on SSR HTML ────────────────────────────────────
Deno.test("bug 53: SSR HTML carries nosniff/X-Frame-Options/Referrer-Policy", async () => {
  const app = makeApp();
  const res = await app.fetch(req("/ui/issues/SPR-101"), INFO, env());
  await res.text();
  assertEquals(res.headers.get("x-content-type-options"), "nosniff");
  assertEquals(res.headers.get("x-frame-options"), "DENY");
  assertEquals(res.headers.get("referrer-policy"), "no-referrer");
});

// ── bug 54: bare "/" off-base must 404 (no dual-mount) ───────────────────────
Deno.test("bug 54: bare '/' off the base returns 404, not the home document", async () => {
  const app = makeApp(); // base "/ui"
  const off = await app.fetch(req("/"));
  assertEquals(off.status, 404);
  await off.text();
  // on-base index still works
  const on = await app.fetch(req("/ui"), INFO, env());
  assertEquals(on.status, 200);
  await on.text();
});

// ── bug 57: cache-control on dynamic SSR ────────────────────────────────────
Deno.test("bug 57: dynamic SSR HTML is cache-control: no-store", async () => {
  const app = makeApp();
  const res = await app.fetch(req("/ui/issues/SPR-101"), INFO, env());
  await res.text();
  assertEquals(res.headers.get("cache-control"), "no-store");
});

// ── bug 58: clientRoot enables client-side inject (mechanism) ────────────────
// The full activation lives in hydrate.ts (not owned by this group — see
// crossFileNeeded). This asserts the client-injector mechanism itself works so a
// hydrateIsland wired to runInInjector(clientRoot().child(...)) would resolve DI.
Deno.test("bug 58: a client injector activated via runInInjector enables inject() on the client", () => {
  @Injectable({ scope: "client" })
  class ClientOnly {
    tag = "client-svc";
  }
  const clientRootInjector = new Injector("client", "root");
  const got = runInInjector(clientRootInjector.child("component"), () => inject(ClientOnly));
  assert(got instanceof ClientOnly);
  assertEquals(got.tag, "client-svc");
});

// ── bug 59: undefined-valued provider is cached (factory runs once) ─────────
Deno.test("bug 59: a provider whose value is undefined is cached, factory runs once", () => {
  let count = 0;
  const Maybe = token<undefined>("MaybeG7", { factory: () => { count++; return undefined; } });
  const r = new Injector("server", "root");
  runInInjector(r, () => { inject(Maybe); inject(Maybe); inject(Maybe); });
  assertEquals(count, 1);
});

// ── bug 60: provide(token, undefined) wins over the registry factory ─────────
Deno.test("bug 60: provide(token, undefined) is honored, registry factory does not run", () => {
  let count = 0;
  const Cfg = token<string | undefined>("CfgG7", { factory: () => { count++; return "FALLBACK"; } });
  const r = new Injector("server", "root");
  r.provide(Cfg, undefined);
  const got = runInInjector(r, () => inject(Cfg));
  assertEquals(got, undefined);
  assertEquals(count, 0);
});

// ── bug 61: route child injector is actually used by bootstrap ──────────────
Deno.test("bug 61: bootstrap resolves on a route-scoped child injector (kind='route')", async () => {
  let observedKind: string | undefined;
  let observedHasParent = false;
  const app = bootstrap({
    base: "",
    routes: [{ path: "probe", load: "probe" }],
    modules: {
      probe: {
        resolve: () => {
          const inj = currentInjector();
          observedKind = inj?.kind;
          observedHasParent = !!inj?.parent;
          return {};
        },
      },
    },
    render: (_l, i) => Promise.resolve(JSON.stringify(i)),
  });
  const res = await app.fetch(req("/probe"));
  await res.text();
  assertEquals(observedKind, "route");
  assert(observedHasParent, "the route injector must be a child of the request root");
});

// ── bug 62: BoardService/UserService are scope 'server' (honest contract) ─────
Deno.test("bug 62: BoardService/UserService reject client-side construction at their own scope gate", () => {
  const client = new Injector("client", "root");
  let boardErr = "";
  try {
    runInInjector(client, () => inject(BoardService));
  } catch (e) {
    boardErr = (e as Error).message;
  }
  assertStringIncludes(boardErr, "BoardService");
  assertStringIncludes(boardErr, 'scope="server"');

  let userErr = "";
  try {
    runInInjector(client, () => inject(UserService));
  } catch (e) {
    userErr = (e as Error).message;
  }
  assertStringIncludes(userErr, "UserService");
  assertStringIncludes(userErr, 'scope="server"');

  // and they still construct fine on the server with Backend bound
  const server = new Injector("server", "root");
  server.provide(Backend, backendClient(fakeBackend()));
  const svc = runInInjector(server, () => inject(BoardService));
  assert(svc instanceof BoardService);
});

// ── bug 92: scope guard applies to inherited/bound values too ────────────────
Deno.test("bug 92: a server-scoped token bound on a parent is NOT handed to a client child", () => {
  // control: fresh client injector → scope gate fires
  const fresh = new Injector("client", "root");
  let threw = false;
  try {
    fresh.resolve(Backend);
  } catch {
    threw = true;
  }
  assert(threw, "control: fresh client resolve of Backend must throw");

  // bug case: parent (client) has Backend bound, client child resolves it.
  const root = new Injector("client", "root");
  root.provide(Backend, backendClient(fakeBackend()));
  const child = root.child("component");
  let bypassed = false;
  let guardFired = false;
  try {
    child.resolve(Backend);
    bypassed = true;
  } catch (e) {
    guardFired = true;
    assertStringIncludes((e as Error).message, 'scope="server"');
  }
  assert(!bypassed, "inherited server-scoped value must not bypass the scope guard");
  assert(guardFired, "scope guard must fire even on the cache-hit/inherited path");
});
