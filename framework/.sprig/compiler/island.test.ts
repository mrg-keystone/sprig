// withServerInjector — the island/page server-DI wrap. The regression pinned
// here: a page's onServerInit must resolve REQUEST-scoped tokens (the
// per-request `Backend` binding) — the component injector is parented to the
// request's injector when one is passed. An orphaned fresh root (the old
// behavior) made `inject(Backend)` throw "not bound" in every page class while
// resolve.ts worked — the first real composed app hit it in production.

import { assertEquals, assertThrows } from "@std/assert";
import { inject, Injector, token } from "@mrg-keystone/sprig";
import { withServerInjector } from "./island.ts";

const Cap = token<string>("test:cap", {
  scope: "server",
  providedIn: "root",
  factory: () => {
    throw new Error("not bound");
  },
});

Deno.test("withServerInjector: parented to the request injector, request-scoped tokens resolve", () => {
  const root = new Injector("server", "root");
  root.provide(Cap, "request-value");
  const route = root.child("route");
  const seen = withServerInjector(() => inject(Cap), route);
  assertEquals(seen, "request-value");
});

Deno.test("withServerInjector: without a parent, an unbound request token fails loud", () => {
  assertThrows(
    () => withServerInjector(() => inject(Cap)),
    Error,
    "not bound",
  );
});
