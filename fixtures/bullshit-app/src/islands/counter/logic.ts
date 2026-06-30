// A HEALTHY island (the control): it has a logic.ts, so it hydrates and its
// (click) handlers fire. Pure client state via a signal — no server write, so
// no optimistic pattern needed. The audit should NOT flag this one.
import { signal } from "@sprig/core";

export default class Counter {
  count = signal(0);
  inc() {
    this.count.set(this.count() + 1);
  }
}
