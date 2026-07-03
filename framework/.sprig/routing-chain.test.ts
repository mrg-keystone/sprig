// Routing v2 — matchRoute returns the full render CHAIN (nested layouts → leaf), plus the
// parent-first guard + grant chains. This pins the semantics the nested-layout engine depends on:
// a routers/* load WRAPS its children; a plain page-parent stays a mere index (back-compat);
// login is a bare sibling with no wrapper.
import { assert, assertEquals } from "jsr:@std/assert";
import { buildNav, defineRoutes, type Guard, isLayoutLoad, matchRoute } from "./core.ts";

const reqLogin: Guard = (ctx) => ctx.path; // proceed

const routes = defineRoutes([
  { path: "login", load: "pages/login" },
  {
    path: "",
    load: "routers/main", // a LAYOUT — wraps its children
    guards: [reqLogin],
    requiredGrant: "operator",
    children: [
      { path: "", load: "pages/overview" }, // index
      { path: "queue", load: "pages/queue", meta: { nav: "Work queue" } },
      { path: "calls/:id", load: "pages/calls" },
    ],
  },
]);

Deno.test("isLayoutLoad: routers/* is a layout, pages/* is not", () => {
  assert(isLayoutLoad("routers/main"));
  assert(!isLayoutLoad("pages/overview"));
  assert(!isLayoutLoad(undefined));
});

Deno.test("login is a BARE page — no router wrapper, no guards/grants", () => {
  const m = matchRoute(routes, "/login");
  assertEquals(m?.chain.map((c) => c.load), ["pages/login"]);
  assertEquals(m?.load, "pages/login");
  assertEquals(m?.guards ?? [], []);
  assertEquals(m?.grants ?? [], []);
});

Deno.test("dashboard root: router wraps its INDEX page (one overview, not a self-parent)", () => {
  const m = matchRoute(routes, "/");
  assertEquals(m?.chain.map((c) => c.load), ["routers/main", "pages/overview"]);
  assertEquals(m?.load, "pages/overview"); // leaf convenience / back-compat
  assertEquals(m?.grants, ["operator"]);
  assert(m?.guards?.includes(reqLogin));
});

Deno.test("a child route nests inside the router; guards+grants inherited", () => {
  const m = matchRoute(routes, "/queue");
  assertEquals(m?.chain.map((c) => c.load), ["routers/main", "pages/queue"]);
  assertEquals(m?.chain[1].meta?.nav, "Work queue");
  assertEquals(m?.grants, ["operator"]);
  assert(m?.guards?.includes(reqLogin));
});

Deno.test("param route inside the router carries the param", () => {
  const m = matchRoute(routes, "/calls/42");
  assertEquals(m?.chain.map((c) => c.load), ["routers/main", "pages/calls"]);
  assertEquals(m?.params.id, "42");
});

Deno.test("BACK-COMPAT: a page-parent stays an INDEX — it does NOT wrap its children", () => {
  const legacy = defineRoutes([
    { path: "", load: "pages/home", children: [{ path: "about", load: "pages/about" }] },
  ]);
  // at "/", the parent page renders itself (index) — chain is just the page.
  assertEquals(matchRoute(legacy, "/")?.chain.map((c) => c.load), ["pages/home"]);
  // at "/about", ONLY the child renders — the page-parent is NOT a layer (pre-nesting behavior).
  assertEquals(matchRoute(legacy, "/about")?.chain.map((c) => c.load), ["pages/about"]);
});

Deno.test("buildNav: the nav IS the route tree — derived from meta.nav, with hrefs + active-link", () => {
  const nav = buildNav(routes, "/queue", "/ui");
  // only routes with meta.nav appear; login + calls (no nav) are excluded.
  assertEquals(nav.map((n) => n.label), ["Work queue"]);
  const q = nav.find((n) => n.label === "Work queue")!;
  assertEquals(q.href, "/ui/queue"); // href built from the nested path + base
  assertEquals(q.active, true); // active on /queue
});

Deno.test("buildNav: icons + active-link across a richer tree", () => {
  const rs = defineRoutes([
    { path: "login", load: "pages/login" }, // no meta → excluded
    {
      path: "",
      load: "routers/main",
      children: [
        { path: "", load: "pages/overview", meta: { nav: "Overview", icon: "home" } },
        { path: "calls", load: "pages/calls", meta: { nav: "Calls" } },
        { path: "settings", load: "pages/settings" }, // no nav → excluded
      ],
    },
  ]);
  const nav = buildNav(rs, "/calls/42", "/ui");
  assertEquals(nav.map((n) => n.label), ["Overview", "Calls"]);
  assertEquals(nav.find((n) => n.label === "Overview")?.icon, "home");
  assertEquals(nav.find((n) => n.label === "Overview")?.active, false);
  assertEquals(nav.find((n) => n.label === "Calls")?.active, true); // /calls/42 is under /calls
  assertEquals(nav.find((n) => n.label === "Overview")?.href, "/ui/"); // index → base root
});
