import { inject, type Resolve, type ResolveCtx } from "@sprig/core";
import { BoardService } from "../../services/board/mod.ts";

// Reads the dynamic :id segment (params.id) and fetches the issue detail in-process.
export const resolve: Resolve = async (ctx: ResolveCtx) => {
  const board = inject(BoardService);
  return { detail: await board.issue(ctx.params.id), id: ctx.params.id };
};
