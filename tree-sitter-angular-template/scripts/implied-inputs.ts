#!/usr/bin/env -S deno run -A
/**
 * implied-inputs.ts — infer a logic-less component's @inputs from its template.
 *
 * A component with NO logic.ts is STATIC: it has no scope, so every free name its template
 * reads is an implied @input (filled at SSR by the parent / page resolver). This tool extracts
 * that set from the template AST via the tree-sitter grammar, so `{{ name }}`-only components
 * need no .ts file at all.
 *
 *   implied inputs = referenced identifiers
 *                    − per-occurrence non-inputs (.member props, pipe names, object keys, call fns)
 *                    − locally-bound names (@for / @let / #ref / arrow params, all usages)
 *                    − globals ($-prefixed, literals)
 *
 * If the template is interactive ((event)/[(two-way)]/method call), it CANNOT be static and a
 * logic.ts is required — reported as requiresLogic.
 *
 * Usage (run from the grammar dir):  deno run -A scripts/implied-inputs.ts <template.html>
 */
const file = Deno.args[0];
if (!file) {
  console.error("usage: deno run -A scripts/implied-inputs.ts <template.html>");
  Deno.exit(2);
}

const { stdout, code } = await new Deno.Command("tree-sitter", {
  args: ["query", new URL("../queries/inputs.scm", import.meta.url).pathname, file],
  stdout: "piped",
  stderr: "inherit",
}).output();
if (code !== 0) Deno.exit(code);

const refs: Array<{ range: string; name: string }> = [];
const notInputRanges = new Set<string>();
const boundNames = new Set<string>();
let interactive = false;

const LINE =
  /capture:\s*(?:\d+\s*-\s*)?(\w+),\s*start:\s*\((\d+),\s*(\d+)\),\s*end:\s*\((\d+),\s*(\d+)\),\s*text:\s*`([\s\S]*?)`\s*$/;

for (const line of new TextDecoder().decode(stdout).split("\n")) {
  const m = line.match(LINE);
  if (!m) continue;
  const [, cap, sr, sc, er, ec, text] = m;
  const range = `${sr},${sc}-${er},${ec}`;
  if (cap === "ref") refs.push({ range, name: text });
  else if (cap === "notinput") notInputRanges.add(range);
  else if (cap === "bound") boundNames.add(text);
  else if (cap === "interactive") interactive = true;
}

const isGlobal = (n: string) =>
  n.startsWith("$") || ["null", "undefined", "this", "true", "false"].includes(n);

const inputs = [
  ...new Set(
    refs
      .filter((r) => !notInputRanges.has(r.range) && !boundNames.has(r.name) && !isGlobal(r.name))
      .map((r) => r.name),
  ),
].sort();

console.log(JSON.stringify({ inputs, requiresLogic: interactive }, null, 2));
