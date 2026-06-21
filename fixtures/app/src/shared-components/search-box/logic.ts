import { defineComponent, signal } from "@sprig/core";

// Island: a search field with a query signal, a `search` output, and submit/clear helpers.
export default defineComponent({
  setup: (ctx) => {
    const q = signal("");
    const search = ctx.output<string>("search");
    const submit = () => search(q.value);
    const clear = () => {
      q.value = "";
    };
    return { q, search, submit, clear };
  },
});
