// Repro 1 — the `?v=` asset cache-bust is computed from `SPRIG_ASSETS_DIR || <cwd>/static`
// (framework/.sprig/compiler/mod.ts:175), NOT from the assetsDir the app hands to
// serveSprig. Two failure modes, both shown below in one run:
//
//   A. cwd has no static/ (every Deno Deploy deployment) → silent fallback to the
//      CONSTANT "dev" (mod.ts:184-186). The asset URL never changes across deploys.
//   B. cwd happens to contain an unrelated static/ (e.g. a monorepo root) → ?v= is a
//      hash of that unrelated dir, which never changes when the app redeploys. Same
//      frozen-URL outcome, harder to spot.
//
// Run from the repo root:
//   deno run -A feedback/repro/01-frozen-version.ts
import { makeApp } from "./fixture-app/main.ts";
import { dirname, fromFileUrl, join } from "@std/path";

const repoRoot = join(dirname(fromFileUrl(import.meta.url)), "..", "..");

async function renderedVersion(): Promise<string> {
  // createRenderer computes the version ONCE at creation (prod path), so a fresh
  // app per cwd is exactly what a deployed isolate does at cold start.
  const app = await makeApp();
  const res = await app.fetch(new Request("http://localhost/ui"));
  const html = await res.text();
  return html.match(/client\.js\?v=([A-Za-z0-9]+)/)?.[1] ?? "(no client.js reference)";
}

// A: a cwd with no static/ — the Deno Deploy condition.
const bare = await Deno.makeTempDir({ prefix: "sprig-repro-cwd-" });
Deno.chdir(bare);
const vA = await renderedVersion();

// B: a cwd that has its own (unrelated) static/ — e.g. this repo's root.
Deno.chdir(repoRoot);
const vB = await renderedVersion();

console.log(`\nfixture assets dir (what serveSprig would serve): feedback/repro/fixture-app — NEVER hashed`);
console.log(`A. cwd=${bare} (no static/)        → ?v=${vA}`);
console.log(`B. cwd=${repoRoot} (unrelated static/) → ?v=${vB}`);

if (vA !== "dev") throw new Error("expected the silent 'dev' fallback in case A");
console.log(`\nFAIL (expected): case A degraded to the constant "dev" with no warning;`);
console.log(`case B hashed a directory unrelated to the served assets. In both cases the`);
console.log(`asset URL is frozen across redeploys — see 02 for why that wedges browsers.`);
