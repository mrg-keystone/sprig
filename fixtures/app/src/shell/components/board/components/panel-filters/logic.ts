import { computed, defineComponent, signal } from "@sprig/core";

// Island (named outlet panel=filters): a filter panel that consumes the
// child <search-box> output, toggles status checkboxes, and emits `apply`.
export default defineComponent({
  setup: (ctx) => {
    const q = signal("");
    const statuses = signal<string[]>(["todo", "in-progress"]);
    const apply = ctx.output<string>("apply");
    const allStatuses = computed(() => [
      "backlog",
      "todo",
      "in-progress",
      "review",
      "done",
    ]);
    const onSearch = (term: string) => {
      q.value = term;
    };
    const has = (s: string) => statuses().includes(s);
    const toggle = (s: string) => {
      statuses.update((cur) =>
        cur.includes(s) ? cur.filter((x) => x !== s) : [...cur, s]
      );
    };
    return { q, statuses, apply, allStatuses, onSearch, has, toggle };
  },
});
