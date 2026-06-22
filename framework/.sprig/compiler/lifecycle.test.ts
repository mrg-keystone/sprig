// Proves the lifecycle + state-snapshot contract: the exact behaviours we agreed on,
// as failing-if-reordered assertions.
import { assert, assertEquals } from "jsr:@std/assert";
import { signal } from "@sprig/core";
import { destroyOnClient, hydrateOnClient, renderOnServer, snapshotOf } from "./lifecycle.ts";

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

Deno.test("the Dooks contract: onServerInit's value crosses to onBrowserInit", async () => {
  let browserSaw: number | null = null;
  class Dooks {
    data = 0;
    onServerInit() { this.data = 1; }
    view() { return `<p>${this.data}</p>`; }
    onBrowserInit() { browserSaw = this.data; }
  }

  // SERVER: onServerInit ran before view → HTML shows 1, snapshot carries 1
  const { html, snapshot } = await renderOnServer(Dooks, {});
  assertEquals(html, "<p>1</p>", "render must read the post-onServerInit value");
  assertEquals(snapshot, { data: 1 }, "snapshot taken after onServerInit");

  // BROWSER: a DIFFERENT instance, restored from the snapshot before onBrowserInit
  hydrateOnClient(Dooks, snapshot, {});
  assertEquals(browserSaw, 1, "onBrowserInit must see the server-produced 1, not the field-init 0");
});

Deno.test("ordering: render reads post-onServerInit state (would be 0 if reordered)", async () => {
  class C {
    data = 0;
    async onServerInit() { await sleep(5); this.data = 42; } // async fetch
    view() { return `${this.data}`; }
  }
  const { html, snapshot } = await renderOnServer(C, {});
  assertEquals(html, "42", "async onServerInit must be awaited before render");
  assertEquals(snapshot.data, 42);
});

Deno.test("signal VALUES ride along in the snapshot and re-seed reactive state", async () => {
  class Counter {
    count = signal(0);
    async onServerInit() { this.count.set(5); }
    view() { return `<p>${this.count()}</p>`; }
  }
  const { html, snapshot } = await renderOnServer(Counter, {});
  assertEquals(html, "<p>5</p>");
  assertEquals(snapshot, { count: 5 }, "the signal's value is snapshotted, not the signal object");

  const inst = hydrateOnClient(Counter, snapshot, {});
  assertEquals(inst.count(), 5, "the browser signal is re-seeded to 5 and stays reactive");
  inst.count.set(6);
  assertEquals(inst.count(), 6);
});

Deno.test("non-serializable fields are dropped, methods come from the class", async () => {
  class WithFn {
    data = 1;
    cb = () => 99; // a closure — not serializable
    onServerInit() { this.data = 9; }
    view() { return `${this.data}`; }
  }
  const { snapshot } = await renderOnServer(WithFn, {});
  assertEquals(snapshot, { data: 9 }, "the closure is silently excluded from the snapshot");

  const inst = hydrateOnClient(WithFn, snapshot, {});
  assertEquals(inst.data, 9, "serializable field transferred");
  assertEquals(inst.cb(), 99, "the closure is the fresh one from `new WithFn()`, not transferred");
});

Deno.test("onBrowserDestroy cleans up (no work after teardown)", async () => {
  class Ticker {
    ticks = 0;
    #id?: number;
    onBrowserInit() { this.#id = setInterval(() => this.ticks++, 10); }
    onBrowserDestroy() { clearInterval(this.#id); }
  }
  const inst = hydrateOnClient(Ticker, {}, {});
  await sleep(35);
  const atDestroy = inst.ticks;
  assert(atDestroy >= 2, `should have ticked while mounted, got ${atDestroy}`);
  destroyOnClient(inst);
  await sleep(30);
  assertEquals(inst.ticks, atDestroy, "no ticks after onBrowserDestroy — the interval is gone");
});

Deno.test("snapshotOf ignores private fields and prototype methods", () => {
  class X {
    pub = 1;
    #secret = 2;
    method() { return this.#secret; }
  }
  assertEquals(snapshotOf(new X()), { pub: 1 }, "only public own data fields");
});
