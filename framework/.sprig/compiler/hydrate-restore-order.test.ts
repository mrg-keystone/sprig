// BUG N (MED) — a persisted StateService shows its CONSTRUCTOR DEFAULTS on the first
// client paint (and inside onBrowserInit) instead of the localStorage-persisted values.
//
// Cause: StateService's constructor defers restore via queueMicrotask(() => this.restore())
// (core.ts), but hydrateIsland builds the scope (entry.setup), runs the FIRST effect render
// AND calls onBrowserInit all SYNCHRONOUSLY in one task (hydrate.ts) — so the deferred restore
// microtask lands AFTER the first paint + onBrowserInit. The framework exports restoreState()
// (restores every LIVE_STATES instance synchronously) but hydrate.ts never called it.
//
// FIX: call restoreState() synchronously in hydrateIsland AFTER the scope is built (+ the server
// __snapshot is applied) but BEFORE the first effect render + onBrowserInit, so the persisted
// values overlay the constructor defaults before the first paint reads them.
import { assertEquals } from "@std/assert";
import { DOMParser } from "jsr:@b-fuze/deno-dom";
import { parseTemplate } from "./parse.ts";
import { serialize } from "./serialize.ts";
import { type IslandEntry, makeClassSetup, registerIsland } from "./hydrate.ts";
import { Injectable, inject, StateService } from "@sprig/core";

function mockLocalStorage(): Map<string, string> {
  const store = new Map<string, string>();
  Object.defineProperty(globalThis, "localStorage", {
    configurable: true,
    value: {
      getItem: (k: string) => (store.has(k) ? store.get(k)! : null),
      setItem: (k: string, v: string) => store.set(k, v),
      removeItem: (k: string) => store.delete(k),
      clear: () => store.clear(),
    },
  });
  return store;
}
// deno-lint-ignore no-explicit-any
const unmockLs = () => delete (globalThis as any).localStorage;

function mockDocument(html: string): void {
  const doc = new DOMParser().parseFromString(html, "text/html")!;
  Object.defineProperty(globalThis, "document", { configurable: true, value: doc });
}
// deno-lint-ignore no-explicit-any
const unmockDoc = () => delete (globalThis as any).document;

Deno.test("BUG N: hydrateIsland's first render + onBrowserInit see the PERSISTED state, not the constructor default", async () => {
  const store = mockLocalStorage();
  // seed localStorage as if a prior session persisted mode = "dark"
  store.set("sprig:state:ThemeN", JSON.stringify({ mode: "dark" }));

  // a persisted state service whose CONSTRUCTOR DEFAULT is "light".
  @Injectable({ providedIn: "root", scope: "both" })
  class ThemeN extends StateService {
    static key = "ThemeN";
    mode = "light";
  }

  // capture what onBrowserInit observes (this is what the first paint would render).
  let seenInInit: string | undefined;

  // a class island that injects the persisted state and reads it in onBrowserInit.
  class Widget {
    theme = inject(ThemeN);
    // deno-lint-ignore no-explicit-any
    constructor(_ctx: any) {}
    onBrowserInit() {
      seenInInit = this.theme.mode;
    }
  }

  const template = serialize(await parseTemplate(`<span>{{theme.mode}}</span>`));
  const entry: IslandEntry = { setup: makeClassSetup(Widget as never), template, scope: "wgt" };

  mockDocument(
    `<html><body>` +
      `<sprig-island data-sel="w-idget" data-trigger="load">` +
      `<script class="sprig-props" type="application/json">{}</script>` +
      `</sprig-island>` +
      `</body></html>`,
  );

  try {
    // registerIsland → hydratePending → hydrateIsland, ALL synchronous. We do NOT await,
    // so the StateService constructor's deferred restore() microtask has NOT drained.
    registerIsland("w-idget", entry);

    // The first paint + onBrowserInit must already see the persisted value.
    assertEquals(seenInInit, "dark", "onBrowserInit (first paint) must see persisted 'dark', not the constructor default 'light'");

    // And the first rendered HTML must show "dark" too.
    const el = document.querySelector("sprig-island")!;
    assertEquals((el.textContent ?? "").includes("dark"), true, "the first client paint renders the persisted 'dark'");
  } finally {
    unmockDoc();
    unmockLs();
  }
});
