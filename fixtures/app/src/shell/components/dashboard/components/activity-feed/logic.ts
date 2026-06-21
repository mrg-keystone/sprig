import { defineComponent, signal } from "@sprig/core";
import type { Activity } from "../../../../../services/board/mod.ts";

// Island: a collapsible recent-activity feed; clicking a row emits its issueId.
export default defineComponent({
  inputs: ["items"],
  setup: (ctx) => {
    const items = ctx.input<Activity[]>("items", []);
    const select = ctx.output<string>("select");
    const open = signal(true);
    const toggle = () => {
      open.value = !open.value;
    };
    return { items, select, open, toggle };
  },
});
