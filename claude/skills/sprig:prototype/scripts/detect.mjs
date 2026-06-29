#!/usr/bin/env node

/**
 * Detection entrypoint for the prototype skill.
 *
 * This forwards to the toolchain's standalone Deno linter ("design-lint"),
 * which vendors the impeccable detection engine and runs under Deno with no
 * npm/node_modules (URL scanning via Astral instead of Puppeteer). The skill
 * no longer ships its own copy of the engine — design-lint is the single
 * source of truth.
 *
 * Invocation (unchanged for the agent):
 *   node .claude/skills/sprig:prototype/scripts/detect.mjs --json <targets...>
 *
 * Resolving design-lint (first hit wins):
 *   1. $DESIGN_LINT_BIN   — absolute path to design-lint/bin/detect.mjs
 *   2. $DESIGN_LINT_DIR   — directory containing bin/detect.mjs
 *   3. a `design-lint/bin/detect.mjs` found by walking up from this script
 */

import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

function resolveDesignLintBin() {
  if (process.env.DESIGN_LINT_BIN && fs.existsSync(process.env.DESIGN_LINT_BIN)) {
    return process.env.DESIGN_LINT_BIN;
  }
  if (process.env.DESIGN_LINT_DIR) {
    const p = path.join(process.env.DESIGN_LINT_DIR, 'bin', 'detect.mjs');
    if (fs.existsSync(p)) return p;
  }
  // Walk up from the skill looking for a sibling design-lint checkout.
  let dir = __dirname;
  for (let i = 0; i < 8; i++) {
    const candidate = path.join(dir, 'design-lint', 'bin', 'detect.mjs');
    if (fs.existsSync(candidate)) return candidate;
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return null;
}

const bin = resolveDesignLintBin();
if (!bin) {
  process.stderr.write(
    'Error: design-lint not found. Set DESIGN_LINT_DIR (the design-lint checkout) ' +
    'or DESIGN_LINT_BIN (path to design-lint/bin/detect.mjs).\n',
  );
  process.exit(1);
}

// Invoke `deno run` explicitly (rather than executing the bin's shebang) so it
// works regardless of the executable bit, and so design-lint's import map
// (puppeteer -> Astral shim) is in effect.
const denoArgs = [
  'run',
  '--allow-read',
  '--allow-env',
  '--allow-net',
  '--allow-write',
  '--allow-run',
  bin,
  ...process.argv.slice(2),
];

const result = spawnSync('deno', denoArgs, { stdio: 'inherit' });
if (result.error) {
  if (result.error.code === 'ENOENT') {
    process.stderr.write('Error: `deno` not found on PATH. design-lint requires Deno.\n');
    process.exit(1);
  }
  throw result.error;
}
// Preserve the engine's exit semantics: 2 = findings, 0 = clean.
process.exit(result.status ?? 1);
