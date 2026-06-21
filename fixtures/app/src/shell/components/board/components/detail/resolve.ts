import { inject, type ResolveCtx } from "@sprig/core";
import { BoardService } from "../../../../../services/board/mod.ts";
import { UserService } from "../../../../../services/user/mod.ts";

/**
 * Runs on the SERVER (request injector) for the `detail` named outlet (route detail=:issueId).
 * It may inject() server services here; the result is serialized into the island's prop bridge
 * so detail/logic.ts reads issue/id/assignees/comments via ctx.input() — data crosses the wire,
 * DI does not.
 */
export const resolve = ({ params }: ResolveCtx) => {
  const board = inject(BoardService);
  const users = inject(UserService);
  const issue = board.issueById(params.issueId) ?? null;
  return {
    issue,
    id: params.issueId,
    assignees: issue ? users.byIds(issue.assignees) : [],
    comments: board.commentsFor(params.issueId),
  };
};
