// REGRESSION (feedback/bug-report.md): `immutable` may only ever be sent for a
// CONTENT-ADDRESSED request. serveAsset used to send `public, max-age=31536000,
// immutable` unconditionally — so when the ?v= cache-bust degraded to the constant
// "dev" (frozen across deploys), returning browsers pinned a dead deploy's bundle for
// a year with no revalidation and every island failed to hydrate. The rule now:
//   ?v= equals the served dir's CURRENT content hash → immutable
//   content-hash-NAMED chunk (chunk-XXXXXXXX.js)     → immutable (addressed by name)
//   anything else (?v=dev, missing, stale hash)      → no-cache (ETag/304 revalidation)
// And the SAME hash is threaded to the app as env.assetsVersion, so the rendered ?v=
// and the immutable check can never disagree.
import { assert, assertEquals, assertStringIncludes } from "jsr:@std/assert";
import { join } from "@std/path";
import { type KeepApi, serveSprig, sprigUi } from "./mod.ts";
import { versionOf } from "../../framework/.sprig/compiler/hash.ts";
import type { SprigApp } from "@sprig/core";

async function makeAssets(files: Record<string, string> = {}): Promise<string> {
  const dir = await Deno.makeTempDir({ prefix: "sprig-asset-cc-" });
  const defaults = {
    "client.js": `import "./chunk-AB12CD34.js"; // deploy 1`,
    "app.css": "body{color:red}",
    "isl.home.js": `import "./chunk-AB12CD34.js";`,
    "chunk-AB12CD34.js": "// the shared runtime chunk (esbuild content-hash name)",
    "chunk-utils.js": "// a hand-authored file that merely LOOKS chunk-ish",
  };
  for (const [name, body] of Object.entries({ ...defaults, ...files })) {
    await Deno.writeTextFile(join(dir, name), body);
  }
  return dir;
}

function fakeApp(): { app: SprigApp; lastEnv: () => { backend?: unknown; assetsVersion?: string } | undefined } {
  let env: { backend?: unknown; assetsVersion?: string } | undefined;
  const app = {
    fetch: (_req: Request, _info?: Deno.ServeHandlerInfo, e?: { backend?: unknown; assetsVersion?: string }) => {
      env = e;
      return Promise.resolve(new Response("SSR", { status: 200 }));
    },
  } as unknown as SprigApp;
  return { app, lastEnv: () => env };
}

const get = (p: string, headers?: Record<string, string>) => new Request("http://host" + p, { headers });
const cc = (r: Response) => r.headers.get("cache-control");

Deno.test("serveAsset header matrix: immutable ONLY for content-addressed requests", async () => {
  const dir = await makeAssets();
  const hash = await versionOf(dir);
  assert(hash, "fixture dir must hash");
  const ui = sprigUi({ app: fakeApp().app, base: "/ui", assetsDir: dir });

  try {
    // current-hash ?v= → content-addressed → immutable (long-term caching kept)
    const current = (await ui(get(`/ui/_assets/client.js?v=${hash}`)))!;
    assertEquals(cc(current), "public, max-age=31536000, immutable");

    // the degraded constant → NOT addressed → revalidate (this is the wedge killer)
    assertEquals(cc((await ui(get("/ui/_assets/client.js?v=dev")))!), "no-cache");
    // missing ?v= → NOT addressed
    assertEquals(cc((await ui(get("/ui/_assets/client.js")))!), "no-cache");
    // a STALE hash (an older deploy's ?v=, still referenced by a wedged browser) →
    // no-cache with the CURRENT bytes, so the browser can't re-pin the old deploy
    assertEquals(cc((await ui(get("/ui/_assets/client.js?v=0123456789abcdef")))!), "no-cache");
    // empty ?v= → NOT addressed
    assertEquals(cc((await ui(get("/ui/_assets/client.js?v=")))!), "no-cache");
    // isl + app.css follow the same rule
    assertEquals(cc((await ui(get(`/ui/_assets/isl.home.js?v=${hash}`)))!), "public, max-age=31536000, immutable");
    assertEquals(cc((await ui(get("/ui/_assets/app.css?v=dev")))!), "no-cache");

    // an esbuild content-hash-NAMED chunk is addressed by its FILENAME (chunks are
    // imported via bare relative imports — no ?v= — and a new build means a new name)
    assertEquals(cc((await ui(get("/ui/_assets/chunk-AB12CD34.js")))!), "public, max-age=31536000, immutable");
    // ...but the pattern is tight: a hand-authored near-miss must NOT be pinned
    assertEquals(cc((await ui(get("/ui/_assets/chunk-utils.js")))!), "no-cache");
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
});

Deno.test("conditional GET still 304s on BOTH cache-control branches", async () => {
  const dir = await makeAssets();
  const hash = await versionOf(dir);
  const ui = sprigUi({ app: fakeApp().app, base: "/ui", assetsDir: dir });
  try {
    for (const q of [`?v=${hash}`, "?v=dev"]) {
      const first = (await ui(get(`/ui/_assets/client.js${q}`)))!;
      const etag = first.headers.get("etag")!;
      assert(etag, "asset responses carry an etag");
      await first.body?.cancel();
      const second = (await ui(get(`/ui/_assets/client.js${q}`, { "if-none-match": etag })))!;
      assertEquals(second.status, 304, `revalidation is one cheap 304 for "${q}"`);
    }
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
});

Deno.test("sprigUi threads env.assetsVersion = the served dir's hash into app.fetch", async () => {
  const dir = await makeAssets();
  const hash = await versionOf(dir);
  const { app, lastEnv } = fakeApp();
  const ui = sprigUi({ app, base: "/ui", assetsDir: dir });
  try {
    await (await ui(get("/ui/page")))!.body?.cancel();
    assertEquals(lastEnv()?.assetsVersion, hash, "the SSR env carries the hash of the dir the assets are ACTUALLY served from");
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
});

Deno.test("serveSprig: same env threading + immutable-only-on-match (the composed root)", async () => {
  const dir = await makeAssets();
  const hash = await versionOf(dir);
  const { app, lastEnv } = fakeApp();
  const keepStub = {
    backend: { fetch: (() => Promise.resolve(new Response("null"))) as typeof fetch },
    handler: () => new Response("stub"),
  } as KeepApi;
  const server = serveSprig({ keep: keepStub, app, base: "/ui", assetsDir: dir });
  const http = (p: string) => server.fetch(get(p), {} as Deno.ServeHandlerInfo);
  try {
    await (await http("/ui")).body?.cancel();
    assertEquals(lastEnv()?.assetsVersion, hash);
    assert(lastEnv()?.backend, "backend still threaded alongside assetsVersion");
    assertEquals(cc(await http(`/ui/_assets/client.js?v=${hash}`)), "public, max-age=31536000, immutable");
    assertEquals(cc(await http("/ui/_assets/client.js?v=dev")), "no-cache");
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
});

Deno.test("redeploy: the old deploy's ?v= stops being immutable, the new one starts (inverts repro 02)", async () => {
  const dir = await makeAssets();
  const hash1 = await versionOf(dir);
  const ui1 = sprigUi({ app: fakeApp().app, base: "/ui", assetsDir: dir });
  try {
    assertEquals(cc((await ui1(get(`/ui/_assets/client.js?v=${hash1}`)))!), "public, max-age=31536000, immutable");

    // ── redeploy: new bytes, new chunk name (a fresh process serves the new build) ──
    await Deno.remove(join(dir, "chunk-AB12CD34.js"));
    await Deno.writeTextFile(join(dir, "client.js"), `import "./chunk-EF56GH78.js"; // deploy 2`);
    await Deno.writeTextFile(join(dir, "chunk-EF56GH78.js"), "// runtime chunk, deploy 2");
    await Deno.writeTextFile(join(dir, "isl.home.js"), `import "./chunk-EF56GH78.js";`);
    const hash2 = await versionOf(dir);
    assert(hash2 && hash2 !== hash1, "an asset change must change the content version");

    const ui2 = sprigUi({ app: fakeApp().app, base: "/ui", assetsDir: dir });
    // a wedged browser still asking for deploy 1's URL gets revalidate-able CURRENT bytes
    const stale = (await ui2(get(`/ui/_assets/client.js?v=${hash1}`)))!;
    assertEquals(cc(stale), "no-cache");
    assertStringIncludes(await stale.text(), "deploy 2", "stale ?v= serves the CURRENT bytes, revalidatable");
    // the new deploy's URL is content-addressed again
    assertEquals(cc((await ui2(get(`/ui/_assets/client.js?v=${hash2}`)))!), "public, max-age=31536000, immutable");
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
});

Deno.test("in-place rebuild: the SAME server instance tracks the new version (dev HMR / build-under-a-running-server)", async () => {
  const dir = await makeAssets();
  try {
    const hash1 = await versionOf(dir);
    const { app, lastEnv } = fakeApp();
    const ui = sprigUi({ app, base: "/ui", assetsDir: dir });
    assertEquals(cc((await ui(get(`/ui/_assets/client.js?v=${hash1}`)))!), "public, max-age=31536000, immutable");

    // a rebuild rewrites the bundle in place — the SAME ui instance must follow: a
    // startup-frozen hash would keep blessing the OLD ?v= as immutable over NEW bytes,
    // recreating the exact wedge this fix removes.
    await Deno.writeTextFile(join(dir, "client.js"), "// rebuilt");
    const hash2 = await versionOf(dir);
    assert(hash2 !== hash1);
    assertEquals(cc((await ui(get(`/ui/_assets/client.js?v=${hash1}`)))!), "no-cache", "pre-rebuild ?v= is no longer addressed");
    assertEquals(cc((await ui(get(`/ui/_assets/client.js?v=${hash2}`)))!), "public, max-age=31536000, immutable");
    await (await ui(get("/ui/page")))!.body?.cancel();
    assertEquals(lastEnv()?.assetsVersion, hash2, "env.assetsVersion follows the rebuild too");
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
});

Deno.test("degraded assets dir (missing/empty): nothing is immutable, env carries no version", async () => {
  const empty = await Deno.makeTempDir({ prefix: "sprig-asset-empty-" });
  const { app, lastEnv } = fakeApp();
  const ui = sprigUi({ app, base: "/ui", assetsDir: empty });
  try {
    assertEquals(await versionOf(empty), null, "an empty dir has no content version");
    await (await ui(get("/ui/page")))!.body?.cancel();
    assertEquals(lastEnv()?.assetsVersion, undefined, "no fake version is invented");
    // a dir that appears later can still never match a null version
    await Deno.writeTextFile(join(empty, "late.js"), "// appeared after startup");
    assertEquals(cc((await ui(get("/ui/_assets/late.js?v=dev")))!), "no-cache");
  } finally {
    await Deno.remove(empty, { recursive: true });
  }
});
