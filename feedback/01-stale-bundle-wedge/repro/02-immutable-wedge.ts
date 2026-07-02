// Repro 2 — serveAsset sends `cache-control: public, max-age=31536000, immutable`
// unconditionally (packages/keep/mod.ts:126). Combined with the frozen `?v=dev` URL
// from repro 01, a returning browser is contractually forbidden from ever refetching
// the bundle after a redeploy: `immutable` means "skip revalidation, even on reload"
// (RFC 9111 §5.2.2.2 / the immutable extension). This script simulates exactly the
// production incident: deploy 1 is cached, deploy 2 ships, the browser runs a mix.
//
// Run from the repo root:
//   deno run -A feedback/01-stale-bundle-wedge/repro/02-immutable-wedge.ts
import { serveSprig, type KeepApi } from "@sprig/keep";
import { makeApp } from "./fixture-app/main.ts";
import { join } from "@std/path";

// A cwd with no static/ so the rendered HTML carries ?v=dev (see repro 01).
const work = await Deno.makeTempDir({ prefix: "sprig-repro-wedge-" });
Deno.chdir(work);

const assetsDir = join(work, "assets");
await Deno.mkdir(assetsDir);

// ── deploy 1: content-hashed chunk names, exactly like the real esbuild output ──
const deploy1 = {
  "client.js": `import "./chunk-OLD1111.js"; // runtime chunk of deploy 1`,
  "chunk-OLD1111.js": `// sprig runtime copy, deploy 1`,
  "isl.home.js": `import "./chunk-OLD1111.js"; // island compiled against deploy 1's runtime`,
};
for (const [name, body] of Object.entries(deploy1)) {
  await Deno.writeTextFile(join(assetsDir, name), body);
}

const keepStub = {
  backend: { fetch: (() => Promise.resolve(new Response("null"))) as typeof fetch },
  handler: () => new Response("stub"),
} as KeepApi;
const server = serveSprig({ keep: keepStub, app: await makeApp(), base: "/ui", assetsDir });
const http = (path: string) => server.fetch(new Request(`http://localhost${path}`), {} as Deno.ServeHandlerInfo);

// ── a minimal standards-compliant browser cache: `immutable` ⇒ reuse without any
// revalidation for max-age (a reload does NOT bypass it — that is its entire point) ──
type Entry = { body: string; cc: string; status: number };
const browserCache = new Map<string, Entry>();
async function browserGet(path: string): Promise<Entry & { from: "cache" | "network" }> {
  const hit = browserCache.get(path);
  if (hit && hit.cc.includes("immutable")) return { ...hit, from: "cache" };
  const res = await http(path);
  const entry: Entry = { body: await res.text(), cc: res.headers.get("cache-control") ?? "", status: res.status };
  if (res.ok && entry.cc.includes("max-age")) browserCache.set(path, entry);
  return { ...entry, from: "network" };
}

// ── visit 1 (while deploy 1 is live) ──
const html1 = await browserGet("/ui");
const assetUrl = html1.body.match(/"([^"]*client\.js\?v=[A-Za-z0-9]+)"/)?.[1]!;
const client1 = await browserGet(assetUrl);
await browserGet("/ui/_assets/chunk-OLD1111.js"); // pulled in by client.js
await browserGet("/ui/_assets/isl.home.js?v=dev"); // island, hydrated on page 1
console.log(`visit 1: HTML cache-control="${html1.cc}" → not cached (good)`);
console.log(`visit 1: ${assetUrl} → ${client1.from}, cache-control="${client1.cc}"`);

// ── redeploy: new build, new chunk hash, old chunk GONE from the server ──
await Deno.remove(join(assetsDir, "chunk-OLD1111.js"));
const deploy2 = {
  "client.js": `import "./chunk-NEW2222.js"; // runtime chunk of deploy 2`,
  "chunk-NEW2222.js": `// sprig runtime copy, deploy 2`,
  "isl.home.js": `import "./chunk-NEW2222.js"; // island compiled against deploy 2's runtime`,
};
for (const [name, body] of Object.entries(deploy2)) {
  await Deno.writeTextFile(join(assetsDir, name), body);
}
// browsers evict cache entries independently — a bundle is not cached transactionally.
// Safari kept client.js + the chunk but not this island file (any new island added in
// deploy 2 behaves identically: it simply was never cached).
browserCache.delete("/ui/_assets/isl.home.js?v=dev");

// ── visit 2 (deploy 2 is live) ──
const html2 = await browserGet("/ui");
const assetUrl2 = html2.body.match(/"([^"]*client\.js\?v=[A-Za-z0-9]+)"/)?.[1]!;
const client2 = await browserGet(assetUrl2);
const isl2 = await browserGet("/ui/_assets/isl.home.js?v=dev");
const oldChunkNow = await http("/ui/_assets/chunk-OLD1111.js");

console.log(`\nvisit 2 (after redeploy):`);
console.log(`  HTML is fresh (no-store) and still references: ${assetUrl2}`);
console.log(`  client.js → ${client2.from}: "${client2.body}"`);
console.log(`  isl.home.js → ${isl2.from}: "${isl2.body}"`);
console.log(`  chunk-OLD1111.js on the server now: HTTP ${oldChunkNow.status} (the exact 404 observed in prod)`);

if (client2.from !== "cache") throw new Error("expected the immutable-cached client.js to be reused");
if (!client2.body.includes("chunk-OLD1111") || !isl2.body.includes("chunk-NEW2222")) {
  throw new Error("expected the mixed-deploy state");
}
console.log(`\nFAIL (expected): the browser now executes deploy 1's client.js (imports chunk-OLD1111)`);
console.log(`next to deploy 2's isl.home.js (imports chunk-NEW2222) — TWO copies of the sprig`);
console.log(`runtime in one document. Repro 03 shows why that kills every island with the`);
console.log(`"inject() must be called synchronously..." error. No reload can fix it: the URL`);
console.log(`never changes and 'immutable' forbids revalidation for a year.`);
