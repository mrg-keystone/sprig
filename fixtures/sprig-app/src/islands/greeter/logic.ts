import { signal } from "@sprig/core";

// A CLASS-based island (export default class). Exercises the full lifecycle:
// onServerInit runs on the server, its state snapshots across the wire, the browser
// instance is re-seeded from it, onBrowserInit fires, and `this`-bound methods drive
// interactivity.
export default class Greeter {
  greeting = "(unset)";
  count = signal(0);

  onServerInit() {
    // server-only work (a DB/API call in real life) — here a deterministic value
    this.greeting = "Hello from the server";
  }

  inc() { this.count.set(this.count() + 1); } // uses `this` → needs class-scope binding

  onBrowserInit() {
    // deno-lint-ignore no-explicit-any
    (globalThis as any).__greeterMounted = true;
  }
}
