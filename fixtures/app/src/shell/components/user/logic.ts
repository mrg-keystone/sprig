import { defineComponent, inject, Router } from "@sprig/core";
import type { User } from "../../../services/user/mod.ts";
import type { Issue } from "../../../services/board/mod.ts";

// ISLAND: reads server-resolved data via @input (see resolve.ts) — it does NOT inject the
// data services, honouring the rule "DI never crosses the wire, data does". It injects Router
// (scope "both") only for navigation.
export default defineComponent({
  inputs: ["user", "id", "issues"],
  setup: (ctx) => {
    const router = inject(Router);
    const user = ctx.input<User | null>("user", null);
    const id = ctx.input<string>("id", "");
    const issues = ctx.input<Issue[]>("issues", []);
    const trackIssue = (_i: number, x: Issue) => x.id;
    return { user, id, issues, trackIssue, back: () => router.navigate("/") };
  },
});
