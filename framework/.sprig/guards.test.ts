// Route guards: a guard returns the route (as path segments) the navigation
// should go to — returning the target route itself proceeds, anything else 302s
// there. Guards run on the request's route injector (inject() works), BEFORE
// resolve, parent-first along the matched chain.
import { assert, assertEquals, assertStringIncludes } from "@std/assert";
import { bootstrap, defineRoutes, type Guard, inject, Injectable, matchRoute, type Route } from "./core.ts";

Deno.test("guard returning the target route proceeds to the page", async () => {
  let resolved = 0;
  const allow: Guard = (ctx) => ctx.path;
  const app = bootstrap({
    routes: defineRoutes([{ path: "admin", load: "./pages/admin", guards: [allow] }]),
    modules: {
      "./pages/admin": {
        resolve: () => {
          resolved++;
          return { ok: "admin-data" };
        },
      },
    },
  });
  const res = await app.fetch(new Request("http://localhost/admin"));
  assertEquals(res.status, 200);
  assertStringIncludes(await res.text(), "admin-data");
  assertEquals(resolved, 1);
});

Deno.test("guard returning a different route 302-redirects and skips resolve", async () => {
  let resolved = 0;
  const deny: Guard = () => ["login"];
  const app = bootstrap({
    routes: defineRoutes([
      { path: "admin", load: "./pages/admin", guards: [deny] },
      { path: "login", load: "./pages/login" },
    ]),
    modules: {
      "./pages/admin": {
        resolve: () => {
          resolved++;
          return {};
        },
      },
    },
  });
  const res = await app.fetch(new Request("http://localhost/admin"));
  assertEquals(res.status, 302);
  assertEquals(res.headers.get("location"), "/login");
  assertEquals(resolved, 0);
});

Deno.test("async guard is awaited", async () => {
  const deny: Guard = async () => {
    await Promise.resolve();
    return ["login"];
  };
  const app = bootstrap({
    routes: defineRoutes([{ path: "admin", load: "./pages/admin", guards: [deny] }]),
  });
  const res = await app.fetch(new Request("http://localhost/admin"));
  assertEquals(res.status, 302);
  assertEquals(res.headers.get("location"), "/login");
});

Deno.test("parent guards run for child routes, parent-first, and see the full target path", async () => {
  const calls: string[] = [];
  const parentGuard: Guard = (ctx) => {
    calls.push("parent:" + ctx.path.join("/"));
    return ctx.path;
  };
  const childGuard: Guard = (ctx) => {
    calls.push("child:" + ctx.path.join("/"));
    return ctx.path;
  };
  const app = bootstrap({
    routes: defineRoutes([{
      path: "admin",
      guards: [parentGuard],
      children: [{ path: "users", load: "./pages/users", guards: [childGuard] }],
    }]),
  });
  const res = await app.fetch(new Request("http://localhost/admin/users"));
  assertEquals(res.status, 200);
  await res.text();
  assertEquals(calls, ["parent:admin/users", "child:admin/users"]);
});

Deno.test("first redirecting guard wins; later guards don't run", async () => {
  const calls: string[] = [];
  const g1: Guard = (ctx) => {
    calls.push("g1");
    return ctx.path;
  };
  const g2: Guard = () => {
    calls.push("g2");
    return ["login"];
  };
  const g3: Guard = (ctx) => {
    calls.push("g3");
    return ctx.path;
  };
  const app = bootstrap({
    routes: defineRoutes([{ path: "admin", load: "./pages/admin", guards: [g1, g2, g3] }]),
  });
  const res = await app.fetch(new Request("http://localhost/admin"));
  assertEquals(res.status, 302);
  assertEquals(res.headers.get("location"), "/login");
  assertEquals(calls, ["g1", "g2"]);
});

Deno.test("inject() works inside a guard and shares the route injector with resolve", async () => {
  @Injectable()
  class Session {
    user = "";
  }
  const guard: Guard = (ctx) => {
    const s = inject(Session);
    s.user = "raph"; // resolve must observe the SAME route-scoped instance
    return ctx.path;
  };
  const app = bootstrap({
    routes: defineRoutes([{ path: "admin", load: "./pages/admin", guards: [guard] }]),
    modules: { "./pages/admin": { resolve: () => ({ who: inject(Session).user }) } },
  });
  const res = await app.fetch(new Request("http://localhost/admin"));
  assertEquals(res.status, 200);
  assertStringIncludes(await res.text(), "raph");
});

Deno.test("returned segments are normalized (slash-joined ≡ split, empties dropped)", async () => {
  const allow: Guard = () => ["/admin/users/"];
  const app = bootstrap({
    routes: defineRoutes([{
      path: "admin",
      children: [{ path: "users", load: "./pages/users", guards: [allow] }],
    }]),
  });
  const res = await app.fetch(new Request("http://localhost/admin/users"));
  assertEquals(res.status, 200);
  await res.text();
});

Deno.test("[] is the root route: allow on root, redirect-to-/ elsewhere", async () => {
  const toRoot: Guard = () => [];
  const app = bootstrap({
    routes: defineRoutes([
      { path: "", load: "./pages/home", guards: [toRoot] },
      { path: "admin", load: "./pages/admin", guards: [toRoot] },
    ]),
  });
  const home = await app.fetch(new Request("http://localhost/"));
  assertEquals(home.status, 200); // target [] === returned [] → proceed
  await home.text();
  const admin = await app.fetch(new Request("http://localhost/admin"));
  assertEquals(admin.status, 302);
  assertEquals(admin.headers.get("location"), "/");
});

Deno.test("redirect Location is prefixed with the app base", async () => {
  const deny: Guard = () => ["login"];
  const app = bootstrap({
    routes: defineRoutes([{ path: "admin", load: "./pages/admin", guards: [deny] }]),
    base: "/ui",
  });
  const res = await app.fetch(new Request("http://localhost/ui/admin"));
  assertEquals(res.status, 302);
  assertEquals(res.headers.get("location"), "/ui/login");
});

Deno.test("a throwing guard fails closed with a controlled 500", async () => {
  const boom: Guard = () => {
    throw new Error("nope");
  };
  const app = bootstrap({
    routes: defineRoutes([{ path: "admin", load: "./pages/admin", guards: [boom] }]),
  });
  const res = await app.fetch(new Request("http://localhost/admin"));
  assertEquals(res.status, 500);
  assertEquals(await res.text(), "Internal Server Error");
});

Deno.test("guard receives decoded params and the raw URL segments", async () => {
  let seenParam = "";
  let seenSeg = "";
  const check: Guard = (ctx) => {
    seenParam = ctx.params.id;
    seenSeg = ctx.path[1];
    return ctx.path;
  };
  const app = bootstrap({
    routes: defineRoutes([{ path: "issues/:id", load: "./pages/issue", guards: [check] }]),
  });
  const res = await app.fetch(new Request("http://localhost/issues/a%20b"));
  assertEquals(res.status, 200);
  await res.text();
  assertEquals(seenParam, "a b"); // params arrive decoded (matchRoute contract)
  assertEquals(seenSeg, "a%20b"); // ctx.path is the URL as-is, so `return ctx.path` round-trips
});

Deno.test("guards don't run for disallowed methods (405 wins)", async () => {
  const calls: string[] = [];
  const spy: Guard = (ctx) => {
    calls.push("spy");
    return ctx.path;
  };
  const app = bootstrap({
    routes: defineRoutes([{ path: "admin", load: "./pages/admin", guards: [spy] }]),
  });
  const res = await app.fetch(new Request("http://localhost/admin", { method: "POST" }));
  assertEquals(res.status, 405);
  await res.text();
  assertEquals(calls, []);
});

Deno.test("guard receives the request headers — a cookie-based auth guard works", async () => {
  const requireLogin: Guard = (ctx) => {
    const cookies = ctx.headers.get("cookie") ?? "";
    return cookies.split(/;\s*/).some((c) => c.startsWith("auth=")) ? ctx.path : ["login"];
  };
  const app = bootstrap({
    routes: defineRoutes([
      { path: "login", load: "./pages/login" },
      { path: "admin", load: "./pages/admin", guards: [requireLogin] },
    ]),
  });
  const anon = await app.fetch(new Request("http://localhost/admin"));
  assertEquals(anon.status, 302, "no cookie → back to login");
  assertEquals(anon.headers.get("location"), "/login");
  const authed = await app.fetch(new Request("http://localhost/admin", { headers: { "cookie": "theme=dark; auth=1" } }));
  assertEquals(authed.status, 200, "the browser's cookie header reaches the guard");
  await authed.text();
});

Deno.test("matchRoute collects the guard chain parent-first, without sibling leaks", () => {
  const g1: Guard = (c) => c.path;
  const g2: Guard = (c) => c.path;
  const g3: Guard = (c) => c.path;
  const routes: Route[] = [
    {
      path: "admin",
      guards: [g1],
      children: [
        { path: "users", guards: [g2], children: [{ path: ":id", load: "./pages/user", guards: [g3] }] },
      ],
    },
    // sibling that also matches under /admin/* — must NOT inherit g1 from the
    // failed descent above
    { path: "admin/settings", load: "./pages/settings" },
  ];
  const deep = matchRoute(routes, "/admin/users/42");
  assert(deep);
  assertEquals(deep.guards, [g1, g2, g3]);
  assertEquals(deep.params, { id: "42" });

  const sibling = matchRoute(routes, "/admin/settings");
  assert(sibling);
  assertEquals(sibling.load, "./pages/settings");
  assertEquals(sibling.guards, []);
});
