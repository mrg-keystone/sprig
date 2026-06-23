// BUG M (dev-only): renderDocument reads the module-level `version` AFTER the
// `await renderBody` yield point, so a concurrent dev request that recomputes `version`
// (a background rebuild changed the static dir's hash) overwrites it mid-flight — the
// first request then stamps the SECOND request's version. renderStream already guards this
// by snapshotting `const v = version;` BEFORE the body await; renderDocument must do the same.
//
// Deterministic race: chdir to a temp cwd whose static/ hash we mutate between two
// concurrent renderDocument calls, gated by a barrier in the page's async onServerInit.
import { assert } from "jsr:@std/assert";
import { dirname, join as joinPath } from "@std/path";
import { createRenderer } from "./mod.ts";

async function writeTree(tmp: string, files: Record<string, string>) {
  for (const [rel, body] of Object.entries(files)) {
    const path = joinPath(tmp, ...rel.split("/"));
    await Deno.mkdir(dirname(path), { recursive: true });
    await Deno.writeTextFile(path, body);
  }
}

function deferred<T>() {
  let resolve!: (v: T) => void;
  const promise = new Promise<T>((r) => (resolve = r));
  return { promise, resolve };
}

Deno.test("BUG M: renderDocument stamps the version it resolved, not a racing request's", async () => {
  const cwd = Deno.cwd();
  const tmp = await Deno.makeTempDir({ prefix: "sprig-version-race-" });
  // Each page instance, on construction, fires a global "started" hook with its index and
  // awaits a global "release" promise — so the test can interleave the two requests exactly.
  const started: Array<(v: void) => void> = [deferred<void>().resolve, deferred<void>().resolve];
  const startedP: Array<Promise<void>> = [];
  const release: Array<Promise<void>> = [];
  const releaseR: Array<(v: void) => void> = [];
  for (let i = 0; i < 2; i++) {
    const s = deferred<void>();
    startedP[i] = s.promise;
    started[i] = s.resolve;
    const r = deferred<void>();
    release[i] = r.promise;
    releaseR[i] = r.resolve;
  }
  // expose the barrier to the dynamically-imported page logic.ts
  (globalThis as Record<string, unknown>).__bugM = {
    next: 0,
    hit(): Promise<void> {
      const g = (globalThis as Record<string, unknown>).__bugM as { next: number };
      const i = g.next++;
      started[i]();
      return release[i];
    },
  };
  try {
    await writeTree(tmp, {
      "static/app.css": "body{color:red}",
      "shell/template.html": `<div><router-outlet></router-outlet></div>`,
      "pages/home/template.html": `<p>{{ tag }}</p>`,
      "pages/home/logic.ts":
        `export default class Home {\n` +
        `  tag = "x";\n` +
        `  async onServerInit() {\n` +
        `    await (globalThis.__bugM).hit();\n` +
        `  }\n` +
        `}`,
    });
    Deno.chdir(tmp);
    const r = await createRenderer(tmp, "/ui", { dev: true });

    // Kick off request A. It will: version = readVersion() (= hashA), then await renderBody
    // → the class island resolve() awaits onServerInit → barrier 0 (started[0] fires, blocks).
    const docA = r.renderDocument("pages/home", {});
    await startedP[0]; // A is now parked inside renderBody's await

    // Mutate the static dir so the NEXT readVersion yields a different hash (hashB).
    await Deno.writeTextFile(joinPath(tmp, "static", "app.css"), "body{color:blue}");

    // Kick off request B. version = readVersion() (= hashB) runs now (during A's body await),
    // overwriting the module-level `version`. B parks at barrier 1.
    const docB = r.renderDocument("pages/home", {});
    await startedP[1];

    // Release A first: its body resolves and it stamps the version. With the bug it reads the
    // current module-level `version` (= hashB) — A's document gets B's version. With the fix it
    // stamped a snapshot taken before the body await (= hashA).
    releaseR[0]();
    const a = await docA;
    releaseR[1]();
    const b = await docB;

    const vOf = (html: string) => html.match(/app\.css\?v=([0-9a-f]+|dev)/)?.[1];
    const va = vOf(a);
    const vb = vOf(b);
    assert(va && vb, `both documents must stamp a version (a=${va}, b=${vb})`);
    assert(
      va !== vb,
      `renderDocument A must stamp the version it resolved, not B's racing version ` +
        `(A=${va}, B=${vb}); the module-level version was overwritten during A's body await`,
    );
  } finally {
    Deno.chdir(cwd);
    delete (globalThis as Record<string, unknown>).__bugM;
    await Deno.remove(tmp, { recursive: true });
  }
});
