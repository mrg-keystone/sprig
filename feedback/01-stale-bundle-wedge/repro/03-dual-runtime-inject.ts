// Repro 3 — WHY the mixed-deploy state from repro 02 surfaces as
//   [sprig] failed to hydrate island "..." — Error: inject() must be called
//   synchronously within setup(), resolve(), a guard, or a service constructor
// on EVERY island.
//
// The active injection context is module-scoped state in the runtime:
//   framework/.sprig/core.ts:262   `let current: Injector | undefined;`
// When two copies of the runtime chunk are loaded in one document (old cached
// client.js+chunk pair + freshly fetched isl.*.js importing the new chunk), the
// old copy's hydrate() sets `current` in ITS module instance; the island's
// component code calls inject() from the NEW copy, whose `current` is undefined
// → the exact error. Ironically clientRoot() already survives dual copies (it
// lives on globalThis as __sprig_root) — the context variable does not.
//
// This script loads the REAL core.ts twice (a query string makes a second module
// instance — precisely what two differently-hashed chunk files do in a browser).
//
// Run from the repo root:
//   deno run -A feedback/01-stale-bundle-wedge/repro/03-dual-runtime-inject.ts

const coreUrl = new URL("../../../framework/.sprig/core.ts", import.meta.url).href;
const runtimeOld = await import(coreUrl); // the cached deploy-1 chunk
const runtimeNew = await import(coreUrl + "?deploy-2-chunk"); // the fresh deploy-2 chunk

// a service registered in the NEW runtime (island code is compiled against it)
const Demo = runtimeNew.token("demo-service", { factory: () => ({ hello: "world" }) });

// same-runtime hydration (the healthy case): works
const healthy = runtimeNew.runInInjector(runtimeNew.clientRoot(), () => runtimeNew.inject(Demo));
console.log(`same-runtime inject(): ok →`, healthy);

// both copies even share the SAME root injector via globalThis.__sprig_root:
console.log(`clientRoot() shared across copies:`, runtimeOld.clientRoot() === runtimeNew.clientRoot());

// mixed-runtime hydration (the wedged-browser case): the OLD runtime drives
// hydration and sets its own `current`; the island component calls the NEW
// runtime's inject() — whose module-scoped `current` was never set.
try {
  runtimeOld.runInInjector(runtimeOld.clientRoot(), () => runtimeNew.inject(Demo));
  throw new Error("unexpectedly succeeded");
} catch (err) {
  console.log(`\ncross-runtime inject() threw:\n  ${(err as Error).message}`);
  if (!(err as Error).message.includes("inject() must be called synchronously")) throw err;
  console.log(`\nFAIL (expected): byte-for-byte the error every island logged in production.`);
  console.log(`The message points at DI usage, three causal steps away from the actual`);
  console.log(`problem (a stale immutable-cached bundle) — nothing tells the developer a`);
  console.log(`second runtime copy is loaded.`);
}
