// g5-build regression tests. One Deno.test per assigned bug (22, 24, 45, 46, 63, 65).
// Run ONLY this file while iterating:  deno test -A bugs/g5-build.test.ts
import { assert, assertEquals, assertStringIncludes } from "@std/assert";
import { dirname, fromFileUrl, join } from "@std/path";

import { hasParseError, parseTemplate } from "../ui/.sprig/compiler/parse.ts";
import { manifestPath, shortHash } from "../ui/.sprig/compiler/build.ts";
import { withServerInjector } from "../ui/.sprig/compiler/island.ts";
import { createRenderer } from "../ui/.sprig/compiler/mod.ts";
import { inject, runInInjector, token } from "@sprig/core";

const HERE = dirname(fromFileUrl(import.meta.url));

// ───────────────────────────────────────────────────────────────────────────
// Bug 22: malformed template.html must FAIL the build, not silently ship an
// error AST. parseTemplate (the shared entry consumed by build.ts + parseCached)
// must throw on a tree-sitter ERROR AST instead of only on a null tree.
Deno.test("bug 22: malformed template fails the build (parseTemplate throws on hasError)", async () => {
  // A clean template still parses fine (no regression).
  const ok = await parseTemplate("<div>ok</div>");
  assertEquals(ok.type, "template");
  assertEquals(hasParseError(ok), false);

  // Malformed inputs that tree-sitter "recovers" into an ERROR AST must throw.
  for (const broken of ["<div", "@for (x { </broken>", "<<<>>>"]) {
    let threw = false;
    let msg = "";
    try {
      await parseTemplate(broken);
    } catch (e) {
      threw = true;
      msg = (e as Error).message;
    }
    assert(threw, `parseTemplate should throw on malformed input ${JSON.stringify(broken)}`);
    assertStringIncludes(msg, "failed to parse cleanly");
  }
});

// ───────────────────────────────────────────────────────────────────────────
// Bug 24: inject() must resolve inside an island's setup() on the server. The
// server setup() path is wrapped in a component injector (withServerInjector),
// so a scope:"both" service resolves instead of throwing.
Deno.test("bug 24: inject() resolves inside island setup() on the server", () => {
  const FooSvc = token("g5Foo", { scope: "both", factory: () => ({ hi: 42 }) });

  // Outside any injector, inject() must still throw (the broken state we fixed).
  let threwOutside = false;
  try {
    inject(FooSvc);
  } catch {
    threwOutside = true;
  }
  assert(threwOutside, "inject() outside an injector should throw");

  // The exact seam mod.ts now uses to wrap server-side setup(): inject() resolves.
  const result = withServerInjector(() => {
    const foo = inject(FooSvc); // would THROW on the buggy (unwrapped) code path
    return foo.hi;
  });
  assertEquals(result, 42);
});

// End-to-end through the real SSR renderer: an island whose setup() calls inject()
// renders without throwing (on the buggy code this 500s the whole page).
Deno.test("bug 24: island setup() that injects renders via the SSR renderer", async () => {
  const tmp = await Deno.makeTempDir({ prefix: "g5_inject_" });
  try {
    // shell with a router-outlet
    await Deno.mkdir(join(tmp, "shell"), { recursive: true });
    await Deno.writeTextFile(join(tmp, "shell", "template.html"), `<div><router-outlet></router-outlet></div>`);
    // a static page that mounts the island
    await Deno.mkdir(join(tmp, "home"), { recursive: true });
    await Deno.writeTextFile(join(tmp, "home", "template.html"), `<greet-svc></greet-svc>`);
    // the island: setup() injects a scope:"both" service
    const isl = join(tmp, "greet-svc");
    await Deno.mkdir(isl, { recursive: true });
    await Deno.writeTextFile(join(isl, "template.html"), `<p>{{ msg() }}</p>`);
    await Deno.writeTextFile(
      join(isl, "logic.ts"),
      [
        `import { defineComponent, inject, token } from "@sprig/core";`,
        `const Hi = token("g5Hi", { scope: "both", factory: () => ({ text: "injected!" }) });`,
        `export default defineComponent((ctx) => {`,
        `  const svc = inject(Hi);`,
        `  return { msg: ctx.input("msg", svc.text) };`,
        `});`,
      ].join("\n"),
    );

    const renderer = await createRenderer(tmp, "/ui");
    // On the buggy (unwrapped) path this throws inside setup() → would 500.
    const html = await renderer.renderDocument("home", {});
    assertStringIncludes(html, "injected!");
  } finally {
    await Deno.remove(tmp, { recursive: true });
  }
});

// ───────────────────────────────────────────────────────────────────────────
// Bug 45: shortHash must frame files so a boundary shift across the SAME filenames
// changes `v`. Two builds {a:"abc", b:"def"} and {a:"ab", b:"cdef"} collided under
// the unframed concatenation; with name+length framing they must differ.
Deno.test("bug 45: shortHash is boundary-shift collision resistant", async () => {
  const dir = await Deno.makeTempDir({ prefix: "g5_hash_" });
  try {
    const a = join(dir, "a.txt");
    const b = join(dir, "b.txt");
    const paths = [a, b].sort();

    await Deno.writeTextFile(a, "abc");
    await Deno.writeTextFile(b, "def");
    const hashA = await shortHash(paths);

    await Deno.writeTextFile(a, "ab");
    await Deno.writeTextFile(b, "cdef");
    const hashB = await shortHash(paths);

    // Different output sets (one byte shifted across the file boundary) → different v.
    assert(
      hashA !== hashB,
      `shortHash collided on a boundary shift: both "${hashA}" — the immutable cache would pin stale assets`,
    );

    // Sanity: identical content → identical hash (cache-busting is still stable).
    await Deno.writeTextFile(a, "abc");
    await Deno.writeTextFile(b, "def");
    assertEquals(await shortHash(paths), hashA);
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
});

// ───────────────────────────────────────────────────────────────────────────
// Bug 46: the manifest is a server-only build artifact and must live OUTSIDE the
// public assets dir (static/), so it is never reachable under /_assets and never
// served immutable.
Deno.test("bug 46: manifest is written outside the public assets dir", () => {
  const outDir = join(HERE, "..", "static");
  const mf = manifestPath(outDir);

  // It must NOT be the served file static/manifest.json (which serveAsset exposes).
  assert(
    mf !== join(outDir, "manifest.json"),
    "manifest must not be written into the served assets dir",
  );
  // Its directory must not be the assets dir itself (so /ui/_assets/<file> can't reach it).
  assert(
    dirname(mf) !== outDir,
    `manifest dir ${dirname(mf)} is inside the served assets dir ${outDir} — it would leak`,
  );
  // And it is the sibling .sprig-manifest.json the SSR renderer reads.
  assertEquals(mf, join(dirname(outDir), ".sprig-manifest.json"));
});

// ───────────────────────────────────────────────────────────────────────────
// Bug 63 & 65: reparse() must NOT push when (a) the file content is unchanged, or
// (b) the new parse is a tree-sitter ERROR AST. It must still return true on a real,
// clean edit.
Deno.test("bug 63 & 65: reparse suppresses no-op saves and error ASTs", async () => {
  const tmp = await Deno.makeTempDir({ prefix: "g5_reparse_" });
  try {
    const isl = join(tmp, "ticker");
    await Deno.mkdir(isl, { recursive: true });
    const tplPath = join(isl, "template.html");
    await Deno.writeTextFile(tplPath, `<p>{{ count() }}</p>`);
    await Deno.writeTextFile(
      join(isl, "logic.ts"),
      [
        `import { defineComponent } from "@sprig/core";`,
        `export default defineComponent((ctx) => ({ count: ctx.input("count", 0) }));`,
      ].join("\n"),
    );

    const renderer = await createRenderer(tmp, "/ui", { dev: true });

    // (65) Re-save with IDENTICAL bytes → no-op → reparse returns false (no SSE push).
    assertEquals(await renderer.reparse("ticker"), false, "unchanged save must not broadcast");

    // (63) Introduce a SYNTAX ERROR → tree-sitter yields an ERROR AST. reparse must
    // suppress the push (return false) so the broken AST never clobbers mounted islands.
    await Deno.writeTextFile(tplPath, `<p>{{ count() }</p>\n@if (foo {\n  <span>x</span>\n`);
    assertEquals(await renderer.reparse("ticker"), false, "broken template must not broadcast an error AST");

    // A real, clean edit → reparse returns true (the live update still works).
    await Deno.writeTextFile(tplPath, `<p>value = {{ count() }}</p>`);
    assertEquals(await renderer.reparse("ticker"), true, "a clean edit must broadcast");

    // And the AST it now serves is the new, valid one (not an error AST).
    const ast = renderer.astFor("ticker");
    assert(ast !== null, "astFor should return the freshly parsed template");
    assertStringIncludes(ast!.source, "value =");
  } finally {
    await Deno.remove(tmp, { recursive: true });
  }
});
