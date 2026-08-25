// sprig's spec-root walk, run against the SHARED golden vectors (vendored from
// the artifact format) — divergence between the toolchains' independent
// implementations fails here the day it lands, never as a silent split-brain.

import { assertEquals } from "@std/assert";
import { join } from "@std/path";
import { specRootOf } from "./spec-root.ts";
import { SPEC_ROOT_VECTORS_JSON } from "./vendored-tests.ts";

interface TreeEntry {
  path: string;
  kind: "dir" | "git-dir" | "git-file" | "symlink";
  target?: string;
}
interface Vector {
  name: string;
  tree: TreeEntry[];
  start: string;
  expected: string;
}

const { vectors } = JSON.parse(SPEC_ROOT_VECTORS_JSON) as { vectors: Vector[] };

for (const v of vectors) {
  Deno.test(`spec-root vectors: ${v.name}`, async () => {
    const tmp = await Deno.makeTempDir({ prefix: "specroot-vec-" });
    try {
      for (const e of v.tree) {
        const p = join(tmp, e.path);
        if (e.kind === "dir" || e.kind === "git-dir") {
          await Deno.mkdir(p, { recursive: true });
        } else if (e.kind === "git-file") {
          await Deno.writeTextFile(p, "gitdir: elsewhere\n");
        } else if (e.kind === "symlink") {
          await Deno.symlink(join(tmp, e.target!), p);
        }
      }
      // specRootOf returns the ROOT dir; the vectors' expected value is
      // `<root>/spec/` — normalize to the vector form before comparing.
      const got = specRootOf(join(tmp, v.start));
      const rel = got === tmp ? "" : got.slice(tmp.length + 1);
      assertEquals((rel ? rel + "/" : "") + "spec/", v.expected);
    } finally {
      await Deno.remove(tmp, { recursive: true });
    }
  });
}
