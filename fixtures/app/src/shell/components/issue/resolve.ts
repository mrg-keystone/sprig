import { inject, type ResolveCtx } from "@sprig/core";
import { BoardService } from "../../../services/board/mod.ts";
import { UserService } from "../../../services/user/mod.ts";

/**
 * Runs on the SERVER inside the request injector — so it may inject() the server-scoped
 * BoardService / UserService — and returns the /issues/:id page's @inputs. The runtime
 * serializes the result into the island's prop bridge; issue/logic.ts then reads
 * issue / id / assignees / comments / related via ctx.input(). Server data reaches the
 * island as DATA, never as an injected service.
 */
export const resolve = ({ params }: ResolveCtx) => {
  const board = inject(BoardService);
  const users = inject(UserService);
  const issue = board.issueById(params.id) ?? null;
  return {
    issue,
    id: params.id,
    assignees: issue ? users.byIds(issue.assignees) : [],
    comments: board.commentsFor(params.id),
    related: board.issues().filter((i) => i.id !== params.id).slice(0, 3),
  };
};
