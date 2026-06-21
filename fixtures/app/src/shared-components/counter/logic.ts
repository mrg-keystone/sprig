import { defineComponent, signal } from "@sprig/core";

// A self-contained island: no dependencies, just local reactive state.
export default defineComponent(() => {
  const count = signal(0);
  const inc = () => count.value++;
  const dec = () => {
    if (count.value > 0) count.value--;
  };
  return { count, inc, dec };
});
