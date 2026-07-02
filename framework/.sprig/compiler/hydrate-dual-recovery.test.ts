// REGRESSION (feedback/suggestion.md, layer 4): when an island fails to hydrate AND
// core.ts has flagged a dual-runtime document (a stale cached bundle next to a fresh
// chunk after a redeploy), the hydrate loop reloads ONCE — sessionStorage-guarded so it
// can never loop — to let the fresh, content-addressed document heal a transient deploy
// skew. A genuine app bug (no dual flag) must NEVER trigger a reload.
import { assert, assertEquals } from "jsr:@std/assert";
import { DOMParser } from "jsr:@b-fuze/deno-dom";
import { registerIsland } from "./hydrate.ts";
import { parseTemplate } from "./parse.ts";
import { serialize } from "./serialize.ts";

type Flags = { __sprig_runtime_dual?: true };

async function withHydrateFailure(sel: string, fn: () => void | Promise<void>): Promise<string[]> {
  const doc = new DOMParser().parseFromString(
    `<html><body><sprig-island data-sel="${sel}"><span>ssr</span></sprig-island></body></html>`,
    "text/html",
  )!;
  Object.defineProperty(globalThis, "document", { configurable: true, value: doc });
  const errors: string[] = [];
  const origError = console.error;
  console.error = (...a: unknown[]) => errors.push(a.join(" "));
  try {
    registerIsland(sel, {
      // the incident shape: the island's setup explodes (in prod: a cross-copy inject())
      setup: () => {
        throw new Error("inject() must be called synchronously within setup(), resolve(), or a service constructor");
      },
      template: serialize(await parseTemplate(`<span>x</span>`)),
      scope: "t",
    });
    await fn();
  } finally {
    console.error = origError;
    // deno-lint-ignore no-explicit-any
    delete (globalThis as any).document;
  }
  return errors;
}

Deno.test("dual-runtime flag set → ONE recovery reload, guarded per session", async () => {
  const g = globalThis as Flags;
  let reloads = 0;
  Object.defineProperty(globalThis, "location", { configurable: true, value: { reload: () => reloads++ } });
  sessionStorage.removeItem("__sprig_dual_reload");
  g.__sprig_runtime_dual = true;
  try {
    const errors = await withHydrateFailure("boom-a", () => {
      assertEquals(reloads, 1, "the flagged dual-runtime state recovers by reloading once");
      assertEquals(sessionStorage.getItem("__sprig_dual_reload"), "1", "the one-shot guard is recorded");
    });
    assert(errors.some((e) => e.includes(`failed to hydrate island "boom-a"`)), "the failure itself is still reported");

    // a SECOND failure in the same session (the reload didn't help / more islands fail):
    // the guard holds — never a reload loop.
    await withHydrateFailure("boom-b", () => {
      assertEquals(reloads, 1, "still exactly one reload per session");
    });
  } finally {
    delete g.__sprig_runtime_dual;
    sessionStorage.removeItem("__sprig_dual_reload");
    // deno-lint-ignore no-explicit-any
    delete (globalThis as any).location;
  }
});

Deno.test("NO dual-runtime flag → a hydrate failure never reloads (a real app bug must surface, not loop)", async () => {
  const g = globalThis as Flags;
  let reloads = 0;
  Object.defineProperty(globalThis, "location", { configurable: true, value: { reload: () => reloads++ } });
  sessionStorage.removeItem("__sprig_dual_reload");
  delete g.__sprig_runtime_dual;
  try {
    const errors = await withHydrateFailure("boom-c", () => {
      assertEquals(reloads, 0, "no reload without the detected dual-runtime state");
      assertEquals(sessionStorage.getItem("__sprig_dual_reload"), null, "no guard burned either");
    });
    assert(errors.some((e) => e.includes(`failed to hydrate island "boom-c"`)));
  } finally {
    sessionStorage.removeItem("__sprig_dual_reload");
    // deno-lint-ignore no-explicit-any
    delete (globalThis as any).location;
  }
});
