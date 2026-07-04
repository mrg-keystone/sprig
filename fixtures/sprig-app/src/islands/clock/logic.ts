import { signal } from "@mrg-keystone/sprig";

// A {setup} island that OPTS INTO the new client lifecycle (duck-typed). Proves
// onBrowserInit fires after hydration and onBrowserDestroy cleans up on unmount.
export default {
  setup() {
    const time = signal(new Date().toLocaleTimeString());
    let id: number | undefined;
    // deno-lint-ignore no-explicit-any
    const w = globalThis as any;
    return {
      time,
      onBrowserInit() {
        w.__clockMounted = (w.__clockMounted ?? 0) + 1;
        id = setInterval(() => {
          time.set(new Date().toLocaleTimeString());
          w.__clockTicks = (w.__clockTicks ?? 0) + 1;
        }, 100);
      },
      onBrowserDestroy() {
        clearInterval(id);
        w.__clockDestroyed = (w.__clockDestroyed ?? 0) + 1;
      },
    };
  },
};
