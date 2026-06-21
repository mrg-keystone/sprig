import { computed, defineComponent, signal } from "@sprig/core";

// Island: an SVG sparkline of completed-points-per-day. Click toggles a peak caption.
export default defineComponent({
  inputs: ["points"],
  setup: (ctx) => {
    const points = ctx.input<number[]>("points", []);
    const max = computed(() => Math.max(1, ...points()));
    const bars = computed(() => points().map((v, i) => ({ i, v, h: (v / max()) * 40 })));
    const open = signal(false);
    const toggle = () => {
      open.value = !open.value;
    };
    return { points, bars, max, open, toggle };
  },
});
