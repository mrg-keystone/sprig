// deriveUiPackageDir resolves the UI package under the project root by probing the
// sanctioned names (ui/, then app/ — the alternate rune's structure spec sanctions).
// The probe is what lets a generated one-line `serveSprig({ keep })` compose correctly
// for BOTH layouts: before it, an app/-layout monorepo 500'd on every SSR page
// (createRenderer walked the non-existent <root>/ui/src).
import { assertEquals } from "jsr:@std/assert";
import { join } from "@std/path";
import { deriveUiPackageDir } from "./mod.ts";

function withTempRoot(fn: (root: string) => void) {
  const root = Deno.makeTempDirSync({ prefix: "sprig-ui-derive-" });
  try {
    fn(root);
  } finally {
    Deno.removeSync(root, { recursive: true });
  }
}

Deno.test("ui/ layout: <root>/ui wins", () => {
  withTempRoot((root) => {
    Deno.mkdirSync(join(root, "ui"));
    assertEquals(deriveUiPackageDir(root), join(root, "ui"));
  });
});

Deno.test("app/ layout: <root>/app is derived when there is no ui/", () => {
  withTempRoot((root) => {
    Deno.mkdirSync(join(root, "app"));
    assertEquals(deriveUiPackageDir(root), join(root, "app"));
  });
});

Deno.test("both present: ui/ takes precedence over app/", () => {
  withTempRoot((root) => {
    Deno.mkdirSync(join(root, "ui"));
    Deno.mkdirSync(join(root, "app"));
    assertEquals(deriveUiPackageDir(root), join(root, "ui"));
  });
});

Deno.test("fresh scaffold (neither exists yet): defaults to <root>/ui", () => {
  withTempRoot((root) => {
    assertEquals(deriveUiPackageDir(root), join(root, "ui"));
  });
});

Deno.test("a FILE named app is not a package: still defaults to <root>/ui", () => {
  withTempRoot((root) => {
    Deno.writeTextFileSync(join(root, "app"), "not a dir");
    assertEquals(deriveUiPackageDir(root), join(root, "ui"));
  });
});
