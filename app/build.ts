// Build the @app/web sprig app: code-split islands + scope CSS + Tailwind → static/.
// The framework compiler lives at framework/.sprig; this app's source is app/src.
// Run from the repo root:  deno task build:app   (or  deno run -A app/build.ts).
import { buildClient } from "../framework/.sprig/compiler/build.ts";
import { dirname, fromFileUrl, join } from "@std/path";

const here = dirname(fromFileUrl(import.meta.url)); // app/
const srcDir = join(here, "src");
const outDir = join(Deno.cwd(), "static");
const dev = Deno.args.includes("--dev");

const r = await buildClient(srcDir, outDir, { dev });
console.log(
  `sprig build${dev ? " (dev)" : ""}: ${r.islands.length} island chunk(s) ` +
    `[${r.islands.join(", ")}] + ${r.chunks.length} shared chunk(s) → ${outDir} ` +
    `(${(r.bytes / 1024).toFixed(1)}kb, v=${r.hash})`,
);
