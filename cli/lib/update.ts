// `isolate update` — refresh this machine to the latest GitHub release:
// download the bundle (cli + ui + server + skills), swap it into ~/.isolate,
// reinstall the skills at ~/.claude/skills, and re-point the global `isolate` bin.
// The UI ships inside the bundle, so it updates along with the CLI.
import { updateFromGitHub } from "./install-core.ts";

export async function cmdUpdate(): Promise<void> {
  await updateFromGitHub();
}
