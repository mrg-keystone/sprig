import { Command } from "@cliffy/command";
import { resolve } from "#std/path";
import { discover } from "../../server/src/core/business/discover/mod.ts";
import { formatProblems, renderList } from "../lib/format.ts";

export const listCmd = new Command()
  .description("List discovered components + their cases and routes.")
  .action(async (opts) => {
    const root = resolve((opts as unknown as { root: string }).root);
    const { entries, problems } = await discover(root);
    if (entries.length === 0) {
      console.log(
        "No isolatable components found.\n" +
          "Add an isolate/ folder to a component, e.g. components/button/isolate/.",
      );
    } else {
      renderList(entries, root);
    }
    if (problems.length) {
      console.error(
        `\n⚠ ${problems.length} config problem(s):\n\n${
          formatProblems(problems, root)
        }`,
      );
    }
  });
