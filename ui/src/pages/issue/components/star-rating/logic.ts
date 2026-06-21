import { defineComponent, signal } from "@sprig/core";

// An island that hydrates ONLY when scrolled into view (M7 lazy-load by trigger).
// Its chunk (isl.star-rating.js) is not even fetched until the widget is visible.
export default defineComponent({
  trigger: "visible",
  setup: () => {
    const rating = signal(0);
    const set = (n: number) => rating.set(n);
    return { rating, set, stars: [1, 2, 3, 4, 5] };
  },
});
