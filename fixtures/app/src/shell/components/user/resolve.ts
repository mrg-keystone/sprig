import { inject, type ResolveCtx } from "@sprig/core";
import { UserService } from "../../../services/user/mod.ts";
import { BoardService } from "../../../services/board/mod.ts";

/**
 * Runs on the SERVER inside the request injector — so it may inject() server-side services —
 * and returns the page's @inputs. The runtime serializes the result into the island's prop
 * bridge; user/logic.ts then reads `user`/`id`/`issues` via ctx.input(). This is how server
 * data crosses to an island: as data, never as an injected service.
 */
export const resolve = ({ params }: ResolveCtx) => {
  const users = inject(UserService);
  const board = inject(BoardService);
  const issues = board.issues().filter((i) => i.assignees.includes(params.id));
  return {
    user: users.byId(params.id) ?? null,
    id: params.id,
    issues,
  };
};
