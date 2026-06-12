#!/usr/bin/env -S deno run --allow-read --allow-env --allow-net --allow-write --allow-run
/**
 * Standalone design-lint CLI entry.
 *
 * Thin wrapper over the vendored impeccable detect engine. The engine's
 * detectCli() reads process.argv / process.stdin and calls process.exit(),
 * all of which Deno's node-compat layer provides.
 *
 *   deno task lint <file|dir>              # static HTML/CSS/JSX scan (zero deps)
 *   deno task lint:url https://example.com # full browser scan via Astral
 */
import { detectCli } from "../src/engine/detect-antipatterns.mjs";

await detectCli();
