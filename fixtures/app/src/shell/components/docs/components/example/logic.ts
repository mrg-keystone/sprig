import { computed, defineComponent, signal } from "@sprig/core";

// ISLAND in the docs `example` named outlet (route example=:topic → params.topic). One
// consolidated feature gallery: a @switch over `topic()` selects which feature family to show.
// All state is sample/reactive — no server services injected (data, not DI, crosses the wire).
export default defineComponent({
  inputs: ["topic"],
  setup: (ctx) => {
    const topic = ctx.input<string>("topic", "pipes");
    const items = signal([{ id: 1, name: "alpha", price: 10 }, { id: 2, name: "beta", price: 22 }]);
    const user = signal({ first: "Ada", last: "Lovelace", city: "London" });
    const today = signal("2026-06-20T14:30:00Z");
    const ratio = signal(0.1234);
    const price = signal(9.99);
    const status = signal("done");
    const greeting = signal(true);
    // a Promise so the `async` pipe has something to subscribe to (async handles Promises too)
    const ready = signal(Promise.resolve("loaded"));
    const plural = computed(() => ({ "=0": "no items", "=1": "one item", other: "# items" }));
    const select = computed(() => ({ done: "Done", other: "Pending" }));
    const trackById = (_i: number, r: { id: number }) => r.id;
    return { topic, items, user, today, ratio, price, status, greeting, ready, plural, select, trackById };
  },
});
