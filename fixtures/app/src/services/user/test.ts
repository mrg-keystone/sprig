import { assert, assertEquals } from "jsr:@std/assert@1";
import { inject, Injector, runInInjector } from "../../../.sprig/core.ts";
import { UserService } from "./mod.ts";

Deno.test("UserService resolves on the server and reads users", () => {
  // resolved via the injector (its #log = inject(Logger) field needs an active injector)
  const svc = runInInjector(new Injector("server", "root"), () => inject(UserService));
  assertEquals(svc.all().length, 3);
  assertEquals(svc.byId("ada")?.name, "Ada Lovelace");
  assertEquals(svc.byId("nope"), undefined);
  assertEquals(svc.byIds(["ada", "grace", "nope"]).map((u) => u.id), ["ada", "grace"]);
});

Deno.test("UserService is server-scoped — injecting it on the client throws (the wire boundary)", () => {
  let threw = false;
  try {
    runInInjector(new Injector("client", "root"), () => inject(UserService));
  } catch {
    threw = true;
  }
  assert(threw, "expected a server-only service to be unresolvable on the client");
});
