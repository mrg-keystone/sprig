// The dual-core gate (build.ts assertSingleRuntime): a build must emit EXACTLY ONE copy of
// the sprig runtime. Two copies = the drift that wedged prod (islands dead at hydration with
// `inject() must be called synchronously`). The gate turns that silent runtime death into a
// loud build failure at the moment it's created.
import { assert, assertEquals, assertRejects, assertStringIncludes } from "@std/assert";
import { join } from "@std/path";
import { assertSingleRuntime, forcedImportMap } from "./build.ts";

const SENTINEL = "__sprig_runtime"; // the once-per-runtime marker core.ts writes

async function tmpOut(files: Record<string, string>): Promise<string> {
  const dir = await Deno.makeTempDir({ prefix: "sprig-dualcore-" });
  for (const [name, body] of Object.entries(files)) await Deno.writeTextFile(join(dir, name), body);
  return dir;
}

Deno.test("gate: TWO runtime chunks → build fails loudly (the prod wedge)", async () => {
  const dir = await tmpOut({
    "client.js": `console.log("loader"); globalThis.${SENTINEL} = true;`,
    "chunk-AAAA1111.js": `export const x = 1;`, // some shared chunk, no runtime
    "isl.counter.js": `globalThis.${SENTINEL} = true; export const y = 2;`, // SECOND runtime copy
  });
  try {
    const err = await assertRejects(() => assertSingleRuntime(dir), Error);
    assertStringIncludes(err.message, "DUAL-CORE");
    assertStringIncludes(err.message, "client.js");
    assertStringIncludes(err.message, "isl.counter.js");
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
});

Deno.test("gate: ONE runtime chunk (the healthy shared-chunk case) → passes", async () => {
  // client.js + the island import ONE shared runtime chunk; the sentinel lives only there.
  const dir = await tmpOut({
    "client.js": `import "./chunk-RUNTIME1.js"; console.log("loader");`,
    "isl.counter.js": `import "./chunk-RUNTIME1.js"; export const y = 2;`,
    "chunk-RUNTIME1.js": `globalThis.${SENTINEL} = true; export const rt = 1;`,
    "app.css": `body{color:red} /* ${SENTINEL} in css must be ignored */`,
    "templates.json": `{"x": "${SENTINEL} in json is ignored too"}`,
  });
  try {
    await assertSingleRuntime(dir); // must not throw
    assert(true);
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
});

Deno.test("gate: ZERO sentinel chunks → does NOT block (sentinel moved = framework change)", async () => {
  const dir = await tmpOut({ "client.js": `console.log("no runtime marker here");` });
  try {
    await assertSingleRuntime(dir); // must not throw on 0
    assert(true);
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
});

Deno.test("forcedImportMap: FORCES @mrg-keystone/sprig to the CLI runtime, preserves + absolutizes app imports", async () => {
  // an app whose deno.json pins @mrg-keystone/sprig to its OWN copy (the drift source) plus an
  // app-specific relative import and a bare jsr specifier
  const app = await Deno.makeTempDir({ prefix: "sprig-fmap-" });
  const src = join(app, "src");
  await Deno.mkdir(src, { recursive: true });
  await Deno.writeTextFile(
    join(app, "deno.json"),
    JSON.stringify({
      imports: {
        "@mrg-keystone/sprig": "jsr:@mrg-keystone/sprig@0.9.9", // WRONG on purpose — must be overridden
        "@preact/signals-core": "npm:@preact/signals-core@0.0.1", // also overridden
        "$.services/": "./src/services/", // app import — must survive, made absolute
        "@mrg-keystone/rune": "jsr:@mrg-keystone/rune@^3", // bare — must survive as-is
      },
    }),
  );
  try {
    const { imports } = await forcedImportMap(src);
    // the runtime is forced to the CLI's own core.ts (this checkout), NOT the app's 0.9.9 pin
    assert(imports["@mrg-keystone/sprig"].endsWith("/framework/.sprig/core.ts"), imports["@mrg-keystone/sprig"]);
    assert(!imports["@mrg-keystone/sprig"].includes("0.9.9"), "app's @mrg-keystone/sprig pin must be overridden");
    assertEquals(imports["@preact/signals-core"], "npm:@preact/signals-core@^1.8.0");
    // app imports survive; relative ones become absolute file URLs, bare ones stay
    assert(imports["$.services/"].startsWith("file://") && imports["$.services/"].endsWith("/src/services/"), imports["$.services/"]);
    assertEquals(imports["@mrg-keystone/rune"], "jsr:@mrg-keystone/rune@^3");
  } finally {
    await Deno.remove(app, { recursive: true });
  }
});
