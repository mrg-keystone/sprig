// Unit tests for main.ts entry points — the arg parsing and the importability of
// the module (the `import.meta.main` guard means importing it must NOT run main()).
import { assert, assertEquals, assertStringIncludes } from "jsr:@std/assert@^1";
import { fromFileUrl, resolve } from "jsr:@std/path@^1";
import { projectRoot } from "./main.ts";

const MAIN = fromFileUrl(new URL("./main.ts", import.meta.url));

Deno.test("projectRoot(): no --root → the current directory", () => {
  assertEquals(projectRoot([]), Deno.cwd());
  assertEquals(projectRoot(["list"]), Deno.cwd());
  assertEquals(projectRoot(["test", "--json"]), Deno.cwd());
});

Deno.test("projectRoot(): --root <path> → resolve(path)", () => {
  assertEquals(projectRoot(["--root", "fixture"]), resolve("fixture"));
  assertEquals(
    projectRoot(["dev", "--root", "../elsewhere"]),
    resolve("../elsewhere"),
  );
  // A trailing --root with no value falls back to cwd (no bogus resolve("")).
  assertEquals(projectRoot(["--root"]), Deno.cwd());
});

Deno.test("importing main.ts does not auto-run main() (import.meta.main guard)", async () => {
  // Import the module in a child process. If the guard were missing, main() would
  // run cmdList and print a discovery summary; we assert it does not, while the
  // export is still reachable — i.e. the module is importable without side effects.
  const out = await new Deno.Command(Deno.execPath(), {
    args: [
      "eval",
      `import * as m from ${JSON.stringify(MAIN)};\n` +
      `console.log("LOADED:" + typeof m.projectRoot);`,
    ],
    stdout: "piped",
    stderr: "piped",
  }).output();
  const stdout = new TextDecoder().decode(out.stdout);
  assert(
    out.success,
    `import failed:\n${new TextDecoder().decode(out.stderr)}`,
  );
  assertStringIncludes(stdout, "LOADED:function"); // the export is reachable
  // main() never ran — none of cmdList's output is present.
  assert(
    !stdout.includes("isolatable"),
    `main() auto-ran on import:\n${stdout}`,
  );
  assert(
    !stdout.includes("component(s)"),
    `main() auto-ran on import:\n${stdout}`,
  );
});
