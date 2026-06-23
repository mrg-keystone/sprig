// BUG AH (MED) — restoreState() (called from hydrate.ts on EVERY island hydration)
// re-overlays localStorage onto shared providedIn:"root" StateService singletons with
// NO once-guard, so a DEFERRED-trigger island (visible/idle/interaction) hydrating LATER
// reverts in-memory mutations made since load (persist() only runs on nav/pagehide, so
// localStorage still holds the stale value). StateService.restore() is a non-idempotent
// Object.assign(this, JSON.parse(raw)). The contract ("called once on client bootstrap")
// says restore is once-on-load, not per-island.
//
// FIX: a per-instance once-guard (#restored). restore() applies the FIRST time only;
// later restore() calls are no-ops, preserving live mutations. reset() re-enables restore.
import { assert, assertEquals } from "@std/assert";
import { restoreState, StateService } from "./core.ts";

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
const unmock = () => delete (globalThis as any).localStorage;

Deno.test("BUG AH: a SECOND restore() does NOT revert a live in-memory mutation", () => {
  const store = mockLocalStorage();
  try {
    store.set("sprig:state:Cart", JSON.stringify({ count: 5 }));

    class Cart extends StateService {
      static key = "Cart";
      count = 0;
    }

    const c = new Cart();
    // FIRST restore: applies the persisted value (this is the once-on-load restore
    // hydrateIsland runs before first paint).
    c.restore();
    assertEquals(c.count, 5, "first restore applies the persisted value");

    // user mutates in memory AFTER load; persist() has NOT run (only on nav/pagehide),
    // so localStorage still holds the stale {count:5}.
    c.count = 12;

    // a DEFERRED-trigger island hydrates LATER → restoreState() runs again over the
    // same root singleton. It MUST NOT clobber the live mutation.
    c.restore();
    assertEquals(c.count, 12, "a second restore() must NOT revert the live mutation back to 5");

    // also via the global restoreState() (the exact path hydrate.ts uses per island).
    restoreState();
    assertEquals(c.count, 12, "restoreState() (global) is also a no-op after the first restore");
  } finally {
    unmock();
  }
});

Deno.test("BUG AH: the FIRST restore still applies the persisted value (fresh instance)", () => {
  const store = mockLocalStorage();
  try {
    store.set("sprig:state:Cart", JSON.stringify({ count: 5 }));
    class Cart extends StateService {
      static key = "Cart";
      count = 0;
    }
    const c = new Cart();
    c.restore();
    assertEquals(c.count, 5, "a fresh instance's first restore overlays the persisted value");
  } finally {
    unmock();
  }
});

Deno.test("BUG AH: an empty-localStorage first restore still counts as 'restored' (no later overlay)", () => {
  const store = mockLocalStorage();
  try {
    // localStorage is EMPTY for this key on the first restore.
    class Cart extends StateService {
      static key = "Cart";
      count = 0;
    }
    const c = new Cart();
    c.restore(); // localStorage empty → no overlay, but this DOES consume the once-guard.
    c.count = 12; // live mutation.

    // a stale value appears in localStorage AFTER load (e.g. a sibling persisted it).
    store.set("sprig:state:Cart", JSON.stringify({ count: 5 }));
    c.restore(); // must be a no-op — the first restore already counted.
    assertEquals(c.count, 12, "an empty-storage first restore still locks out later overlays");
  } finally {
    unmock();
  }
});

Deno.test("BUG AH: reset() re-enables a future restore", () => {
  const store = mockLocalStorage();
  try {
    store.set("sprig:state:Cart", JSON.stringify({ count: 5 }));
    class Cart extends StateService {
      static key = "Cart";
      count = 0;
    }
    const c = new Cart();
    c.restore();
    assertEquals(c.count, 5, "first restore applies persisted value");

    c.reset();
    assertEquals(c.count, 0, "reset returns to constructed default");
    assert(!store.has("sprig:state:Cart"), "reset cleared the saved copy");

    // a later session re-persists; after reset, restore() must apply again.
    store.set("sprig:state:Cart", JSON.stringify({ count: 7 }));
    c.restore();
    assertEquals(c.count, 7, "reset re-enabled a future restore");
  } finally {
    unmock();
  }
});
