// REGRESSION (feedback/bug-report.md, defect 1 + 3): the renderer's own readVersion()
// hashes SPRIG_ASSETS_DIR || <cwd>/static — a guess that is wrong exactly where it
// matters (Deno Deploy's cwd is not the app dir), where it silently degraded to the
// constant "dev" and froze the asset URLs across every redeploy. Now:
//   1. an env-threaded assetsVersion (the hash of the dir serveSprig ACTUALLY serves)
//      wins over readVersion() in renderDocument AND renderStream;
//   2. when a NON-dev render actually goes out degraded (?v=dev, no env version), the
//      renderer warns ONCE, naming the directory it tried — no more silent detonation.
import { assert, assertEquals, assertStringIncludes } from "jsr:@std/assert";
import { dirname, join as joinPath } from "@std/path";
import { createRenderer } from "./mod.ts";

async function writeTree(tmp: string, files: Record<string, string>) {
  for (const [rel, body] of Object.entries(files)) {
    const path = joinPath(tmp, ...rel.split("/"));
    await Deno.mkdir(dirname(path), { recursive: true });
    await Deno.writeTextFile(path, body);
  }
}

/** A minimal app tree in a cwd WITHOUT a static/ dir — the Deno Deploy condition
 *  (readVersion degrades to "dev" there). */
async function makeDegradedRenderer() {
  const tmp = await Deno.makeTempDir({ prefix: "sprig-version-env-" });
  await writeTree(tmp, {
    "shell/template.html": `<div><router-outlet></router-outlet></div>`,
    "pages/home/template.html": `<p>hi</p>`,
  });
  const cwd = Deno.cwd();
  const bare = await Deno.makeTempDir({ prefix: "sprig-version-env-cwd-" });
  Deno.chdir(bare); // no static/ here
  const restore = () => Deno.chdir(cwd);
  return { tmp, restore };
}

const vsOf = (html: string) => ({
  client: html.match(/client\.js\?v=([A-Za-z0-9]+)/)?.[1],
  css: html.match(/app\.css\?v=([A-Za-z0-9]+)/)?.[1],
  cfg: html.match(/"v":"([A-Za-z0-9]+)"/)?.[1],
});

Deno.test("renderDocument prefers the env-threaded assetsVersion over its own readVersion()", async () => {
  const { tmp, restore } = await makeDegradedRenderer();
  try {
    const r = await createRenderer(tmp, "/ui", {});
    const html = await r.renderDocument("pages/home", {}, { assetsVersion: "cafe1234beef5678" });
    const v = vsOf(html);
    assertEquals(v.client, "cafe1234beef5678", "client.js is stamped with the SERVED dir's hash");
    assertEquals(v.css, "cafe1234beef5678", "app.css too");
    assertEquals(v.cfg, "cafe1234beef5678", "__sprig_config.v too (island imports use it)");
  } finally {
    restore();
    await Deno.remove(tmp, { recursive: true });
  }
});

Deno.test("renderStream stamps the env version in head AND tail", async () => {
  const { tmp, restore } = await makeDegradedRenderer();
  try {
    const r = await createRenderer(tmp, "/ui", {});
    const html = await new Response(r.renderStream("pages/home", {}, { assetsVersion: "cafe1234beef5678" })).text();
    const v = vsOf(html);
    assertEquals(v.client, "cafe1234beef5678");
    assertEquals(v.cfg, "cafe1234beef5678");
    assert(!html.includes("?v=dev"), "no degraded URL survives when the env supplies the version");
  } finally {
    restore();
    await Deno.remove(tmp, { recursive: true });
  }
});

Deno.test("a degraded NON-dev render warns ONCE, naming the directory it tried", async () => {
  const { tmp, restore } = await makeDegradedRenderer();
  const warns: string[] = [];
  const origWarn = console.warn;
  console.warn = (...a: unknown[]) => warns.push(a.join(" "));
  try {
    const r = await createRenderer(tmp, "/ui", {});
    assertEquals(warns.length, 0, "no warning at boot — serveSprig apps get their version per request");

    const html = await r.renderDocument("pages/home", {}); // no env version → degraded
    assertStringIncludes(html, "?v=dev", "the fallback itself is unchanged");
    assertEquals(warns.length, 1, "the FIRST degraded render warns");
    assertStringIncludes(warns[0], "[sprig]");
    assertStringIncludes(warns[0], joinPath(Deno.cwd(), "static"), "names the dir it tried to hash");

    await r.renderDocument("pages/home", {});
    assertEquals(warns.length, 1, "…and only the first (once per process)");

    warns.length = 0;
    await r.renderDocument("pages/home", {}, { assetsVersion: "cafe1234beef5678" });
    assertEquals(warns.length, 0, "an env-supplied version is not a degraded render");
  } finally {
    console.warn = origWarn;
    restore();
    await Deno.remove(tmp, { recursive: true });
  }
});
