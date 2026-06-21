import { computed, defineComponent, inject, Router, signal } from "@sprig/core";
import type { Comment, Issue } from "../../../services/board/mod.ts";
import type { User } from "../../../services/user/mod.ts";

// ISLAND page (/issues/:id): reads its server-resolved data via @input (see resolve.ts) —
// it does NOT inject the data services (that would throw on the client). It injects only
// Router (scope "both") for navigation. Local state lives in signals/computeds.
export default defineComponent({
  inputs: ["issue", "id", "assignees", "comments", "related"],
  setup: (ctx) => {
    const router = inject(Router);

    const issue = ctx.input<Issue | null>("issue", null);
    const id = ctx.input<string>("id", "");
    const assignees = ctx.input<User[]>("assignees", []);
    const comments = ctx.input<Comment[]>("comments", []);
    const related = ctx.input<Issue[]>("related", []);

    const rating = signal(4);
    const draft = signal("");
    const done = computed(() => issue()?.status === "done");

    const onRate = (n: number) => {
      rating.value = n;
    };
    const post = () => {
      draft.value = "";
    };
    const back = () => router.navigate("/board");
    const onDone = (_e: unknown) => {};

    return { issue, id, assignees, comments, related, rating, draft, done, onRate, post, back, onDone };
  },
});
