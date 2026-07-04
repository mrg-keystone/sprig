import { signal } from "@mrg-keystone/sprig";

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

// A CLASS-based island with an ASYNC onServerInit — proves the server render awaits
// the fetch before producing HTML (phase 5), snapshots the result, and the browser
// re-seeds from it.
export default class Greeter {
  greeting = "(unset)";
  count = signal(0);

  async onServerInit() {
    await sleep(60); // stand-in for a DB / API call
    this.greeting = "Hello from the server";
  }

  inc() { this.count.set(this.count() + 1); }

  onBrowserInit() {
    // deno-lint-ignore no-explicit-any
    (globalThis as any).__greeterMounted = true;
  }
}
