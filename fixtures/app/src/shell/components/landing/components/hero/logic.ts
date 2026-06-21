import { defineComponent, inject, signal } from "@sprig/core";
import { Logger } from "../../../../../services/logger/mod.ts";

export default defineComponent({
  // statically-declared @inputs so the compiler can wire/validate the parent's bindings
  inputs: ["headline", "name"],
  setup: (ctx) => {
    // @inputs are serialized from the server into the island's prop bridge
    const headline = ctx.input<string>("headline", "Welcome");
    const name = ctx.input<string>("name", "world");

    const open = signal(false);
    const log = inject(Logger); // "both"-scoped → resolvable inside the hydrated island
    const toggle = () => {
      open.value = !open.value;
      log.debug("hero details", open.value);
    };

    return { headline, name, open, toggle };
  },
});
