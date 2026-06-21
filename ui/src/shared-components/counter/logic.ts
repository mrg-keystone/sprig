import { defineComponent, signal } from "@sprig/core";

// An island: local reactive state, no inputs. Its presence (logic.ts) makes the
// folder hydrate on the client.
export default defineComponent(() => {
  const count = signal(0);
  const inc = () => count.value++;
  const dec = () => {
    if (count.value > 0) count.value--;
  };
  return { count, inc, dec };
});
