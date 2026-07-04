// counter — a sprig island with a real `count` signal (the editable control the
// preview harness picks up via onIslandMounted + isSignal).
import { defineComponent, signal } from "@mrg-keystone/sprig";

export default defineComponent({
  setup: () => {
    const count = signal(0);
    const dec = () => count.set(count() - 1);
    const inc = () => count.set(count() + 1);
    return { count, dec, inc };
  },
});
