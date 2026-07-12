// isolate — spin up a standalone, Storybook-style preview for any component,
// island, or page in a Fresh 2 project. Run from inside the project:
//
//   isolate list              list discovered components + their cases/routes
//   isolate dev               build & serve the preview app, open the browser
//   isolate test [filter]     run cases' Playwright tests headlessly (--json for CI)
//   isolate update            reinstall the latest skills + this CLI
//
// --root <path> points at a Fresh project elsewhere (default: the current dir).
// NB: json-stdout MUST be the first import — it reroutes console.log to stderr in
// --json mode BEFORE the command modules' import-time server bootstrap can log.
import "./lib/json-stdout.ts";
import { Command } from "@cliffy/command";
import { colors } from "@cliffy/ansi/colors";
import { listCmd } from "./commands/list.ts";
import { devCmd } from "./commands/dev.ts";
import { testCmd } from "./commands/test.ts";
import { updateCmd } from "./commands/update.ts";

const cli = new Command()
  .name("isolate")
  .version("0.5.0")
  .description(
    "Live, typed previews for Fresh 2 components — no config, no separate build.",
  )
  .globalOption(
    "-r, --root <path:string>",
    "The Fresh project to isolate.",
    { default: "." },
  )
  .default("list")
  .command("list", listCmd)
  .command("dev", devCmd)
  .command("test", testCmd)
  .command("update", updateCmd)
  .error((err: Error) => {
    console.error(colors.red("✗ ") + err.message);
    Deno.exit(1);
  });

if (import.meta.main) {
  await cli.parse(Deno.args);
}
