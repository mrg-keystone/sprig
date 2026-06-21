import { assertStrictEquals } from "jsr:@std/assert@1";
import { inject, Injector, runInInjector } from "../../../.sprig/core.ts";
import { Logger } from "./mod.ts";

Deno.test("Logger is a providedIn:'root' singleton across the injector tree", () => {
  const root = new Injector("server", "root");
  const a = runInInjector(root.child("component"), () => inject(Logger));
  const b = runInInjector(root.child("component"), () => inject(Logger));
  assertStrictEquals(a, b); // resolved at root → one instance for both component injectors
});

Deno.test("Logger (scope 'both') resolves on the client too", () => {
  const a = runInInjector(new Injector("server", "root"), () => inject(Logger));
  const b = runInInjector(new Injector("client", "root"), () => inject(Logger));
  // both sides resolve, but as independent instances (no shared state across the wire)
  if (a === b) throw new Error("expected independent instances per side");
});
