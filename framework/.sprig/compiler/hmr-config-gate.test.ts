// Phase 3 — dev serves the BYTE-IDENTICAL prod bundle; HMR is a dormant receiver in the
// runtime, ACTIVATED out-of-band by a single runtime DATA flag the SSR emits: cfg.hmr.
// There is no dev bundle variant anymore, so the ONLY thing that distinguishes a dev document
// from a prod one is this flag — and it is gated strictly on the renderer's dev option (which
// the CLI drives from SPRIG_DEV). This pins BOTH directions of that gate, in BOTH render paths
// (renderDocument + renderStream), so a regression that leaks the flag into prod — or drops it
// in dev — fails loudly. The client bundle is unaffected either way (proven separately by the
// build byte-identity diff); this is purely the SSR activation switch.
import { assert } from "jsr:@std/assert";
import { dirname, join as joinPath } from "@std/path";
import { createRenderer } from "./mod.ts";

async function makeRenderer(dev: boolean) {
  const tmp = await Deno.makeTempDir({ prefix: "sprig-hmr-gate-" });
  for (const [rel, body] of Object.entries({
    "shell/template.html": `<div><router-outlet></router-outlet></div>`,
    "pages/home/template.html": `<p>hi</p>`,
  })) {
    const path = joinPath(tmp, ...rel.split("/"));
    await Deno.mkdir(dirname(path), { recursive: true });
    await Deno.writeTextFile(path, body);
  }
  const r = await createRenderer(tmp, "/ui", { dev });
  return { r, cleanup: () => Deno.remove(tmp, { recursive: true }) };
}

Deno.test("PROD (dev:false): renderDocument omits cfg.hmr — the dormant receiver never wakes", async () => {
  const { r, cleanup } = await makeRenderer(false);
  try {
    const html = await r.renderDocument("pages/home", {});
    assert(!html.includes(`"hmr"`), `prod document must NOT carry an hmr flag; got:\n${configOf(html)}`);
  } finally {
    await cleanup();
  }
});

Deno.test("DEV (dev:true): renderDocument emits cfg.hmr:true — activates the compiled-in HMR client", async () => {
  const { r, cleanup } = await makeRenderer(true);
  try {
    const html = await r.renderDocument("pages/home", {});
    assert(html.includes(`"hmr":true`), `dev document must carry hmr:true; got:\n${configOf(html)}`);
  } finally {
    await cleanup();
  }
});

Deno.test("renderStream matches renderDocument on the hmr gate (head+tail concat is transparent)", async () => {
  const prod = await makeRenderer(false);
  try {
    const html = await new Response(prod.r.renderStream("pages/home", {})).text();
    assert(!html.includes(`"hmr"`), "streamed prod document must NOT carry an hmr flag");
  } finally {
    await prod.cleanup();
  }
  const dev = await makeRenderer(true);
  try {
    const html = await new Response(dev.r.renderStream("pages/home", {})).text();
    assert(html.includes(`"hmr":true`), "streamed dev document must carry hmr:true");
  } finally {
    await dev.cleanup();
  }
});

/** The __sprig_config JSON blob, for a legible assertion message. */
function configOf(html: string): string {
  return html.match(/id="__sprig_config">([^<]*)</)?.[1] ?? "(no __sprig_config found)";
}
