import { computed, defineComponent } from "@sprig/core";

// Island: a 5-star rating with a custom two-way [(value)] binding plus a (rate) output.
export default defineComponent({
  inputs: ["value"],
  setup: (ctx) => {
    const value = ctx.model<number>("value", 0);
    const rate = ctx.output<number>("rate");
    const stars = computed(() => [1, 2, 3, 4, 5]);
    const set = (n: number) => {
      value.set(n);
      rate(n);
    };
    return { value, stars, set };
  },
});
