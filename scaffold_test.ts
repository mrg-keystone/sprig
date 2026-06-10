// Unit tests for scaffold.ts's pure helpers. The /api/run endpoint spawns
// Playwright unauthenticated on localhost, so the spec-path filter is a security
// boundary: only real `.spec` files INSIDE the host root may run. filterSpecs() is
// the exported, tested mirror of the logic inlined into the generated endpoint.
import { assertEquals } from "jsr:@std/assert@^1";
import { dirname, join, resolve } from "jsr:@std/path@^1";
import { filterSpecs } from "./scaffold.ts";

Deno.test("filterSpecs: accepts .spec files inside the host root", async () => {
  const root = await Deno.makeTempDir({ prefix: "isolate-spec-" });
  try {
    const a = join(root, "components/button/isolate/cases/x/tests/a.spec.ts");
    const b = join(root, "ok.spec.tsx");
    assertEquals(filterSpecs([a], root), [resolve(a)]);
    assertEquals(filterSpecs([a, b], root), [resolve(a), resolve(b)]);
  } finally {
    await Deno.remove(root, { recursive: true });
  }
});

Deno.test("filterSpecs: rejects paths outside the host root (the 400 branch)", async () => {
  const root = await Deno.makeTempDir({ prefix: "isolate-spec-" });
  try {
    // A sibling of the host root — never inside it.
    assertEquals(filterSpecs([join(dirname(root), "evil.spec.ts")], root), []);
    // An absolute path elsewhere on disk.
    assertEquals(filterSpecs(["/etc/passwd.spec.ts"], root), []);
  } finally {
    await Deno.remove(root, { recursive: true });
  }
});

Deno.test("filterSpecs: a '..' traversal can't escape (resolved before checking)", async () => {
  const root = await Deno.makeTempDir({ prefix: "isolate-spec-" });
  try {
    // Crafted to look prefixed by the root, but `..` escapes it once resolved.
    const escape = root + "/../" + basename2(root) + "-evil/x.spec.ts";
    assertEquals(filterSpecs([escape], root), []);
    assertEquals(filterSpecs([root + "/../evil.spec.ts"], root), []);
  } finally {
    await Deno.remove(root, { recursive: true });
  }
});

Deno.test("filterSpecs: rejects non-.spec files even inside the root", async () => {
  const root = await Deno.makeTempDir({ prefix: "isolate-spec-" });
  try {
    assertEquals(
      filterSpecs([join(root, "components/button/Button.tsx")], root),
      [],
    );
    assertEquals(filterSpecs([join(root, "notes.txt")], root), []);
    assertEquals(filterSpecs([join(root, "a.spec.ts.bak")], root), []);
  } finally {
    await Deno.remove(root, { recursive: true });
  }
});

Deno.test("filterSpecs: tolerates junk input (non-array, non-string entries)", async () => {
  const root = await Deno.makeTempDir({ prefix: "isolate-spec-" });
  try {
    const ok = join(root, "ok.spec.tsx");
    assertEquals(filterSpecs("nope", root), []);
    assertEquals(filterSpecs(undefined, root), []);
    assertEquals(filterSpecs([42, null, {}, ok], root), [resolve(ok)]);
  } finally {
    await Deno.remove(root, { recursive: true });
  }
});

function basename2(p: string): string {
  return p.slice(p.lastIndexOf("/") + 1);
}
