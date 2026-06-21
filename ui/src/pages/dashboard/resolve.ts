import { inject, type Resolve } from "@sprig/core";
import { BoardService } from "../../services/board/mod.ts";

export const resolve: Resolve = async () => {
  const board = inject(BoardService);
  return { dashboard: await board.dashboard() };
};
