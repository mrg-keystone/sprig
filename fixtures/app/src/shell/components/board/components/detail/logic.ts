import { defineComponent, inject, Router, signal } from "@sprig/core";
import type { Comment, Issue } from "../../../../../services/board/mod.ts";
import type { User } from "../../../../../services/user/mod.ts";

// ISLAND PAGE (detail outlet): reads server-resolved data via @inputs (resolve.ts) instead of
// injecting Board/User — DI never crosses the wire. Injects Router only (scope "both") to close.
export default defineComponent({
  inputs: ["issue", "assignees", "comments", "id"],
  setup: (ctx) => {
    const router = inject(Router);
    const issue = ctx.input<Issue | null>("issue", null);
    const assignees = ctx.input<User[]>("assignees", []);
    const comments = ctx.input<Comment[]>("comments", []);
    const id = ctx.input<string>("id", "");
    const rating = signal(3);
    const onRate = (n: number) => {
      rating.value = n;
    };
    const close = () => router.navigate("/board");
    return { issue, assignees, comments, id, rating, onRate, close };
  },
});
