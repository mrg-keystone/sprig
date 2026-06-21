import { inject, type Resolve } from "@sprig/core";
import { BoardService } from "../../services/board/mod.ts";

// Runs on the SERVER inside the request injector; the board view-model becomes the
// page's @inputs. inject() must run before the first await (DI is synchronous).
export const resolve: Resolve = async () => {
  const board = inject(BoardService);
  return { board: await board.board() };
};
