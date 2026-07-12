// --json stdout hygiene (feedback/plan.md B1). The `--json` contract is "stdout is
// exactly one JSON document", but the in-process server modules log at IMPORT time
// (Danet's Injector/Router boot lines, keep's route-audit) — long before any command's
// action() runs, so an action-level console reroute can never catch them. This module
// is the FIRST import of cli/main.ts: its module body evaluates before the command
// modules (and their server imports), so in --json mode every console.log/info/debug
// is rerouted to stderr for the whole process lifetime, and the one JSON report is
// written through emitJson() to the real stdout.
const JSON_MODE = Deno.args.includes("--json") || Deno.args.includes("-j");

if (JSON_MODE) {
  console.log = console.info = console.debug = (...a: unknown[]) => console.error(...a);
}

/** Was the process started in --json mode? (raw-args scan — evaluated pre-parse) */
export function jsonMode(): boolean {
  return JSON_MODE;
}

/** Write the single JSON report document to the REAL stdout — console.log is rerouted
 *  to stderr in --json mode, so the report must bypass it. */
export function emitJson(text: string): void {
  Deno.stdout.writeSync(new TextEncoder().encode(text + "\n"));
}
