import { defineComponent } from "@sprig/core";
import type { Issue } from "../../services/board/mod.ts";

// data-table — ISLAND. Legacy structural-directive (§8) + ng-template (§10) showcase.
export default defineComponent({
  inputs: ["rows"],
  setup: (ctx) => {
    const rows = ctx.input<Issue[]>("rows", []);
    const trackById = (_i: number, r: Issue) => r.id;
    return { rows, trackById };
  },
});
