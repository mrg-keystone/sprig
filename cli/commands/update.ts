import { Command } from "@cliffy/command";
import { cmdUpdate } from "../lib/update.ts";

export const updateCmd = new Command()
  .description(
    "Reinstall the bundled Claude Code skills + the global CLI, both to the latest release.",
  )
  .action(async () => {
    await cmdUpdate();
  });
