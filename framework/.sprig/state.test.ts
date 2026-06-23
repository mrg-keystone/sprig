import { assert, assertEquals } from "@std/assert";
import { persistState, restoreState, StateService } from "./core.ts";

function mockLocalStorage(): Map<string, string> {
  const store = new Map<string, string>();
  // defineProperty (not plain assignment) so it overrides Deno's built-in localStorage global.
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

Deno.test("StateService: persist → restore round-trips serializable fields", () => {
  const store = mockLocalStorage();
  try {
    class S extends StateService {
      count = 0;
      name = "x";
    }
    const a = new S();
    a.count = 5;
    a.name = "hello";
    a.persist();
    assert(store.has("sprig:state:S"), "persisted under its class key");

    const b = new S();
    b.restore();
    assertEquals(b.count, 5);
    assertEquals(b.name, "hello");
  } finally {
    unmock();
  }
});

Deno.test("StateService: reset restores defaults AND clears its localStorage entry", () => {
  const store = mockLocalStorage();
  try {
    class S extends StateService {
      count = 0;
    }
    const a = new S();
    a.count = 9;
    a.persist();
    assert(store.has("sprig:state:S"), "saved before reset");

    a.reset();
    assertEquals(a.count, 0, "field reset to its constructed default");
    assert(!store.has("sprig:state:S"), "saved copy in localStorage was removed on reset");
  } finally {
    unmock();
  }
});

Deno.test("persistState/restoreState round-trip every live state service", () => {
  const store = mockLocalStorage();
  try {
    class Cart extends StateService {
      items = 0;
    }
    const live = new Cart();
    live.items = 3;
    persistState(); // writes every live instance
    assert(store.has("sprig:state:Cart"));

    const fresh = new Cart();
    assertEquals(fresh.items, 0, "starts at default");
    fresh.restore();
    assertEquals(fresh.items, 3, "restored from localStorage");
  } finally {
    unmock();
  }
});

Deno.test("StateService: a `static key` gives a stable localStorage key (survives minification)", () => {
  const store = mockLocalStorage();
  try {
    class S extends StateService {
      static key = "app";
      n = 0;
    }
    const a = new S();
    a.n = 4;
    a.persist();
    assert(store.has("sprig:state:app"), "uses the static key, not the class name");
  } finally {
    unmock();
  }
});

Deno.test("StateService: persist/restore/reset are no-ops with no localStorage (server)", () => {
  // no localStorage in scope → must not throw
  class S extends StateService {
    n = 1;
  }
  const a = new S();
  a.n = 7;
  a.persist();
  a.restore();
  a.reset();
  assertEquals(a.n, 1, "reset still restores defaults server-side");
});
