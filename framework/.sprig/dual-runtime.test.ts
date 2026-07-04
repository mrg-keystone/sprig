// REGRESSION (feedback/bug-report.md, defect 3): when TWO copies of the sprig runtime
// share one document (a stale cached bundle + a freshly fetched chunk after a redeploy),
// module-scoped DI state can't cross copies, so every island died with the misleading
// "inject() must be called synchronously…" — and NOTHING reported the dual-copy state.
// core.ts now detects the second copy at module init (browser-only) and flags it on
// globalThis so the hydrate loop can attempt its one-shot recovery reload.
import { assert, assertEquals, assertStringIncludes } from "jsr:@std/assert";
import { detectDualRuntime } from "@mrg-keystone/sprig";

type Markers = { __sprig_runtime?: true; __sprig_runtime_dual?: true };

Deno.test("server side (no document): never marks, never reports", () => {
  const g: Markers = {};
  assertEquals(detectDualRuntime(g, false), false);
  assertEquals(g.__sprig_runtime, undefined, "no marker on the server — double module instances are legitimate there");
});

Deno.test("browser: first copy marks, second copy is detected and flagged", () => {
  const errors: string[] = [];
  const origError = console.error;
  console.error = (...a: unknown[]) => errors.push(a.join(" "));
  try {
    const g: Markers = {};
    assertEquals(detectDualRuntime(g, true), false, "the first copy is not an error");
    assertEquals(g.__sprig_runtime, true);
    assertEquals(g.__sprig_runtime_dual, undefined);
    assertEquals(errors.length, 0);

    assertEquals(detectDualRuntime(g, true), true, "the second copy IS the incident state");
    assertEquals(g.__sprig_runtime_dual, true, "flag set for hydrate's one-shot recovery reload");
    assertEquals(errors.length, 1);
    assertStringIncludes(errors[0], "two copies of the sprig runtime");
    assertStringIncludes(errors[0], "stale cached bundle", "the message names the actual cause, not a DI symptom");
  } finally {
    console.error = origError;
  }
});

Deno.test("the real module-load path: importing core.ts twice in a 'browser' reports the dual copy (inverts repro 03)", async () => {
  const errors: string[] = [];
  const origError = console.error;
  console.error = (...a: unknown[]) => errors.push(a.join(" "));
  // a minimal "document" so core.ts's module-scope detection treats this as a browser
  Object.defineProperty(globalThis, "document", { configurable: true, value: {} });
  const g = globalThis as unknown as Markers;
  const hadMarker = g.__sprig_runtime;
  try {
    delete g.__sprig_runtime;
    delete g.__sprig_runtime_dual;
    const coreUrl = new URL("./core.ts", import.meta.url).href;
    // two module INSTANCES of the same source — exactly what two differently-hashed
    // runtime chunks (old cached + freshly fetched) are in a wedged browser.
    await import(coreUrl + "?dual-copy-a");
    assertEquals(errors.length, 0, "one copy is fine");
    await import(coreUrl + "?dual-copy-b");
    assertEquals(errors.length, 1, "the second module instance reports itself");
    assertStringIncludes(errors[0], "two copies of the sprig runtime");
    assert(g.__sprig_runtime_dual, "…and flags the document for recovery");
  } finally {
    console.error = origError;
    // deno-lint-ignore no-explicit-any
    delete (globalThis as any).document;
    delete g.__sprig_runtime_dual;
    if (hadMarker) g.__sprig_runtime = hadMarker;
    else delete g.__sprig_runtime;
  }
});
