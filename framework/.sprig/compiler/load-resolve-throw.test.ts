// BUG R: loadResolve (mod.ts) wrapped the dynamic import() of resolve.ts in a bare
// try/catch that mapped EVERY error to undefined ("no resolve.ts → static page"). So a
// resolve.ts that EXISTS but throws at import time (syntax/init error) was silently
// treated as "no loader", hiding the real fault — violating the documented meaning of
// undefined ("the page has none"). The fix: stat the file first; a genuinely missing
// resolve.ts → undefined, but an existing one that throws must PROPAGATE.
import { assert, assertRejects } from "jsr:@std/assert";
import { dirname, join as joinPath } from "@std/path";
import { createRenderer } from "./mod.ts";

async function writeTree(tmp: string, files: Record<string, string>) {
  for (const [rel, body] of Object.entries(files)) {
    const path = joinPath(tmp, ...rel.split("/"));
    await Deno.mkdir(dirname(path), { recursive: true });
    await Deno.writeTextFile(path, body);
  }
}

Deno.test("BUG R: loadResolve — present resolve→fn, throwing resolve→propagates, missing→undefined", async () => {
  const tmp = await Deno.makeTempDir({ prefix: "sprig-load-resolve-" });
  try {
    await writeTree(tmp, {
      // a shell so createRenderer has a sane registry (not strictly required for loadResolve)
      "shell/template.html": `<div><router-outlet></router-outlet></div>`,
      "pages/good/template.html": `<p>good</p>`,
      "pages/good/resolve.ts": `export const resolve = () => ({ ok: true });`,
      // a resolve.ts that EXISTS but throws at import (module-init) time
      "pages/bad/template.html": `<p>bad</p>`,
      "pages/bad/resolve.ts": `throw new Error("boom");\nexport const resolve = () => ({});`,
      // a page with NO resolve.ts at all
      "pages/missing/template.html": `<p>missing</p>`,
    });
    const r = await createRenderer(tmp, "/ui", { dev: true });

    const good = await r.loadResolve("pages/good");
    assert(typeof good === "function", `present resolve.ts should yield a function, got ${typeof good}`);

    // BUG: before the fix this RESOLVES to undefined instead of throwing.
    await assertRejects(
      () => r.loadResolve("pages/bad"),
      Error,
      "boom",
      "an existing resolve.ts that throws at import MUST propagate, not be swallowed as undefined",
    );

    const missing = await r.loadResolve("pages/missing");
    assert(missing === undefined, `a page with no resolve.ts should yield undefined, got ${typeof missing}`);
  } finally {
    await Deno.remove(tmp, { recursive: true });
  }
});
