import { inject, type ResolveCtx } from "@sprig/core";
import { BoardService } from "../../../services/board/mod.ts";

/**
 * Runs on the SERVER inside the request injector, so it may inject() the server-scoped
 * BoardService. It returns the board page's implied @inputs (`project`, `groups`) — the runtime
 * serializes them into the page's prop bridge. Each group pairs a column with its issues, so the
 * static template can iterate without any method call (which would force it to need a logic.ts).
 */
export const resolve = (_ctx: ResolveCtx) => {
  const board = inject(BoardService);
  const groups = board.columns().map((column) => ({
    column,
    issues: board.issuesByStatus(column.id),
  }));
  return { project: board.project(), groups };
};
