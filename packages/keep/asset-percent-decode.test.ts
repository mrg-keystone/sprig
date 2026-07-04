// BUG P: serveAsset does NOT percent-decode the file segment before disk lookup,
// so a non-ASCII island asset (e.g. isl.café-card.js) requested percent-encoded
// (isl.caf%C3%A9-card.js) misses on Deno.stat → 404 → island never loads.
// The dev AST endpoint (dev.ts:145) already decodeURIComponent's its segment.
//
// CORRECT behavior: the encoded request returns 200 + the file's bytes.
// Also: a malformed "%" path → 400, and a "..%2f" traversal is still blocked (403).
import { assert, assertEquals } from "jsr:@std/assert";
import { sprigUi } from "./mod.ts";
import type { SprigApp } from "@mrg-keystone/sprig";

const fakeApp: SprigApp = {
  fetch: () => Promise.resolve(new Response("SSR", { status: 200 })),
} as unknown as SprigApp;

const get = (p: string) => new Request("http://host" + p);

async function withAssetDir(
  fn: (dir: string) => Promise<void>,
): Promise<void> {
  const dir = await Deno.makeTempDir();
  try {
    await fn(dir);
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
}

Deno.test("BUG P: a percent-encoded non-ASCII asset name is decoded and served (200 + bytes)", async () => {
  await withAssetDir(async (dir) => {
    const name = "isl.café-card.js"; // non-ASCII basename
    const contents = "export const x = 1;\n";
    await Deno.writeTextFile(`${dir}/${name}`, contents);

    const ui = sprigUi({ app: fakeApp, base: "/ui", assetsDir: dir });
    // the browser requests the percent-ENCODED form
    const encoded = "/ui/_assets/" + encodeURIComponent(name);
    const res = await ui(get(encoded));
    assert(res, "asset path is ours");
    assertEquals(res!.status, 200, "decoded asset must be found and served");
    assertEquals(await res!.text(), contents, "served bytes match the file");
  });
});

Deno.test("BUG P: a malformed percent-escape in the asset path → 400", async () => {
  await withAssetDir(async (dir) => {
    const ui = sprigUi({ app: fakeApp, base: "/ui", assetsDir: dir });
    // lone "%" is not a valid escape → decodeURIComponent throws
    const res = await ui(get("/ui/_assets/bad%"));
    assert(res, "asset path is ours");
    assertEquals(res!.status, 400, "malformed escape must be a clean 400, not a crash");
  });
});

Deno.test("BUG P: an encoded traversal (..%2f) is still blocked (403)", async () => {
  await withAssetDir(async (dir) => {
    await Deno.writeTextFile(`${dir}/secret.js`, "TOP SECRET");
    const ui = sprigUi({ app: fakeApp, base: "/ui", assetsDir: dir });
    // "..%2fsecret.js" decodes to "../secret.js" — must be rejected AFTER decoding.
    const res = await ui(get("/ui/_assets/..%2fsecret.js"));
    assert(res, "asset path is ours");
    assertEquals(res!.status, 403, "decoded traversal segment must be forbidden");
  });
});
