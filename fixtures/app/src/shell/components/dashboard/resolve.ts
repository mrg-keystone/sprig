import { inject, type ResolveCtx } from "@sprig/core";
import { BoardService } from "../../../services/board/mod.ts";

/**
 * Runs on the SERVER inside the request injector, so it may inject() the server-scoped
 * BoardService. It returns the dashboard page's implied @inputs (`stats`, `project`, `recent`,
 * `activity`) — the runtime serializes them into the page's prop bridge so the static template
 * renders without any method call (which would force it to need a logic.ts).
 */
export const resolve = (_ctx: ResolveCtx) => {
  const board = inject(BoardService);
  const stats = board.stats();
  return {
    stats,
    project: board.project(),
    recent: board.issues().slice(0, 3),
    activity: board.activity(),
  };
};
